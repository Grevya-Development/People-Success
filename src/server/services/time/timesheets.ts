import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Tx } from "../../db/client";
import { authorize, authorizeEmployee, getTeamEmployeeIds, scopeOf, type RequestContext } from "../../auth/context";
import { employees, projects, timesheetEntries, timesheets } from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { forbidden, invalidState, notFound, validation } from "../../lib/errors";
import type { ApprovalActor } from "../approvals/engine";
import { cancelApprovalForSubject, startApproval } from "../approvals/engine";
import { addDaysIso, weekdayOf } from "@/lib/leave-math";
import type { projectSchema, saveTimesheetSchema } from "@/lib/validation/time";
import { employeeBasics } from "./shared";

/** Timesheet weeks start on Monday. */
export function weekStartOf(date: string) {
  const wd = weekdayOf(date);
  return addDaysIso(date, wd === 0 ? -6 : 1 - wd);
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

export async function listProjects(ctx: RequestContext, opts: { activeOnly?: boolean } = {}) {
  return ctx.db((tx) =>
    tx
      .select()
      .from(projects)
      .where(and(eq(projects.tenantId, ctx.tenantId), opts.activeOnly ? eq(projects.isActive, true) : undefined))
      .orderBy(desc(projects.isActive), asc(projects.code)),
  );
}

export async function saveProject(ctx: RequestContext, input: z.output<typeof projectSchema>) {
  authorize(ctx, "attendance.manage", "all");
  return ctx.db(async (tx) => {
    const values = { code: input.code, name: input.name, client: input.client, isBillable: input.isBillable, isActive: input.isActive };
    if (input.id) {
      const [before] = await tx.select().from(projects).where(and(eq(projects.tenantId, ctx.tenantId), eq(projects.id, input.id)));
      if (!before) throw notFound("Project");
      const [row] = await tx.update(projects).set(values).where(eq(projects.id, before.id)).returning();
      await audit(tx, ctx, { action: "project.updated", entityType: "project", entityId: row.id, changes: diff(before, row) });
      return row;
    }
    const [row] = await tx.insert(projects).values({ tenantId: ctx.tenantId, ...values }).returning();
    await audit(tx, ctx, { action: "project.created", entityType: "project", entityId: row.id, metadata: { code: row.code } });
    return row;
  });
}

/* ------------------------------------------------------------------ */
/* Timesheets                                                          */
/* ------------------------------------------------------------------ */

async function loadSheet(tx: Tx, tenantId: string, id: string, lock = false) {
  const q = tx.select().from(timesheets).where(and(eq(timesheets.tenantId, tenantId), eq(timesheets.id, id)));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw notFound("Timesheet");
  return row;
}

/** The employee's timesheet for a week (null until the first save). */
export async function getWeekTimesheet(ctx: RequestContext, employeeId: string, weekStart: string) {
  await authorizeEmployee(ctx, "attendance.view", employeeId);
  const start = weekStartOf(weekStart);
  return ctx.db(async (tx) => {
    const emp = await employeeBasics(tx, ctx.tenantId, employeeId);
    const [sheet] = await tx.select().from(timesheets).where(and(eq(timesheets.tenantId, ctx.tenantId), eq(timesheets.employeeId, employeeId), eq(timesheets.weekStart, start)));
    const entries = sheet
      ? await tx.select().from(timesheetEntries).where(eq(timesheetEntries.timesheetId, sheet.id)).orderBy(asc(timesheetEntries.date), asc(timesheetEntries.createdAt))
      : [];
    return { employee: { id: emp.id, name: emp.displayName }, weekStart: start, sheet: sheet ?? null, entries };
  });
}

export async function getTimesheet(ctx: RequestContext, id: string) {
  const data = await ctx.db(async (tx) => {
    const sheet = await loadSheet(tx, ctx.tenantId, id);
    const entries = await tx.select().from(timesheetEntries).where(eq(timesheetEntries.timesheetId, id)).orderBy(asc(timesheetEntries.date));
    const [emp] = await tx.select({ name: employees.displayName }).from(employees).where(eq(employees.id, sheet.employeeId));
    return { sheet, entries, employeeName: emp?.name ?? "" };
  });
  await authorizeEmployee(ctx, "attendance.view", data.sheet.employeeId);
  return data;
}

const editable = (status: string) => status === "draft" || status === "rejected";

/** Replace the entries of an editable (draft or rejected) timesheet. */
export async function saveTimesheet(ctx: RequestContext, input: z.output<typeof saveTimesheetSchema>) {
  if (!ctx.employeeId) throw forbidden("Your login is not linked to an employee record.");
  const employeeId = ctx.employeeId;
  return ctx.db(async (tx) => {
    let id = input.timesheetId ?? null;
    if (!id) {
      const start = weekStartOf(input.weekStart);
      await tx.insert(timesheets).values({ tenantId: ctx.tenantId, employeeId, weekStart: start }).onConflictDoNothing();
      const [row] = await tx.select({ id: timesheets.id }).from(timesheets).where(and(eq(timesheets.tenantId, ctx.tenantId), eq(timesheets.employeeId, employeeId), eq(timesheets.weekStart, start)));
      id = row.id;
    }
    const sheet = await loadSheet(tx, ctx.tenantId, id, true);
    if (sheet.employeeId !== employeeId) throw forbidden("You can only edit your own timesheet.");
    if (!editable(sheet.status)) throw invalidState("This timesheet is submitted and locked.");
    const weekEnd = addDaysIso(sheet.weekStart, 6);
    const perDay = new Map<string, number>();
    for (const e of input.entries) {
      if (e.date < sheet.weekStart || e.date > weekEnd) throw validation(`Entries must fall between ${sheet.weekStart} and ${weekEnd}.`);
      perDay.set(e.date, (perDay.get(e.date) ?? 0) + e.minutes);
    }
    for (const [d, m] of perDay) if (m > 1440) throw validation(`More than 24 hours logged on ${d}.`);
    const projectIds = [...new Set(input.entries.map((e) => e.projectId).filter((x): x is string => !!x))];
    const projs = projectIds.length ? await tx.select().from(projects).where(and(eq(projects.tenantId, ctx.tenantId), inArray(projects.id, projectIds))) : [];
    if (projs.length !== projectIds.length) throw validation("One of the projects is not available.");
    if (projs.some((p) => !p.isActive)) throw validation("One of the projects is inactive.");
    await tx.delete(timesheetEntries).where(eq(timesheetEntries.timesheetId, sheet.id));
    if (input.entries.length) {
      await tx.insert(timesheetEntries).values(
        input.entries.map((e) => ({
          tenantId: ctx.tenantId,
          timesheetId: sheet.id,
          date: e.date,
          projectId: e.projectId,
          task: e.task,
          minutes: e.minutes,
          // Billable follows the project; time without a project is never billable.
          isBillable: e.projectId ? (projs.find((p) => p.id === e.projectId)?.isBillable ?? false) : false,
          note: e.note,
        })),
      );
    }
    const total = input.entries.reduce((s, e) => s + e.minutes, 0);
    await tx.update(timesheets).set({ totalMinutes: total, status: "draft" }).where(eq(timesheets.id, sheet.id));
    await audit(tx, ctx, { action: "timesheet.saved", entityType: "timesheet", entityId: sheet.id, metadata: { entries: input.entries.length, totalMinutes: total } });
    return { id: sheet.id, totalMinutes: total };
  });
}

export async function submitTimesheet(ctx: RequestContext, id: string) {
  const actor: ApprovalActor = { tenantId: ctx.tenantId, userId: ctx.userId };
  return ctx.db(async (tx) => {
    const sheet = await loadSheet(tx, ctx.tenantId, id, true);
    if (sheet.employeeId !== ctx.employeeId) throw forbidden("You can only submit your own timesheet.");
    if (!editable(sheet.status)) throw invalidState("This timesheet has already been submitted.");
    if (sheet.totalMinutes <= 0) throw validation("Log some time before submitting.");
    const emp = await employeeBasics(tx, ctx.tenantId, sheet.employeeId);
    await tx.update(timesheets).set({ status: "submitted", submittedAt: new Date(), decidedAt: null }).where(eq(timesheets.id, sheet.id));
    await startApproval(tx, actor, {
      subjectType: "timesheet",
      subjectId: sheet.id,
      title: `Timesheet · ${emp.displayName} · week of ${sheet.weekStart} · ${(sheet.totalMinutes / 60).toFixed(1)} h`,
      requestedBy: ctx.userId,
      subjectEmployeeId: sheet.employeeId,
      context: { employeeId: sheet.employeeId, hours: Math.round(sheet.totalMinutes / 60) },
    });
    await audit(tx, ctx, { action: "timesheet.submitted", entityType: "timesheet", entityId: sheet.id, metadata: { totalMinutes: sheet.totalMinutes } });
    return null;
  });
}

/** Withdraw a submitted timesheet back to draft. */
export async function recallTimesheet(ctx: RequestContext, id: string) {
  const actor: ApprovalActor = { tenantId: ctx.tenantId, userId: ctx.userId };
  return ctx.db(async (tx) => {
    const sheet = await loadSheet(tx, ctx.tenantId, id, true);
    if (sheet.employeeId !== ctx.employeeId) throw forbidden();
    if (sheet.status !== "submitted") throw invalidState("Only submitted timesheets can be recalled.");
    await cancelApprovalForSubject(tx, actor, "timesheet", sheet.id);
    await onTimesheetDecided(tx, actor, sheet.id, "draft");
    return null;
  });
}

/** Approval handler outcome (approved / rejected → editable again / cancelled → draft). */
export async function onTimesheetDecided(tx: Tx, actor: ApprovalActor, id: string, status: "approved" | "rejected" | "draft") {
  const [sheet] = await tx.select().from(timesheets).where(and(eq(timesheets.tenantId, actor.tenantId), eq(timesheets.id, id))).for("update");
  if (!sheet || sheet.status !== "submitted") return;
  await tx.update(timesheets).set({ status, decidedAt: status === "draft" ? null : new Date() }).where(eq(timesheets.id, id));
  await audit(tx, actor, { action: `timesheet.${status === "draft" ? "recalled" : status}`, entityType: "timesheet", entityId: id });
}

/** Timesheets of the team (attendance.view:team/all) for a week. */
export async function teamTimesheets(ctx: RequestContext, weekStart: string) {
  const scope = scopeOf(ctx, "attendance.view");
  if (scope !== "team" && scope !== "all") throw forbidden();
  const ids = scope === "team" ? await getTeamEmployeeIds(ctx) : null;
  const start = weekStartOf(weekStart);
  return ctx.db(async (tx) => {
    const emps = await tx
      .select({ id: employees.id, name: employees.displayName, code: employees.employeeCode })
      .from(employees)
      .where(
        and(
          eq(employees.tenantId, ctx.tenantId),
          isNull(employees.deletedAt),
          inArray(employees.status, ["active", "on_notice"]),
          ids ? (ids.length ? inArray(employees.id, ids) : sql`false`) : undefined,
        ),
      )
      .orderBy(asc(employees.displayName))
      .limit(300);
    const sheets = emps.length
      ? await tx.select().from(timesheets).where(and(eq(timesheets.tenantId, ctx.tenantId), eq(timesheets.weekStart, start), inArray(timesheets.employeeId, emps.map((e) => e.id))))
      : [];
    return {
      weekStart: start,
      rows: emps.map((e) => {
        const s = sheets.find((x) => x.employeeId === e.id);
        return { employeeId: e.id, name: e.name, code: e.code, timesheetId: s?.id ?? null, status: s?.status ?? null, totalMinutes: s?.totalMinutes ?? 0, submittedAt: s?.submittedAt?.toISOString() ?? null };
      }),
    };
  });
}
