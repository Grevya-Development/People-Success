import "server-only";
import { isIP } from "node:net";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { can, type RequestContext } from "../../auth/context";
import type { Tx } from "../../db/client";
import { departments, documents, employees, policies, policyAcknowledgements } from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { forbidden, invalidState, notFound, validation } from "../../lib/errors";
import { activeEmployeeIdsWithUsers } from "../directory";
import { notify } from "../notifications";
import type { PolicyInput } from "@/lib/validation/documents";

const ACTIVE_STATUSES = ["active", "on_notice"] as const;

export const canManagePolicies = (ctx: RequestContext) => can(ctx, "policies.manage", "all");

function requireManage(ctx: RequestContext) {
  if (!canManagePolicies(ctx)) throw forbidden();
}

export type PolicyListItem = {
  id: string;
  title: string;
  category: string;
  summary: string | null;
  version: number;
  status: string;
  effectiveFrom: string;
  requiresAcknowledgement: boolean;
  publishedAt: string | null;
  updatedAt: string;
  /** Present for the signed-in employee. */
  myAcknowledgedAt: string | null;
  /** Present for policy managers. */
  coverage: { acknowledged: number; total: number } | null;
};

async function activeHeadcount(tx: Tx) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(employees)
    .where(and(isNull(employees.deletedAt), inArray(employees.status, [...ACTIVE_STATUSES])));
  return row?.n ?? 0;
}

const ackedActiveCount = sql<number>`(
  select count(*)::int from ${policyAcknowledgements} a
  join ${employees} e on e.id = a.employee_id
  where a.policy_id = "policies"."id" and a.policy_version = "policies"."version"
    and e.deleted_at is null and e.status in ('active', 'on_notice')
)`;

/**
 * Policies visible to the caller. Managers see every status with coverage;
 * everyone else sees published policies with their own acknowledgement.
 */
export async function listPolicies(ctx: RequestContext): Promise<PolicyListItem[]> {
  const manage = canManagePolicies(ctx);
  return ctx.db(async (tx) => {
    const total = manage ? await activeHeadcount(tx) : 0;
    const rows = await tx
      .select({
        p: policies,
        acked: manage ? ackedActiveCount : sql<number>`0`,
        myAck: ctx.employeeId
          ? sql<string | null>`(
              select to_char(max(a.acknowledged_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from ${policyAcknowledgements} a
              where a.policy_id = "policies"."id" and a.policy_version = "policies"."version"
                and a.employee_id = ${ctx.employeeId}
            )`
          : sql<string | null>`null`,
      })
      .from(policies)
      .where(manage ? undefined : eq(policies.status, "published"))
      .orderBy(sql`case ${policies.status} when 'published' then 0 when 'draft' then 1 else 2 end`, asc(policies.title))
      .limit(500);
    return rows.map(({ p, acked, myAck }) => ({
      id: p.id,
      title: p.title,
      category: p.category,
      summary: p.summary,
      version: p.version,
      status: p.status,
      effectiveFrom: p.effectiveFrom,
      requiresAcknowledgement: p.requiresAcknowledgement,
      publishedAt: p.publishedAt?.toISOString() ?? null,
      updatedAt: p.updatedAt.toISOString(),
      myAcknowledgedAt: myAck ? new Date(myAck).toISOString() : null,
      coverage: manage && p.status === "published" ? { acknowledged: Number(acked), total } : null,
    }));
  });
}

export type PolicyDetail = PolicyListItem & {
  body: string;
  document: { id: string; title: string; fileName: string } | null;
  documentId: string | null;
  canAcknowledge: boolean;
};

export async function getPolicy(ctx: RequestContext, id: string): Promise<PolicyDetail> {
  const manage = canManagePolicies(ctx);
  return ctx.db(async (tx) => {
    const [p] = await tx.select().from(policies).where(eq(policies.id, id));
    if (!p || (!manage && p.status !== "published")) throw notFound("Policy");
    const [doc] = p.documentId
      ? await tx
          .select({ id: documents.id, title: documents.title, fileName: documents.fileName })
          .from(documents)
          .where(and(eq(documents.id, p.documentId), isNull(documents.deletedAt)))
      : [];
    const [ack] = ctx.employeeId
      ? await tx
          .select({ at: policyAcknowledgements.acknowledgedAt })
          .from(policyAcknowledgements)
          .where(
            and(
              eq(policyAcknowledgements.policyId, p.id),
              eq(policyAcknowledgements.policyVersion, p.version),
              eq(policyAcknowledgements.employeeId, ctx.employeeId),
            ),
          )
      : [];
    let coverage: PolicyListItem["coverage"] = null;
    if (manage && p.status === "published") {
      const [row] = await tx.select({ n: ackedActiveCount }).from(policies).where(eq(policies.id, p.id));
      coverage = { acknowledged: Number(row?.n ?? 0), total: await activeHeadcount(tx) };
    }
    return {
      id: p.id,
      title: p.title,
      category: p.category,
      summary: p.summary,
      body: p.body,
      version: p.version,
      status: p.status,
      effectiveFrom: p.effectiveFrom,
      requiresAcknowledgement: p.requiresAcknowledgement,
      publishedAt: p.publishedAt?.toISOString() ?? null,
      updatedAt: p.updatedAt.toISOString(),
      documentId: p.documentId,
      document: doc ?? null,
      myAcknowledgedAt: ack?.at.toISOString() ?? null,
      coverage,
      canAcknowledge: !!ctx.employeeId && p.status === "published" && p.requiresAcknowledgement && !ack,
    };
  });
}

/** An attached document must be an employee-visible company document, or employees could not open it. */
async function assertAttachable(tx: Tx, documentId: string | null) {
  if (!documentId) return;
  const [doc] = await tx
    .select({ ownerType: documents.ownerType, employeeVisible: documents.employeeVisible })
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));
  if (!doc || doc.ownerType !== "company") {
    throw validation("Attach a company document.", { documentId: ["Choose a company document"] });
  }
  if (!doc.employeeVisible) {
    throw validation("The attached document is HR-only. Make it visible to employees first.", {
      documentId: ["Document is not visible to employees"],
    });
  }
}

const contentOf = (p: Pick<PolicyInput, "title" | "body" | "effectiveFrom" | "requiresAcknowledgement" | "documentId">) => ({
  title: p.title,
  body: p.body,
  effectiveFrom: p.effectiveFrom,
  requiresAcknowledgement: p.requiresAcknowledgement,
  documentId: p.documentId,
});

export async function createPolicy(ctx: RequestContext, input: PolicyInput) {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    await assertAttachable(tx, input.documentId);
    const [p] = await tx
      .insert(policies)
      .values({ tenantId: ctx.tenantId, ...input, status: "draft", version: 1 })
      .returning({ id: policies.id });
    await audit(tx, ctx, { action: "policy.created", entityType: "policy", entityId: p.id, metadata: { title: input.title } });
    return { id: p.id };
  });
}

async function notifyPublished(tx: Tx, ctx: RequestContext, p: { id: string; title: string; version: number; requiresAcknowledgement: boolean }) {
  const rows = await activeEmployeeIdsWithUsers(tx);
  await notify(tx, {
    tenantId: ctx.tenantId,
    userIds: rows.map((r) => r.userId!).filter((u) => u !== ctx.userId),
    category: "policies",
    title: p.requiresAcknowledgement ? `Please read and acknowledge: ${p.title}` : `Policy published: ${p.title}`,
    body: p.version > 1 ? `Version ${p.version} is now in effect.` : null,
    href: `/documents/policies/${p.id}`,
    dedupeKey: `policy:${p.id}:v${p.version}`,
  });
}

/**
 * Edit a policy. Drafts change in place. Editing the content of a published
 * policy publishes a new version, so earlier acknowledgements (which are per
 * version) no longer count and employees are asked again.
 */
export async function updatePolicy(ctx: RequestContext, input: PolicyInput & { id: string }) {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const [before] = await tx.select().from(policies).where(eq(policies.id, input.id)).for("update");
    if (!before) throw notFound("Policy");
    if (before.status === "archived") throw invalidState("Restore this policy before editing it.");
    await assertAttachable(tx, input.documentId);
    const { id, ...fields } = input;
    const contentChanged = Object.keys(diff(contentOf(before), contentOf(input))).length > 0;
    const republish = before.status === "published" && contentChanged;
    const next = {
      ...fields,
      ...(republish ? { version: before.version + 1, publishedAt: new Date(), publishedBy: ctx.userId } : {}),
    };
    const [after] = await tx.update(policies).set(next).where(eq(policies.id, id)).returning();
    await audit(tx, ctx, {
      action: republish ? "policy.republished" : "policy.updated",
      entityType: "policy",
      entityId: id,
      changes: diff(
        { ...contentOf(before), category: before.category, summary: before.summary, version: before.version },
        { ...contentOf(after), category: after.category, summary: after.summary, version: after.version },
      ),
    });
    if (republish) await notifyPublished(tx, ctx, after);
    return { id, version: after.version, republished: republish };
  });
}

export async function publishPolicy(ctx: RequestContext, id: string) {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const [p] = await tx.select().from(policies).where(eq(policies.id, id)).for("update");
    if (!p) throw notFound("Policy");
    if (p.status === "published") return { id, version: p.version };
    const [after] = await tx
      .update(policies)
      .set({ status: "published", publishedAt: new Date(), publishedBy: ctx.userId })
      .where(eq(policies.id, id))
      .returning();
    await audit(tx, ctx, {
      action: "policy.published",
      entityType: "policy",
      entityId: id,
      changes: diff({ status: p.status }, { status: "published" }),
      metadata: { version: after.version },
    });
    await notifyPublished(tx, ctx, after);
    return { id, version: after.version };
  });
}

export async function archivePolicy(ctx: RequestContext, id: string) {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const [p] = await tx.select().from(policies).where(eq(policies.id, id)).for("update");
    if (!p) throw notFound("Policy");
    if (p.status !== "published") throw invalidState("Only published policies can be archived.");
    await tx.update(policies).set({ status: "archived" }).where(eq(policies.id, id));
    await audit(tx, ctx, { action: "policy.archived", entityType: "policy", entityId: id, changes: diff({ status: p.status }, { status: "archived" }) });
    return { id };
  });
}

export async function deleteDraftPolicy(ctx: RequestContext, id: string) {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const [p] = await tx.select().from(policies).where(eq(policies.id, id)).for("update");
    if (!p) throw notFound("Policy");
    if (p.status !== "draft" || p.publishedAt) throw invalidState("Only never-published drafts can be deleted. Archive it instead.");
    await tx.delete(policies).where(eq(policies.id, id));
    await audit(tx, ctx, { action: "policy.deleted", entityType: "policy", entityId: id, metadata: { title: p.title } });
    return { id };
  });
}

/** Idempotent: acknowledging the same version twice keeps the first timestamp. */
export async function acknowledgePolicy(ctx: RequestContext, id: string, meta: { ip?: string | null } = {}) {
  if (!ctx.employeeId) throw forbidden("Only employees can acknowledge policies.");
  const employeeId = ctx.employeeId;
  return ctx.db(async (tx) => {
    const [p] = await tx.select().from(policies).where(eq(policies.id, id));
    if (!p || p.status !== "published") throw notFound("Policy");
    if (!p.requiresAcknowledgement) throw invalidState("This policy does not need an acknowledgement.");
    const inserted = await tx
      .insert(policyAcknowledgements)
      .values({
        tenantId: ctx.tenantId,
        policyId: p.id,
        policyVersion: p.version,
        employeeId,
        ip: meta.ip && isIP(meta.ip) ? meta.ip : null,
      })
      .onConflictDoNothing()
      .returning({ id: policyAcknowledgements.id });
    if (inserted.length) {
      await audit(tx, ctx, {
        action: "policy.acknowledged",
        entityType: "policy",
        entityId: p.id,
        metadata: { version: p.version, employeeId },
      });
    }
    return { id: p.id, version: p.version, alreadyAcknowledged: inserted.length === 0 };
  });
}

export type PendingAcknowledgement = {
  employeeId: string;
  name: string;
  employeeCode: string;
  department: string | null;
};

/** Active employees who have not acknowledged the current version. */
export async function pendingAcknowledgements(ctx: RequestContext, policyId: string): Promise<PendingAcknowledgement[]> {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const [p] = await tx.select({ id: policies.id, version: policies.version }).from(policies).where(eq(policies.id, policyId));
    if (!p) throw notFound("Policy");
    const rows = await tx
      .select({
        employeeId: employees.id,
        name: employees.displayName,
        employeeCode: employees.employeeCode,
        department: departments.name,
      })
      .from(employees)
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(
        and(
          isNull(employees.deletedAt),
          inArray(employees.status, [...ACTIVE_STATUSES]),
          sql`not exists (
            select 1 from ${policyAcknowledgements} a
            where a.policy_id = ${p.id} and a.policy_version = ${p.version} and a.employee_id = "employees"."id"
          )`,
        ),
      )
      .orderBy(asc(employees.displayName))
      .limit(2000);
    return rows;
  });
}

/** Policies awaiting the signed-in employee's acknowledgement (for nudges). */
export async function myPendingPolicies(ctx: RequestContext) {
  if (!ctx.employeeId) return [];
  const me = ctx.employeeId;
  return ctx.db((tx) =>
    tx
      .select({ id: policies.id, title: policies.title, version: policies.version })
      .from(policies)
      .where(
        and(
          eq(policies.status, "published"),
          eq(policies.requiresAcknowledgement, true),
          sql`not exists (
            select 1 from ${policyAcknowledgements} a
            where a.policy_id = "policies"."id" and a.policy_version = "policies"."version" and a.employee_id = ${me}
          )`,
        ),
      )
      .orderBy(desc(policies.publishedAt))
      .limit(50),
  );
}
