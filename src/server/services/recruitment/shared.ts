import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { can, type RequestContext } from "../../auth/context";
import type { Tx } from "../../db/client";
import { applicationEvents, membershipRoles, memberships, recruitmentStages, roles, users } from "../../db/schema";
import { env } from "../../env";
import { forbidden } from "../../lib/errors";
import { DEFAULT_STAGES } from "@/lib/validation/recruitment";

export const toPaise = (rupees: number) => Math.round(rupees * 100);
export const toRupees = (paise: number | null | undefined) => (paise == null ? null : paise / 100);

export const appUrl = (path: string) => `${env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}${path}`;

/* ------------------------------------------------------------------ */
/* Access helpers                                                      */
/* ------------------------------------------------------------------ */

type Grants = Pick<RequestContext, "grants">;

export const canViewRecruitment = (ctx: Grants) => can(ctx, "recruitment.view", "all") || can(ctx, "recruitment.manage", "all");
export const canManageRecruitment = (ctx: Grants) => can(ctx, "recruitment.manage", "all");
export const canSeeOffers = (ctx: Grants) =>
  can(ctx, "offers.manage", "all") || can(ctx, "offers.approve", "all") || can(ctx, "recruitment.manage", "all");
export const canManageOffers = (ctx: Grants) => can(ctx, "offers.manage", "all");
/** Requisition budgets are compensation data. */
export const canSeeBudget = (ctx: Grants) =>
  can(ctx, "compensation.view", "all") || can(ctx, "offers.approve", "all") || can(ctx, "requisitions.approve", "all");

export function requireRecruitmentView(ctx: Grants) {
  if (!canViewRecruitment(ctx)) throw forbidden();
}
export function requireRecruitmentManage(ctx: Grants) {
  if (!canManageRecruitment(ctx)) throw forbidden();
}

/* ------------------------------------------------------------------ */
/* Stages                                                              */
/* ------------------------------------------------------------------ */

/**
 * Seed the default pipeline the first time a tenant uses recruitment.
 * Idempotent: unique (tenant, name) and only runs when no stage exists.
 */
export async function ensureDefaultStages(tx: Tx, tenantId: string) {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(recruitmentStages)
    .where(eq(recruitmentStages.tenantId, tenantId));
  if (n > 0) return;
  await tx
    .insert(recruitmentStages)
    .values(DEFAULT_STAGES.map((s, i) => ({ tenantId, name: s.name, kind: s.kind, sortOrder: (i + 1) * 10 })))
    .onConflictDoNothing();
}

export async function activeStages(tx: Tx, tenantId: string) {
  await ensureDefaultStages(tx, tenantId);
  return tx
    .select()
    .from(recruitmentStages)
    .where(and(eq(recruitmentStages.tenantId, tenantId), eq(recruitmentStages.isActive, true)))
    .orderBy(asc(recruitmentStages.sortOrder));
}

export async function allStages(tx: Tx, tenantId: string) {
  await ensureDefaultStages(tx, tenantId);
  return tx.select().from(recruitmentStages).where(eq(recruitmentStages.tenantId, tenantId)).orderBy(asc(recruitmentStages.sortOrder));
}

export async function firstStage(tx: Tx, tenantId: string) {
  const stages = await activeStages(tx, tenantId);
  const s = stages.find((x) => x.kind === "applied") ?? stages[0];
  if (!s) throw new Error("No active recruitment stage");
  return s;
}

export async function stageOfKind(tx: Tx, tenantId: string, kind: (typeof recruitmentStages.$inferSelect)["kind"]) {
  const stages = await allStages(tx, tenantId);
  return stages.find((s) => s.kind === kind && s.isActive) ?? stages.find((s) => s.kind === kind) ?? null;
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

export async function logEvent(
  tx: Tx,
  e: {
    tenantId: string;
    applicationId: string;
    type: string;
    actorUserId: string | null;
    body?: string | null;
    fromStageId?: string | null;
    toStageId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.insert(applicationEvents).values({
    tenantId: e.tenantId,
    applicationId: e.applicationId,
    type: e.type,
    actorUserId: e.actorUserId,
    body: e.body ?? null,
    fromStageId: e.fromStageId ?? null,
    toStageId: e.toStageId ?? null,
    metadata: e.metadata ?? null,
  });
}

export async function userNames(tx: Tx, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter(Boolean) as string[])];
  if (!unique.length) return new Map<string, string>();
  const rows = await tx
    .select({ id: users.id, name: sql<string>`coalesce(${users.fullName}, ${users.email})` })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export const fullName = (c: { firstName: string; lastName?: string | null }) => [c.firstName, c.lastName].filter(Boolean).join(" ");

/** Candidate records are retained this long after their last activity (DPDP). */
export function retainUntilFrom(today: string, months = 12) {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

/**
 * Active users holding a role that grants `permission`. Role templates store
 * unscoped grants either bare ("interviews.feedback") or with a scope
 * ("recruitment.manage:all"); both forms count.
 */
export async function usersWithPermission(tx: Tx, tenantId: string, permission: string) {
  const rows = await tx
    .selectDistinct({ userId: memberships.userId })
    .from(membershipRoles)
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
    .where(
      and(
        eq(roles.tenantId, tenantId),
        eq(memberships.status, "active"),
        sql`exists (select 1 from unnest(${roles.permissions}) p where p = ${permission} or p like ${permission + ":%"})`,
      ),
    );
  return rows.map((r) => r.userId);
}
