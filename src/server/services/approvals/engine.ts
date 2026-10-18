import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { addHours } from "date-fns";
import type { Tx } from "../../db/client";
import { approvalPolicies, approvalRequests, approvalSteps } from "../../db/schema";
import type { ApprovalStepDefinition } from "../../db/schema/platform";
import { audit } from "../../lib/audit";
import { AppError, forbidden, invalidState, notFound } from "../../lib/errors";
import { notify } from "../notifications";
import {
  departmentHeadOf,
  managerOf,
  userIdForEmployee,
  userIdsWithRoles,
  withDelegates,
} from "../directory";
import { todayIn } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* Handler registry: each module reacts to its own subjects' outcomes. */
/* ------------------------------------------------------------------ */

export type ApprovalActor = { tenantId: string; userId: string };

export type ApprovalOutcomeEvent = {
  tx: Tx;
  request: typeof approvalRequests.$inferSelect;
  actor: ApprovalActor;
  comment: string | null;
};

export type ApprovalHandler = {
  /** Link shown in inbox and notifications. */
  href: (subjectId: string) => string;
  label: string;
  onApproved?: (e: ApprovalOutcomeEvent) => Promise<void>;
  onRejected?: (e: ApprovalOutcomeEvent) => Promise<void>;
  onCancelled?: (e: ApprovalOutcomeEvent) => Promise<void>;
};

const handlers = new Map<string, ApprovalHandler>();

export function registerApprovalHandler(subjectType: string, handler: ApprovalHandler) {
  handlers.set(subjectType, handler);
}

export const approvalHandler = (subjectType: string) => handlers.get(subjectType);

/* ------------------------------------------------------------------ */
/* Policy selection and approver resolution                            */
/* ------------------------------------------------------------------ */

export type ApprovalSubjectContext = {
  /** Values policies can match on, e.g. { departmentId, amount, leaveTypeCode }. */
  [key: string]: string | number | boolean | null | undefined;
};

function matches(conditions: Record<string, unknown>, ctx: ApprovalSubjectContext) {
  return Object.entries(conditions).every(([key, expected]) => {
    const actual = ctx[key];
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      const c = expected as { gte?: number; lte?: number; in?: unknown[] };
      if (c.in && !c.in.includes(actual)) return false;
      if (c.gte != null && !(typeof actual === "number" && actual >= c.gte)) return false;
      if (c.lte != null && !(typeof actual === "number" && actual <= c.lte)) return false;
      return true;
    }
    return actual === expected;
  });
}

async function selectPolicy(tx: Tx, tenantId: string, subjectType: string, ctx: ApprovalSubjectContext) {
  const policies = await tx
    .select()
    .from(approvalPolicies)
    .where(and(eq(approvalPolicies.tenantId, tenantId), eq(approvalPolicies.subjectType, subjectType), eq(approvalPolicies.isActive, true)))
    .orderBy(desc(approvalPolicies.priority), asc(approvalPolicies.createdAt));
  return policies.find((p) => matches(p.conditions, ctx)) ?? null;
}

/** Approvers if a step cannot be resolved (no manager, vacant head, ...). */
const FALLBACK_ROLES = ["hr_admin", "tenant_owner"];

async function resolveApprovers(
  tx: Tx,
  tenantId: string,
  step: ApprovalStepDefinition,
  subjectEmployeeId: string | null,
  requesterUserId: string,
  subjectType: string,
): Promise<{ userIds: string[]; roleKey: string | null }> {
  let userIds: string[] = [];
  let roleKey: string | null = null;
  switch (step.approver.kind) {
    case "manager": {
      const u = await userIdForEmployee(tx, await managerOf(tx, subjectEmployeeId));
      if (u) userIds = [u];
      break;
    }
    case "manager_of_manager": {
      const u = await userIdForEmployee(tx, await managerOf(tx, await managerOf(tx, subjectEmployeeId)));
      if (u) userIds = [u];
      break;
    }
    case "department_head": {
      const u = await userIdForEmployee(tx, await departmentHeadOf(tx, subjectEmployeeId));
      if (u) userIds = [u];
      break;
    }
    case "role":
      roleKey = step.approver.roleKey;
      userIds = await userIdsWithRoles(tx, tenantId, [step.approver.roleKey]);
      break;
    case "user":
      userIds = [step.approver.userId];
      break;
  }
  // Nobody approves their own request.
  userIds = userIds.filter((u) => u !== requesterUserId);
  if (!userIds.length) {
    roleKey = roleKey ?? FALLBACK_ROLES[0];
    userIds = (await userIdsWithRoles(tx, tenantId, FALLBACK_ROLES)).filter((u) => u !== requesterUserId);
  }
  // Last resort: the only admin is the requester (tiny orgs). Allow, but it is audited.
  if (!userIds.length) userIds = (await userIdsWithRoles(tx, tenantId, FALLBACK_ROLES)).slice(0, 1);
  userIds = await withDelegates(tx, tenantId, userIds, subjectType, todayIn());
  return { userIds, roleKey };
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export type StartApprovalInput = {
  subjectType: string;
  subjectId: string;
  title: string;
  requestedBy: string;
  /** Employee the request concerns; drives manager / department head resolution. */
  subjectEmployeeId: string | null;
  context?: ApprovalSubjectContext;
};

async function activateStep(
  tx: Tx,
  actor: ApprovalActor,
  request: typeof approvalRequests.$inferSelect,
  stepNo: number,
  steps: ApprovalStepDefinition[],
) {
  const def = steps[stepNo - 1];
  const { userIds, roleKey } = await resolveApprovers(
    tx,
    actor.tenantId,
    def,
    request.requestedForEmployeeId,
    request.requestedBy,
    request.subjectType,
  );
  await tx.insert(approvalSteps).values({
    tenantId: actor.tenantId,
    requestId: request.id,
    stepNo,
    name: def.name,
    approverUserIds: userIds,
    approverRoleKey: roleKey,
    dueAt: def.escalateAfterHours ? addHours(new Date(), def.escalateAfterHours) : null,
  });
  const h = approvalHandler(request.subjectType);
  await notify(tx, {
    tenantId: actor.tenantId,
    userIds,
    category: "approval",
    title: `Approval needed: ${request.title}`,
    body: `${h?.label ?? "Request"} · step ${stepNo} of ${steps.length}: ${def.name}`,
    href: `/inbox?tab=approvals&request=${request.id}`,
    dedupeKey: `approval:${request.id}:${stepNo}`,
  });
}

/**
 * Open an approval for a subject. Picks the first matching active policy and
 * activates step 1. Throws CONFLICT if the subject already has a pending one
 * (enforced by a partial unique index).
 */
export async function startApproval(tx: Tx, actor: ApprovalActor, input: StartApprovalInput) {
  const policy = await selectPolicy(tx, actor.tenantId, input.subjectType, input.context ?? {});
  if (!policy || !policy.steps.length) {
    throw new AppError("PRECONDITION", `No approval policy is configured for ${input.subjectType.replace(/_/g, " ")}.`);
  }
  const [request] = await tx
    .insert(approvalRequests)
    .values({
      tenantId: actor.tenantId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      policyId: policy.id,
      policyVersion: policy.version,
      title: input.title,
      requestedBy: input.requestedBy,
      requestedForEmployeeId: input.subjectEmployeeId,
    })
    .returning();
  await activateStep(tx, actor, request, 1, policy.steps);
  await audit(tx, actor, {
    action: "approval.requested",
    entityType: input.subjectType,
    entityId: input.subjectId,
    metadata: { requestId: request.id, policy: policy.name },
  });
  return request;
}

export type Decision = "approve" | "reject";

/**
 * Record a decision on the active step. Approval of the last step (or any
 * rejection) settles the request and calls the subject's handler inside the
 * same transaction, so the subject never disagrees with its approval.
 */
export async function decideApproval(
  tx: Tx,
  actor: ApprovalActor,
  requestId: string,
  decision: Decision,
  comment: string | null,
) {
  const [request] = await tx
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.tenantId, actor.tenantId)))
    .for("update");
  if (!request) throw notFound("Approval request");
  if (request.status !== "pending") throw invalidState("This request has already been decided.");

  const [step] = await tx
    .select()
    .from(approvalSteps)
    .where(and(eq(approvalSteps.requestId, requestId), eq(approvalSteps.stepNo, request.currentStep)))
    .for("update");
  if (!step || step.status !== "pending") throw invalidState("This step is no longer pending.");
  if (!step.approverUserIds.includes(actor.userId)) throw forbidden("You are not an approver for this step.");
  if (decision === "reject" && !comment?.trim()) {
    throw new AppError("VALIDATION", "Add a comment explaining the rejection.", { fieldErrors: { comment: ["Required when rejecting"] } });
  }

  const now = new Date();
  await tx
    .update(approvalSteps)
    .set({ status: decision === "approve" ? "approved" : "rejected", decidedBy: actor.userId, decidedAt: now, comment })
    .where(eq(approvalSteps.id, step.id));

  const handler = approvalHandler(request.subjectType);
  const policy = request.policyId
    ? (await tx.select().from(approvalPolicies).where(eq(approvalPolicies.id, request.policyId)))[0]
    : null;
  const totalSteps = policy?.steps.length ?? request.currentStep;

  let settled: typeof request | null = null;
  if (decision === "reject") {
    [settled] = await tx
      .update(approvalRequests)
      .set({ status: "rejected", decidedAt: now })
      .where(eq(approvalRequests.id, requestId))
      .returning();
    await handler?.onRejected?.({ tx, request: settled, actor, comment });
  } else if (request.currentStep < totalSteps && policy) {
    const [advanced] = await tx
      .update(approvalRequests)
      .set({ currentStep: request.currentStep + 1 })
      .where(eq(approvalRequests.id, requestId))
      .returning();
    await activateStep(tx, actor, advanced, advanced.currentStep, policy.steps);
  } else {
    [settled] = await tx
      .update(approvalRequests)
      .set({ status: "approved", decidedAt: now })
      .where(eq(approvalRequests.id, requestId))
      .returning();
    await handler?.onApproved?.({ tx, request: settled, actor, comment });
  }

  await audit(tx, actor, {
    action: decision === "approve" ? "approval.step_approved" : "approval.rejected",
    entityType: request.subjectType,
    entityId: request.subjectId,
    metadata: { requestId, step: request.currentStep, comment: comment ?? undefined },
  });

  if (settled) {
    await notify(tx, {
      tenantId: actor.tenantId,
      userIds: [request.requestedBy],
      category: "approval",
      title: `${request.title} was ${settled.status}`,
      body: comment ? `Comment: ${comment.slice(0, 140)}` : null,
      href: handler ? handler.href(request.subjectId) : "/inbox?tab=requests",
      dedupeKey: `approval:${request.id}:settled`,
    });
  }
  return settled ?? request;
}

/** Withdraw a pending request (requester only, or an admin). */
export async function cancelApproval(tx: Tx, actor: ApprovalActor, requestId: string, opts: { asAdmin?: boolean } = {}) {
  const [request] = await tx
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.tenantId, actor.tenantId)))
    .for("update");
  if (!request) throw notFound("Approval request");
  if (request.status !== "pending") throw invalidState("Only pending requests can be withdrawn.");
  if (request.requestedBy !== actor.userId && !opts.asAdmin) throw forbidden();
  const [settled] = await tx
    .update(approvalRequests)
    .set({ status: "cancelled", decidedAt: new Date() })
    .where(eq(approvalRequests.id, requestId))
    .returning();
  await tx
    .update(approvalSteps)
    .set({ status: "cancelled" })
    .where(and(eq(approvalSteps.requestId, requestId), eq(approvalSteps.status, "pending")));
  await approvalHandler(request.subjectType)?.onCancelled?.({ tx, request: settled, actor, comment: null });
  await audit(tx, actor, { action: "approval.cancelled", entityType: request.subjectType, entityId: request.subjectId, metadata: { requestId } });
  return settled;
}

/** Cancel the open approval for a subject, if any (e.g. the subject itself was withdrawn). */
export async function cancelApprovalForSubject(tx: Tx, actor: ApprovalActor, subjectType: string, subjectId: string) {
  const [open] = await tx
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.tenantId, actor.tenantId),
        eq(approvalRequests.subjectType, subjectType),
        eq(approvalRequests.subjectId, subjectId),
        eq(approvalRequests.status, "pending"),
      ),
    );
  if (open) await cancelApproval(tx, actor, open.id, { asAdmin: true });
}

/**
 * Escalate overdue steps: add the fallback approvers and notify them. Run by
 * the scheduler; idempotent because escalated steps are marked.
 */
export async function escalateOverdueSteps(tx: Tx, tenantId: string) {
  const overdue = await tx
    .select({ step: approvalSteps, request: approvalRequests })
    .from(approvalSteps)
    .innerJoin(approvalRequests, eq(approvalRequests.id, approvalSteps.requestId))
    .where(
      and(
        eq(approvalSteps.tenantId, tenantId),
        eq(approvalSteps.status, "pending"),
        sql`${approvalSteps.dueAt} < now()`,
        sql`${approvalSteps.escalatedAt} is null`,
      ),
    )
    .limit(200);
  for (const { step, request } of overdue) {
    const fallback = await userIdsWithRoles(tx, tenantId, FALLBACK_ROLES);
    const merged = [...new Set([...step.approverUserIds, ...fallback])].filter((u) => u !== request.requestedBy);
    await tx.update(approvalSteps).set({ approverUserIds: merged, escalatedAt: new Date() }).where(eq(approvalSteps.id, step.id));
    await notify(tx, {
      tenantId,
      userIds: merged,
      category: "approval",
      title: `Overdue approval: ${request.title}`,
      body: `Step "${step.name}" passed its response time and was escalated.`,
      href: `/inbox?tab=approvals&request=${request.id}`,
      dedupeKey: `approval:${request.id}:${step.stepNo}:escalated`,
    });
  }
  return overdue.length;
}

export async function stepsFor(tx: Tx, requestIds: string[]) {
  if (!requestIds.length) return [];
  return tx.select().from(approvalSteps).where(inArray(approvalSteps.requestId, requestIds)).orderBy(asc(approvalSteps.stepNo));
}
