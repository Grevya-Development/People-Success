import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { withSystem } from "../../db/tx";
import { employees, lifecyclePlans, tasks } from "../../db/schema";
import { onDomainEvent, registerJobHandler, registerSchedule } from "../../jobs/registry";
import { notify } from "../notifications";
import { todayIn } from "@/lib/format";
import { autoStartOnboarding } from "./plans";
import { OPEN_TASK_STATUSES, PLAN_CONTAINER, cfg, hrUserIds, reconcilePlans, shiftDate, type LifecycleActor } from "./shared";
import "./approval-handlers";

/* ------------------------------------------------------------------ */
/* Auto-start onboarding for new hires                                 */
/* ------------------------------------------------------------------ */

/** Recruitment emits this after creating the pending employee for an accepted offer. */
export async function onOfferAccepted(tenantId: string, event: Record<string, unknown>) {
  const employeeId = typeof event.employeeId === "string" ? event.employeeId : null;
  if (!employeeId) return { skipped: "no employee" };
  return autoStartOnboarding(tenantId, employeeId, "offer.accepted");
}

/** Employees created from an offer also start onboarding (whichever event arrives first wins). */
export async function onEmployeeCreated(tenantId: string, event: Record<string, unknown>) {
  if (event.source !== "offer" || typeof event.employeeId !== "string") return { skipped: "not from an offer" };
  return autoStartOnboarding(tenantId, event.employeeId, "employee.created");
}

onDomainEvent("offer.accepted", async (tenantId, event) => {
  await onOfferAccepted(tenantId, event);
});
onDomainEvent("employee.created", async (tenantId, event) => {
  await onEmployeeCreated(tenantId, event);
});

/* ------------------------------------------------------------------ */
/* Reminders and escalation                                            */
/* ------------------------------------------------------------------ */

export const ESCALATE_AFTER_DAYS = 3;

/**
 * Daily: remind assignees of overdue lifecycle tasks (once per task per day)
 * and escalate tasks overdue for 3+ days to HR (once per task). Unassigned
 * overdue tasks go to HR straight away.
 */
export async function runLifecycleReminders(tenantId: string, today = todayIn()) {
  return withSystem(async (tx) => {
    const overdue = await tx
      .select({ task: tasks, employeeName: employees.displayName, kind: lifecyclePlans.kind, planId: lifecyclePlans.id, exitCaseId: lifecyclePlans.exitCaseId })
      .from(tasks)
      .innerJoin(lifecyclePlans, eq(lifecyclePlans.id, tasks.containerId))
      .innerJoin(employees, eq(employees.id, lifecyclePlans.employeeId))
      .where(
        and(
          eq(tasks.tenantId, tenantId),
          eq(tasks.containerType, PLAN_CONTAINER),
          inArray(tasks.status, [...OPEN_TASK_STATUSES]),
          isNotNull(tasks.dueOn),
          lt(tasks.dueOn, today),
          inArray(lifecyclePlans.status, ["not_started", "in_progress"]),
        ),
      )
      .limit(2000);
    if (!overdue.length) return { reminded: 0, escalated: 0 };
    const hr = await hrUserIds(tx, tenantId);
    const escalateBefore = shiftDate(today, -ESCALATE_AFTER_DAYS);
    let reminded = 0;
    let escalated = 0;
    for (const { task, employeeName, kind, planId, exitCaseId } of overdue) {
      const href = kind === "offboarding" && exitCaseId ? `/onboarding/exits/${exitCaseId}` : `/onboarding/plans/${planId}`;
      const label = kind === "onboarding" ? "Onboarding" : "Exit";
      if (task.assigneeUserId) {
        await notify(tx, {
          tenantId,
          userIds: [task.assigneeUserId],
          category: kind === "onboarding" ? "onboarding" : "exits",
          title: `Overdue: ${task.title}`,
          body: `${label} task for ${employeeName} was due ${task.dueOn}.`,
          href: "/inbox?tab=tasks",
          dedupeKey: `lifecycle-overdue:${task.id}:${today}`,
        });
        reminded++;
      }
      const shouldEscalate = !task.assigneeUserId || (task.dueOn! <= escalateBefore);
      if (shouldEscalate && !cfg(task).escalatedOn) {
        await notify(tx, {
          tenantId,
          userIds: hr,
          category: kind === "onboarding" ? "onboarding" : "exits",
          title: `Escalated: ${task.title}`,
          body: `${label} task for ${employeeName} is overdue since ${task.dueOn}${task.assigneeUserId ? "" : " and has no assignee"}.`,
          href,
          dedupeKey: `lifecycle-escalated:${task.id}`,
        });
        await tx.update(tasks).set({ config: { ...cfg(task), escalatedOn: today } }).where(eq(tasks.id, task.id));
        escalated++;
      }
    }
    return { reminded, escalated };
  }, tenantId);
}

registerJobHandler("lifecycle.reminders", async (job) => {
  if (!job.tenantId) return;
  return runLifecycleReminders(job.tenantId);
});
registerSchedule({ name: "lifecycle.reminders", every: { dailyAtIst: "09:30" }, perTenant: true, jobType: "lifecycle.reminders" });

/** Evidence uploaded or acknowledged elsewhere (documents page, policies page) completes tasks; new logins get their tasks. */
registerJobHandler("lifecycle.reconcile", async (job) => {
  if (!job.tenantId) return;
  const tenantId = job.tenantId;
  return withSystem(async (tx) => {
    const actor: LifecycleActor = { tenantId, userId: null, actorType: "system" };
    // Only plans with open tasks that can change on their own.
    const candidates = await tx
      .selectDistinct({ id: lifecyclePlans.id })
      .from(lifecyclePlans)
      .innerJoin(tasks, and(eq(tasks.containerType, PLAN_CONTAINER), eq(tasks.containerId, lifecyclePlans.id)))
      .where(
        and(
          eq(lifecyclePlans.tenantId, tenantId),
          inArray(lifecyclePlans.status, ["not_started", "in_progress"]),
          inArray(tasks.status, [...OPEN_TASK_STATUSES]),
          sql`(${tasks.kind} in ('document_upload','acknowledgement') or ${tasks.config}->>'code' = 'asset_return' or ${isNull(tasks.assigneeUserId)})`,
        ),
      )
      .limit(500);
    return reconcilePlans(tx, actor, candidates.map((c) => c.id));
  }, tenantId);
});
registerSchedule({ name: "lifecycle.reconcile", every: { minutes: 15 }, perTenant: true, jobType: "lifecycle.reconcile" });
