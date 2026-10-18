import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { addDays, format, parseISO } from "date-fns";
import type { Tx } from "../../db/client";
import {
  assetAssignments,
  documents,
  employees,
  exitCases,
  lifecyclePlans,
  membershipRoles,
  memberships,
  policies,
  policyAcknowledgements,
  roles,
  tasks,
} from "../../db/schema";
import { audit, type AuditActor } from "../../lib/audit";
import { notify } from "../notifications";
import { emitDomainEvent } from "../events";
import { todayIn } from "@/lib/format";
import { DOCUMENT_CATEGORY_LABELS, type DocumentCategory } from "@/lib/validation/documents";
import type { OwnerGroup, TaskCode } from "@/lib/validation/lifecycle";

/** `tasks.container_type` for every onboarding/offboarding task. */
export const PLAN_CONTAINER = "lifecycle_plan";

export type CheckinEntry = { by: string; byName: string | null; at: string; settlingIn: number; note: string; followUps: string | null };

export type SettlementInputs = {
  noticeRecoveryDays: number;
  noticePayInLieuDays: number;
  leaveEncashmentDays: number;
  /** Paise. */
  otherRecoveries: number;
  otherRecoveriesNote: string | null;
  /** Paise. */
  otherPayments: number;
  otherPaymentsNote: string | null;
  notes: string | null;
  leaveSnapshot: { leaveTypeId: string; code: string; name: string; balance: number; pending: number }[];
  savedBy: string;
  savedAt: string;
};

/** Shape of `tasks.config` for lifecycle tasks. */
export type TaskConfig = {
  templateTaskId?: string;
  required?: boolean;
  documentCategory?: DocumentCategory;
  policyId?: string;
  checkinDay?: number;
  formTarget?: string;
  code?: TaskCode;
  anchor?: "probation_end";
  /** Why the task has no assignee yet (e.g. the employee has no login). */
  assigneeNote?: string | null;
  waived?: { reason: string; by: string; at: string };
  checkin?: { manager?: CheckinEntry; employee?: CheckinEntry };
  confirmation?: { by: string; at: string; note: string };
  settlementInputs?: SettlementInputs;
  letters?: { experience?: string; relieving?: string };
  escalatedOn?: string;
};

export type TaskRow = typeof tasks.$inferSelect;
export type PlanRow = typeof lifecyclePlans.$inferSelect;

export const cfg = (t: Pick<TaskRow, "config">) => (t.config ?? {}) as TaskConfig;
export const isRequired = (t: Pick<TaskRow, "config">) => cfg(t).required !== false;
export const isWaived = (t: Pick<TaskRow, "status" | "config">) => t.status === "cancelled" && !!cfg(t).waived;
export const isSettled = (t: Pick<TaskRow, "status" | "config">) => t.status === "done" || isWaived(t);
export const OPEN_TASK_STATUSES = ["open", "in_progress", "blocked"] as const;

export const shiftDate = (iso: string, days: number) => format(addDays(parseISO(iso), days), "yyyy-MM-dd");
export const daysBetween = (from: string, to: string) =>
  Math.round((parseISO(to).getTime() - parseISO(from).getTime()) / 86_400_000);

/* ------------------------------------------------------------------ */
/* Owner resolution                                                    */
/* ------------------------------------------------------------------ */

/** Earliest active member holding a built-in role (deterministic "first"). */
export async function firstUserWithRole(tx: Tx, tenantId: string, roleKey: string, exclude: (string | null)[] = []) {
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(membershipRoles)
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
    .where(and(eq(roles.tenantId, tenantId), eq(roles.key, roleKey), eq(memberships.status, "active")))
    .orderBy(asc(memberships.createdAt))
    .limit(10);
  return rows.map((r) => r.userId).find((u) => !exclude.includes(u)) ?? null;
}

/** Earliest active member whose roles grant `permission` (any scope). */
export async function firstUserWithPermission(tx: Tx, tenantId: string, permission: string, exclude: (string | null)[] = []) {
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(membershipRoles)
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
    .where(
      and(
        eq(roles.tenantId, tenantId),
        eq(memberships.status, "active"),
        sql`exists (select 1 from unnest(${roles.permissions}) p where p like ${permission + ":%"})`,
      ),
    )
    .orderBy(asc(memberships.createdAt))
    .limit(10);
  return rows.map((r) => r.userId).find((u) => !exclude.includes(u)) ?? null;
}

/** HR administrators to notify; falls back to the tenant owners. */
export async function hrUserIds(tx: Tx, tenantId: string) {
  const rows = await tx
    .selectDistinct({ userId: memberships.userId, key: roles.key })
    .from(membershipRoles)
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
    .where(and(eq(roles.tenantId, tenantId), inArray(roles.key, ["hr_admin", "tenant_owner"]), eq(memberships.status, "active")));
  const hr = rows.filter((r) => r.key === "hr_admin").map((r) => r.userId);
  return [...new Set(hr.length ? hr : rows.map((r) => r.userId))];
}

export type SubjectEmployee = Pick<typeof employees.$inferSelect, "id" | "userId" | "managerId" | "displayName">;

/** Resolve the assignee for an owner group, or explain why the task is unassigned. */
export async function resolveAssignee(
  tx: Tx,
  tenantId: string,
  group: string,
  employee: SubjectEmployee,
  buddyEmployeeId: string | null,
): Promise<{ userId: string | null; note: string | null }> {
  const userOf = async (employeeId: string | null) => {
    if (!employeeId) return null;
    const [row] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, employeeId));
    return row?.userId ?? null;
  };
  const exclude = [employee.userId];
  switch (group as OwnerGroup) {
    case "manager": {
      if (!employee.managerId) return { userId: null, note: "No reporting manager set — assign someone." };
      const u = await userOf(employee.managerId);
      return u ? { userId: u, note: null } : { userId: null, note: "The manager has no login yet — assign someone." };
    }
    case "employee":
      return employee.userId ? { userId: employee.userId, note: null } : { userId: null, note: "Invite pending — assigned once the employee has a login." };
    case "buddy": {
      if (!buddyEmployeeId) return { userId: null, note: "No buddy chosen yet." };
      const u = await userOf(buddyEmployeeId);
      return u ? { userId: u, note: null } : { userId: null, note: "The buddy has no login yet." };
    }
    case "hr": {
      const u = await firstUserWithRole(tx, tenantId, "hr_admin", exclude);
      return u ? { userId: u, note: null } : { userId: null, note: "Unassigned HR queue." };
    }
    case "it": {
      const u = await firstUserWithPermission(tx, tenantId, "assets.manage", exclude);
      return u ? { userId: u, note: null } : { userId: null, note: "Unassigned IT queue." };
    }
    case "finance": {
      const u = await firstUserWithRole(tx, tenantId, "finance_manager", exclude);
      return u ? { userId: u, note: null } : { userId: null, note: "Unassigned finance queue." };
    }
    default:
      return { userId: null, note: "Unassigned." };
  }
}

/* ------------------------------------------------------------------ */
/* Evidence: what must exist before a task may be marked done          */
/* ------------------------------------------------------------------ */

/** Published policies requiring acknowledgement that the employee has not acknowledged (current version). */
export async function pendingPoliciesFor(tx: Tx, employeeId: string) {
  return tx
    .select({ id: policies.id, title: policies.title, version: policies.version })
    .from(policies)
    .where(
      and(
        eq(policies.status, "published"),
        eq(policies.requiresAcknowledgement, true),
        sql`not exists (
          select 1 from ${policyAcknowledgements} a
          where a.policy_id = "policies"."id" and a.policy_version = "policies"."version" and a.employee_id = ${employeeId}
        )`,
      ),
    )
    .orderBy(asc(policies.title))
    .limit(50);
}

export async function requiredPolicyCount(tx: Tx) {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(policies)
    .where(and(eq(policies.status, "published"), eq(policies.requiresAcknowledgement, true)));
  return n;
}

export async function documentExists(tx: Tx, employeeId: string, category: string) {
  const [row] = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.ownerType, "employee"),
        eq(documents.employeeId, employeeId),
        eq(documents.category, category as DocumentCategory),
        eq(documents.isCurrent, true),
        isNull(documents.deletedAt),
        sql`${documents.scanStatus} <> 'infected'`,
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

export async function openAssetCount(tx: Tx, employeeId: string) {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(assetAssignments)
    .where(and(eq(assetAssignments.employeeId, employeeId), isNull(assetAssignments.returnedOn)));
  return n;
}

/**
 * Returns null when the task's completion evidence exists, otherwise a
 * user-facing explanation. Used by the inbox hook, the plan views and the
 * reconciler, so every path enforces the same rule.
 */
export async function missingEvidence(tx: Tx, task: TaskRow, plan: Pick<PlanRow, "exitCaseId" | "employeeId">): Promise<string | null> {
  const c = cfg(task);
  const employeeId = task.subjectEmployeeId ?? plan.employeeId;
  if (task.kind === "document_upload") {
    const category = c.documentCategory ?? "other";
    if (!(await documentExists(tx, employeeId, category))) {
      return `Upload the ${DOCUMENT_CATEGORY_LABELS[category]?.toLowerCase() ?? category} document to complete this task.`;
    }
  }
  if (task.kind === "acknowledgement") {
    if (c.policyId) {
      const [p] = await tx.select({ id: policies.id, version: policies.version, status: policies.status }).from(policies).where(eq(policies.id, c.policyId));
      if (p && p.status === "published") {
        const [ack] = await tx
          .select({ id: policyAcknowledgements.id })
          .from(policyAcknowledgements)
          .where(and(eq(policyAcknowledgements.policyId, p.id), eq(policyAcknowledgements.policyVersion, p.version), eq(policyAcknowledgements.employeeId, employeeId)));
        if (!ack) return "The employee must acknowledge the policy to complete this task.";
      }
    } else {
      const pending = await pendingPoliciesFor(tx, employeeId);
      if (pending.length) return `The employee still has ${pending.length} ${pending.length === 1 ? "policy" : "policies"} to acknowledge.`;
    }
  }
  if (task.kind === "checkin" && !c.checkin?.manager) return "Record the check-in notes to complete this task.";
  switch (c.code) {
    case "asset_return": {
      const n = await openAssetCount(tx, employeeId);
      if (n) return `${n} ${n === 1 ? "asset is" : "assets are"} still assigned. Record the returns first.`;
      break;
    }
    case "access_revocation":
      if (!c.confirmation) return "Access revocation must be confirmed by IT or an administrator from the exit workspace.";
      break;
    case "exit_interview": {
      if (plan.exitCaseId) {
        const [ec] = await tx.select({ interview: exitCases.exitInterview }).from(exitCases).where(eq(exitCases.id, plan.exitCaseId));
        if (!ec?.interview) return "Record the exit interview in the exit workspace to complete this task.";
      }
      break;
    }
    case "settlement_inputs":
      if (!c.settlementInputs) return "Save the settlement inputs in the exit workspace to complete this task.";
      break;
    case "letters":
      if (!c.letters?.experience && !c.letters?.relieving) return "Generate the exit letters in the exit workspace to complete this task.";
      break;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

export type LifecycleActor = AuditActor & { tenantId: string; userId: string | null };

export function progressOf(rows: Pick<TaskRow, "status" | "config">[]) {
  const required = rows.filter(isRequired);
  const base = required.length ? required : rows;
  const settled = base.filter(isSettled).length;
  return {
    total: base.length,
    settled,
    percent: base.length ? Math.round((settled / base.length) * 100) : 100,
    allSettled: base.length > 0 && settled === base.length,
    anyProgress: rows.some((t) => t.status === "done" || t.status === "in_progress" || isWaived(t)),
  };
}

/**
 * Recalculate a plan's progress and status from its tasks. Completing a plan
 * notifies the manager and HR and emits a domain event exactly once; a task
 * reopened afterwards moves the plan back to in progress.
 */
export async function recalcPlan(tx: Tx, actor: LifecycleActor, planId: string) {
  const [plan] = await tx.select().from(lifecyclePlans).where(eq(lifecyclePlans.id, planId)).for("update");
  if (!plan) return null;
  const rows = await tx
    .select({ status: tasks.status, config: tasks.config })
    .from(tasks)
    .where(and(eq(tasks.containerType, PLAN_CONTAINER), eq(tasks.containerId, plan.id)));
  const p = progressOf(rows);
  if (plan.status === "cancelled") {
    await tx.update(lifecyclePlans).set({ progressPercent: p.percent }).where(eq(lifecyclePlans.id, plan.id));
    return { ...plan, progressPercent: p.percent };
  }
  const status = p.allSettled ? "completed" : p.anyProgress ? "in_progress" : "not_started";
  const completing = status === "completed" && plan.status !== "completed";
  const [updated] = await tx
    .update(lifecyclePlans)
    .set({
      progressPercent: p.percent,
      status,
      completedAt: status === "completed" ? (plan.completedAt ?? new Date()) : null,
    })
    .where(eq(lifecyclePlans.id, plan.id))
    .returning();

  if (plan.kind === "offboarding" && plan.exitCaseId && p.anyProgress) {
    await tx
      .update(exitCases)
      .set({ status: "in_progress" })
      .where(and(eq(exitCases.id, plan.exitCaseId), eq(exitCases.status, "accepted")));
  }
  if (completing) await onPlanCompleted(tx, actor, updated);
  return updated;
}

async function onPlanCompleted(tx: Tx, actor: LifecycleActor, plan: PlanRow) {
  const [emp] = await tx
    .select({ id: employees.id, name: employees.displayName, status: employees.status, joiningDate: employees.joiningDate, managerId: employees.managerId })
    .from(employees)
    .where(eq(employees.id, plan.employeeId));
  if (!emp) return;
  const hr = await hrUserIds(tx, actor.tenantId);
  const managerUser = emp.managerId
    ? ((await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, emp.managerId)))[0]?.userId ?? null)
    : null;
  const recipients = [...hr, managerUser].filter((u): u is string => !!u);

  await audit(tx, actor, { action: `${plan.kind}.plan_completed`, entityType: "lifecycle_plan", entityId: plan.id, metadata: { employeeId: emp.id } });
  if (plan.kind === "onboarding") {
    await notify(tx, {
      tenantId: actor.tenantId,
      userIds: recipients,
      category: "onboarding",
      title: `Onboarding complete: ${emp.name}`,
      body: "Every required onboarding task is done.",
      href: `/onboarding/plans/${plan.id}`,
      dedupeKey: `onboarding-complete:${plan.id}`,
    });
    await emitDomainEvent(tx, actor.tenantId, "onboarding.completed", { planId: plan.id, employeeId: emp.id }, { dedupeKey: `onboarding-complete:${plan.id}` });
    if (emp.status === "pending" && emp.joiningDate <= todayIn()) {
      await notify(tx, {
        tenantId: actor.tenantId,
        userIds: hr,
        category: "onboarding",
        title: `Mark ${emp.name} as joined`,
        body: "Onboarding is complete and the joining date has passed. Confirm the joining to activate the employee.",
        href: `/onboarding/plans/${plan.id}`,
        dedupeKey: `onboarding-mark-joined:${plan.id}`,
      });
    }
  } else {
    await notify(tx, {
      tenantId: actor.tenantId,
      userIds: recipients,
      category: "exits",
      title: `Offboarding checklist complete: ${emp.name}`,
      body: "All required exit tasks are done. HR can now complete the exit.",
      href: plan.exitCaseId ? `/onboarding/exits/${plan.exitCaseId}` : `/onboarding?tab=exits`,
      dedupeKey: `offboarding-complete:${plan.id}`,
    });
    await emitDomainEvent(tx, actor.tenantId, "offboarding.completed", { planId: plan.id, employeeId: emp.id, exitCaseId: plan.exitCaseId }, { dedupeKey: `offboarding-complete:${plan.id}` });
  }
}

/** Mark a task done (evidence already verified by the caller) and recalculate its plan. */
export async function completeTask(tx: Tx, actor: LifecycleActor, task: TaskRow, opts: { auto?: boolean; config?: TaskConfig } = {}) {
  const [updated] = await tx
    .update(tasks)
    .set({ status: "done", completedAt: new Date(), completedBy: actor.userId, ...(opts.config ? { config: opts.config } : {}) })
    .where(eq(tasks.id, task.id))
    .returning();
  await audit(tx, actor, {
    action: "task.done",
    entityType: "task",
    entityId: task.id,
    metadata: { title: task.title, auto: opts.auto ?? false },
  });
  if (task.containerId) await recalcPlan(tx, actor, task.containerId);
  return updated;
}

/**
 * Bring tasks in line with the evidence that exists: auto-complete document,
 * acknowledgement and asset-return tasks whose evidence is present, and
 * assign employee/buddy tasks once those people have a login. Idempotent.
 */
export async function reconcilePlans(tx: Tx, actor: LifecycleActor, planIds?: string[]) {
  const plans = await tx
    .select()
    .from(lifecyclePlans)
    .where(
      and(
        eq(lifecyclePlans.tenantId, actor.tenantId),
        inArray(lifecyclePlans.status, ["not_started", "in_progress"]),
        planIds ? (planIds.length ? inArray(lifecyclePlans.id, planIds) : sql`false`) : undefined,
      ),
    )
    .limit(500);
  let completed = 0;
  let assigned = 0;
  if (!plans.length) return { completed, assigned };
  const requiredPolicies = await requiredPolicyCount(tx);
  for (const plan of plans) {
    const open = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.containerType, PLAN_CONTAINER), eq(tasks.containerId, plan.id), inArray(tasks.status, [...OPEN_TASK_STATUSES])));
    if (!open.length) continue;
    const [emp] = await tx
      .select({ id: employees.id, userId: employees.userId, managerId: employees.managerId, displayName: employees.displayName })
      .from(employees)
      .where(eq(employees.id, plan.employeeId));
    let changed = false;
    for (const t of open) {
      const c = cfg(t);
      if (!t.assigneeUserId && emp && (t.ownerGroup === "employee" || t.ownerGroup === "buddy" || t.ownerGroup === "manager")) {
        const r = await resolveAssignee(tx, actor.tenantId, t.ownerGroup, emp, plan.buddyEmployeeId);
        if (r.userId) {
          await tx.update(tasks).set({ assigneeUserId: r.userId, config: { ...c, assigneeNote: null } }).where(eq(tasks.id, t.id));
          assigned++;
        }
      }
      const auto =
        t.kind === "document_upload" ||
        (t.kind === "acknowledgement" && (!!c.policyId || requiredPolicies > 0)) ||
        c.code === "asset_return";
      if (!auto) continue;
      if (await missingEvidence(tx, t, plan)) continue;
      await tx.update(tasks).set({ status: "done", completedAt: new Date(), completedBy: actor.userId }).where(eq(tasks.id, t.id));
      await audit(tx, actor, { action: "task.done", entityType: "task", entityId: t.id, metadata: { title: t.title, auto: true } });
      completed++;
      changed = true;
    }
    if (changed) await recalcPlan(tx, actor, plan.id);
  }
  return { completed, assigned };
}
