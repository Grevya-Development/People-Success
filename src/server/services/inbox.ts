import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { RequestContext } from "../auth/context";
import { can } from "../auth/context";
import { approvalRequests, approvalSteps, employees, tasks, users } from "../db/schema";
import { approvalHandler, cancelApproval, decideApproval, stepsFor } from "./approvals/engine";
import "./approvals/handlers";
import { audit } from "../lib/audit";
import { taskHookFor } from "./task-hooks";
import { forbidden, invalidState, notFound } from "../lib/errors";

export type InboxApproval = {
  requestId: string;
  subjectType: string;
  subjectLabel: string;
  title: string;
  href: string;
  status: string;
  currentStep: number;
  requestedByName: string | null;
  requestedForName: string | null;
  createdAt: string;
  steps: { stepNo: number; name: string; status: string; decidedAt: string | null; comment: string | null; approverCount: number }[];
  canDecide: boolean;
  canCancel: boolean;
};

async function hydrate(ctx: RequestContext, rows: (typeof approvalRequests.$inferSelect)[]): Promise<InboxApproval[]> {
  if (!rows.length) return [];
  return ctx.db(async (tx) => {
    const steps = await stepsFor(tx, rows.map((r) => r.id));
    const userIds = [...new Set(rows.map((r) => r.requestedBy))];
    const empIds = [...new Set(rows.map((r) => r.requestedForEmployeeId).filter(Boolean) as string[])];
    const [people, emps] = await Promise.all([
      userIds.length ? tx.select({ id: users.id, name: users.fullName, email: users.email }).from(users).where(inArray(users.id, userIds)) : [],
      empIds.length ? tx.select({ id: employees.id, name: employees.displayName }).from(employees).where(inArray(employees.id, empIds)) : [],
    ]);
    const personName = new Map(people.map((p) => [p.id, p.name ?? p.email]));
    const empName = new Map(emps.map((e) => [e.id, e.name]));
    return rows.map((r) => {
      const h = approvalHandler(r.subjectType);
      const own = steps.filter((s) => s.requestId === r.id);
      const active = own.find((s) => s.stepNo === r.currentStep);
      return {
        requestId: r.id,
        subjectType: r.subjectType,
        subjectLabel: h?.label ?? r.subjectType.replace(/_/g, " "),
        title: r.title,
        href: h ? h.href(r.subjectId) : "#",
        status: r.status,
        currentStep: r.currentStep,
        requestedByName: personName.get(r.requestedBy) ?? null,
        requestedForName: r.requestedForEmployeeId ? (empName.get(r.requestedForEmployeeId) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
        steps: own.map((s) => ({
          stepNo: s.stepNo,
          name: s.name,
          status: s.status,
          decidedAt: s.decidedAt?.toISOString() ?? null,
          comment: s.comment,
          approverCount: s.approverUserIds.length,
        })),
        canDecide: r.status === "pending" && !!active && active.status === "pending" && active.approverUserIds.includes(ctx.userId),
        canCancel: r.status === "pending" && r.requestedBy === ctx.userId,
      };
    });
  });
}

/** Requests whose active step lists the user as an approver. */
export async function pendingApprovalsFor(ctx: RequestContext) {
  const rows = await ctx.db((tx) =>
    tx
      .select({ r: approvalRequests })
      .from(approvalRequests)
      .innerJoin(
        approvalSteps,
        and(eq(approvalSteps.requestId, approvalRequests.id), eq(approvalSteps.stepNo, approvalRequests.currentStep)),
      )
      .where(
        and(
          eq(approvalRequests.status, "pending"),
          eq(approvalSteps.status, "pending"),
          sql`${ctx.userId}::uuid = any(${approvalSteps.approverUserIds})`,
        ),
      )
      .orderBy(asc(approvalRequests.createdAt))
      .limit(200),
  );
  return hydrate(ctx, rows.map((r) => r.r));
}

export async function myRequests(ctx: RequestContext) {
  const rows = await ctx.db((tx) =>
    tx.select().from(approvalRequests).where(eq(approvalRequests.requestedBy, ctx.userId)).orderBy(desc(approvalRequests.createdAt)).limit(100),
  );
  return hydrate(ctx, rows);
}

/** All approvals in the tenant (approvals.view), newest first. */
export async function allApprovals(ctx: RequestContext, status?: string) {
  if (!can(ctx, "approvals.view", "all")) throw forbidden();
  const rows = await ctx.db((tx) =>
    tx
      .select()
      .from(approvalRequests)
      .where(status ? eq(approvalRequests.status, status as "pending") : undefined)
      .orderBy(desc(approvalRequests.createdAt))
      .limit(200),
  );
  return hydrate(ctx, rows);
}

export const decideInput = z.object({
  requestId: z.uuid(),
  decision: z.enum(["approve", "reject"]),
  comment: z.string().trim().max(1000).nullish(),
});

export async function decide(ctx: RequestContext, input: z.infer<typeof decideInput>) {
  return ctx.db((tx) => decideApproval(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, input.requestId, input.decision, input.comment ?? null));
}

export async function withdraw(ctx: RequestContext, requestId: string) {
  return ctx.db((tx) => cancelApproval(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, requestId));
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

export type InboxTask = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  dueOn: string | null;
  ownerGroup: string;
  containerType: string | null;
  containerId: string | null;
  subjectName: string | null;
  subjectEmployeeId: string | null;
};

export async function myTasks(ctx: RequestContext, includeDone = false) {
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ t: tasks, subjectName: employees.displayName })
      .from(tasks)
      .leftJoin(employees, eq(employees.id, tasks.subjectEmployeeId))
      .where(
        and(
          eq(tasks.assigneeUserId, ctx.userId),
          includeDone ? undefined : inArray(tasks.status, ["open", "in_progress", "blocked"]),
        ),
      )
      .orderBy(sql`${tasks.dueOn} asc nulls last`, desc(tasks.priority), asc(tasks.createdAt))
      .limit(300);
    return rows.map<InboxTask>(({ t, subjectName }) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      dueOn: t.dueOn,
      ownerGroup: t.ownerGroup,
      containerType: t.containerType,
      containerId: t.containerId,
      subjectName,
      subjectEmployeeId: t.subjectEmployeeId,
    }));
  });
}

export const updateTaskInput = z.object({
  taskId: z.uuid(),
  status: z.enum(["open", "in_progress", "blocked", "done"]),
});

export { registerTaskHook } from "./task-hooks";

export async function updateTaskStatus(ctx: RequestContext, input: z.infer<typeof updateTaskInput>) {
  return ctx.db(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, input.taskId)).for("update");
    if (!task) throw notFound("Task");
    const isAssignee = task.assigneeUserId === ctx.userId;
    if (!isAssignee && !can(ctx, "onboarding.manage", "all") && !can(ctx, "exits.manage", "all")) throw forbidden();
    if (task.status === "cancelled") throw invalidState("This task was cancelled.");
    const done = input.status === "done";
    const [updated] = await tx
      .update(tasks)
      .set({ status: input.status, completedAt: done ? new Date() : null, completedBy: done ? ctx.userId : null })
      .where(eq(tasks.id, task.id))
      .returning();
    await audit(tx, ctx, { action: `task.${input.status}`, entityType: "task", entityId: task.id, metadata: { title: task.title } });
    // Module hooks validate and react (e.g. lifecycle evidence checks, progress).
    if (updated.containerType) await taskHookFor(updated.containerType)?.({ tx, task: updated, ctx });
    return updated;
  });
}
