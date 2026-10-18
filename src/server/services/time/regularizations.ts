import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Tx } from "../../db/client";
import { getTeamEmployeeIds, scopeOf, type RequestContext } from "../../auth/context";
import { attendanceDays, attendanceEvents, employees, regularizations } from "../../db/schema";
import { audit } from "../../lib/audit";
import { forbidden, invalidState, notFound, validation } from "../../lib/errors";
import type { ApprovalActor } from "../approvals/engine";
import { cancelApprovalForSubject, startApproval } from "../approvals/engine";
import { todayIn } from "@/lib/format";
import { addDaysIso, monthEnd, monthStart } from "@/lib/leave-math";
import type { regularizationSchema } from "@/lib/validation/time";
import { computeAttendanceRange } from "./attendance";
import { resolveAttendancePolicy } from "./attendance-policies";
import { employeeBasics, istInstant, istTime } from "./shared";

/**
 * Missing-punch correction. On approval an `approved_correction` event pair
 * (or single event) is added and the day is recomputed; raw punches are
 * never edited.
 */
export async function requestRegularization(ctx: RequestContext, input: z.output<typeof regularizationSchema>, opts: { today?: string } = {}) {
  if (!ctx.employeeId) throw forbidden("Your login is not linked to an employee record.");
  const employeeId = ctx.employeeId;
  const today = opts.today ?? todayIn();
  const actor: ApprovalActor = { tenantId: ctx.tenantId, userId: ctx.userId };
  return ctx.db(async (tx) => {
    const emp = await employeeBasics(tx, ctx.tenantId, employeeId);
    const { rules } = await resolveAttendancePolicy(tx, ctx.tenantId, emp);
    if (input.date > today) throw validation("You can only correct past days or today.", { date: ["In the future"] });
    if (input.date < emp.joiningDate) throw validation("This date is before your joining date.", { date: ["Before joining"] });
    const earliest = addDaysIso(today, -rules.regularizationWindowDays);
    if (input.date < earliest) {
      throw validation(`Corrections must be requested within ${rules.regularizationWindowDays} days (from ${earliest}).`, { date: ["Outside the correction window"] });
    }
    const [day] = await tx.select().from(attendanceDays).where(and(eq(attendanceDays.tenantId, ctx.tenantId), eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, input.date)));
    if (day?.lockedByRunId) throw invalidState("Payroll for this day is locked. Ask HR for an adjustment.");
    if (rules.maxRegularizationsPerMonth != null) {
      const [row] = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from regularizations
        where tenant_id = ${ctx.tenantId} and employee_id = ${employeeId}
          and date between ${monthStart(input.date)} and ${monthEnd(input.date)} and status in ('pending','approved')`);
      if ((row?.n ?? 0) >= rules.maxRegularizationsPerMonth) {
        throw invalidState(`You have reached the limit of ${rules.maxRegularizationsPerMonth} corrections for this month.`);
      }
    }
    const requestedIn = input.inTime ? istInstant(input.date, input.inTime) : null;
    let requestedOut = input.outTime ? istInstant(input.date, input.outTime) : null;
    // Night shift check-outs after midnight: an out time earlier than the in time is the next morning.
    if (requestedIn && requestedOut && requestedOut <= requestedIn) requestedOut = new Date(requestedOut.getTime() + 86_400_000);
    const [reg] = await tx
      .insert(regularizations)
      .values({ tenantId: ctx.tenantId, employeeId, date: input.date, requestedIn, requestedOut, reason: input.reason })
      .returning();
    await startApproval(tx, actor, {
      subjectType: "attendance_regularization",
      subjectId: reg.id,
      title: `Attendance correction · ${emp.displayName} · ${input.date}`,
      requestedBy: ctx.userId,
      subjectEmployeeId: employeeId,
      context: { employeeId },
    });
    await audit(tx, ctx, { action: "attendance.regularization_requested", entityType: "regularization", entityId: reg.id, metadata: { date: input.date } });
    return { id: reg.id };
  });
}

/** Approval handler: add correction events and recompute the day (idempotent). */
export async function onRegularizationApproved(tx: Tx, actor: ApprovalActor, id: string) {
  const [reg] = await tx.select().from(regularizations).where(and(eq(regularizations.tenantId, actor.tenantId), eq(regularizations.id, id))).for("update");
  if (!reg || reg.status !== "pending") return;
  await tx.update(regularizations).set({ status: "approved", decidedBy: actor.userId, decidedAt: new Date() }).where(eq(regularizations.id, reg.id));
  const events = [
    reg.requestedIn ? { kind: "in" as const, occurredAt: reg.requestedIn } : null,
    reg.requestedOut ? { kind: "out" as const, occurredAt: reg.requestedOut } : null,
  ].filter((e): e is { kind: "in" | "out"; occurredAt: Date } => !!e);
  if (events.length) {
    await tx
      .insert(attendanceEvents)
      .values(
        events.map((e) => ({
          tenantId: actor.tenantId,
          employeeId: reg.employeeId,
          occurredAt: e.occurredAt,
          kind: e.kind,
          source: "regularization" as const,
          verification: "approved_correction" as const,
          externalId: `regularization:${reg.id}:${e.kind}`,
          note: reg.reason.slice(0, 200),
          createdBy: actor.userId,
        })),
      )
      .onConflictDoNothing();
  }
  await computeAttendanceRange(tx, actor.tenantId, reg.employeeId, reg.date, reg.date);
  await audit(tx, actor, { action: "attendance.regularization_approved", entityType: "regularization", entityId: reg.id, metadata: { date: reg.date } });
}

export async function onRegularizationClosed(tx: Tx, actor: ApprovalActor, id: string, status: "rejected" | "cancelled") {
  const [reg] = await tx.select().from(regularizations).where(and(eq(regularizations.tenantId, actor.tenantId), eq(regularizations.id, id))).for("update");
  if (!reg || reg.status !== "pending") return;
  await tx.update(regularizations).set({ status, decidedBy: actor.userId, decidedAt: new Date() }).where(eq(regularizations.id, reg.id));
  await audit(tx, actor, { action: `attendance.regularization_${status}`, entityType: "regularization", entityId: reg.id });
}

export async function withdrawRegularization(ctx: RequestContext, id: string) {
  const actor: ApprovalActor = { tenantId: ctx.tenantId, userId: ctx.userId };
  return ctx.db(async (tx) => {
    const [reg] = await tx.select().from(regularizations).where(and(eq(regularizations.tenantId, ctx.tenantId), eq(regularizations.id, id)));
    if (!reg) throw notFound("Correction request");
    if (reg.employeeId !== ctx.employeeId) throw forbidden();
    if (reg.status !== "pending") throw invalidState("Only pending requests can be withdrawn.");
    await cancelApprovalForSubject(tx, actor, "attendance_regularization", reg.id);
    await onRegularizationClosed(tx, actor, reg.id, "cancelled");
    return null;
  });
}

const view = (r: typeof regularizations.$inferSelect & { employeeName?: string }) => ({
  id: r.id,
  employeeId: r.employeeId,
  employeeName: r.employeeName ?? null,
  date: r.date,
  requestedIn: r.requestedIn ? istTime(r.requestedIn) : null,
  requestedOut: r.requestedOut ? istTime(r.requestedOut) : null,
  reason: r.reason,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
  decidedAt: r.decidedAt?.toISOString() ?? null,
});

export async function myRegularizations(ctx: RequestContext) {
  if (!ctx.employeeId) return [];
  const employeeId = ctx.employeeId;
  const rows = await ctx.db((tx) =>
    tx
      .select()
      .from(regularizations)
      .where(and(eq(regularizations.tenantId, ctx.tenantId), eq(regularizations.employeeId, employeeId)))
      .orderBy(desc(regularizations.date))
      .limit(100),
  );
  return rows.map((r) => view(r));
}

/** Regularizations of the team (attendance.view:team) or everyone (all), newest first. */
export async function teamRegularizations(ctx: RequestContext, opts: { status?: "pending" | "approved" | "rejected" | "cancelled"; from?: string; to?: string } = {}) {
  const scope = scopeOf(ctx, "attendance.view");
  if (scope !== "team" && scope !== "all") throw forbidden();
  const ids = scope === "team" ? await getTeamEmployeeIds(ctx) : null;
  if (ids && !ids.length) return [];
  const rows = await ctx.db((tx) =>
    tx
      .select({ r: regularizations, employeeName: employees.displayName })
      .from(regularizations)
      .innerJoin(employees, eq(employees.id, regularizations.employeeId))
      .where(
        and(
          eq(regularizations.tenantId, ctx.tenantId),
          ids ? inArray(regularizations.employeeId, ids) : undefined,
          opts.status ? eq(regularizations.status, opts.status) : undefined,
          opts.from ? gte(regularizations.date, opts.from) : undefined,
          opts.to ? lte(regularizations.date, opts.to) : undefined,
        ),
      )
      .orderBy(desc(regularizations.createdAt))
      .limit(200),
  );
  return rows.map((x) => view({ ...x.r, employeeName: x.employeeName }));
}
