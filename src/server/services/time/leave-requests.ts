import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { authorizeEmployee, can, canAccessEmployee, getTeamEmployeeIds, scopeOf, type RequestContext } from "../../auth/context";
import { approvalRequests, departments, documents, employees, leaveBalances, leaveRequests, leaveTypes } from "../../db/schema";
import { audit } from "../../lib/audit";
import { forbidden, invalidState, notFound, validation } from "../../lib/errors";
import type { ApprovalActor } from "../approvals/engine";
import { cancelApprovalForSubject, startApproval, stepsFor } from "../approvals/engine";
import { emitDomainEvent } from "../events";
import { todayIn } from "@/lib/format";
import {
  addDaysIso,
  canAfford,
  countLeaveDays,
  daysBetween,
  eachDate,
  monthEnd,
  requestsOverlap,
  validateSessions,
  type LeaveDay,
  type Session,
} from "@/lib/leave-math";
import type { LeaveApplyInput, LeaveListQuery } from "@/lib/validation/time";
import { computeAttendanceRange } from "./attendance";
import { resolveAttendancePolicy } from "./attendance-policies";
import { publicHolidaysFor } from "./holidays";
import { adjustPending, lockBalance, postLeaveTxn } from "./leave-ledger";
import { loadLeaveSetup, pickLeavePolicy, rulesFor, tracksBalance, type LeavePolicy, type LeaveType } from "./leave-types";
import { advisoryLock, employeeBasics, fmtDays, type EmployeeBasics } from "./shared";
import { shiftResolver } from "./shifts";

export type LeaveRequest = typeof leaveRequests.$inferSelect;

/* ------------------------------------------------------------------ */
/* Evaluation (shared by the live preview and the real submission)     */
/* ------------------------------------------------------------------ */

export type LeaveEvaluation = {
  days: number;
  breakdown: LeaveDay[];
  holidays: string[];
  tracksBalance: boolean;
  balance: number;
  pending: number;
  available: number;
  after: number | null;
  documentRequired: boolean;
  policy: { id: string; name: string; version: number } | null;
  errors: { field: string; message: string }[];
};

type EvalOpts = { today: string; onBehalf: boolean; documentId?: string | null; checkDocument: boolean };

async function evaluate(tx: Tx, emp: EmployeeBasics, type: LeaveType, policies: LeavePolicy[], input: Omit<LeaveApplyInput, "reason" | "documentId" | "employeeId">, opts: EvalOpts): Promise<LeaveEvaluation> {
  const errors: LeaveEvaluation["errors"] = [];
  const err = (field: string, message: string) => errors.push({ field, message });
  const startSession = input.startSession as Session;
  const endSession = (input.startDate === input.endDate ? input.startSession : input.endSession) as Session;
  const out: LeaveEvaluation = {
    days: 0,
    breakdown: [],
    holidays: [],
    tracksBalance: tracksBalance(type),
    balance: 0,
    pending: 0,
    available: 0,
    after: null,
    documentRequired: false,
    policy: null,
    errors,
  };

  if (!type.isActive) err("leaveTypeId", `${type.name} is no longer available.`);
  if (emp.status !== "active" && emp.status !== "on_notice") err("employeeId", "Leave can only be requested for active employees.");
  const sess = validateSessions(input.startDate, input.endDate, startSession, endSession);
  if (!sess.ok) {
    err(input.endDate < input.startDate ? "endDate" : "startSession", sess.message);
    return out;
  }
  if (!type.allowHalfDay && (startSession !== "full" || endSession !== "full")) err("startSession", `${type.name} cannot be taken in half days.`);
  if (daysBetween(input.startDate, input.endDate) > 366) {
    err("endDate", "A single request can cover at most a year.");
    return out;
  }
  if (input.startDate < emp.joiningDate) err("startDate", "Leave cannot start before the joining date.");
  if (emp.lastDate && input.endDate > emp.lastDate) err("endDate", `Leave cannot extend past the last working day (${emp.lastDate}).`);

  const policy = pickLeavePolicy(policies, emp, type.id, input.startDate);
  const rules = rulesFor(policy);
  if (!policy) err("leaveTypeId", `No ${type.name.toLowerCase()} policy covers this employee for these dates.`);
  else out.policy = { id: policy.id, name: policy.name, version: policy.version };

  if (policy && rules.waitingPeriodDays > 0) {
    const eligibleFrom = addDaysIso(emp.joiningDate, rules.waitingPeriodDays);
    if (input.startDate < eligibleFrom) err("startDate", `${type.name} can be used from ${eligibleFrom} (${rules.waitingPeriodDays}-day waiting period).`);
  }

  // Day count honouring weekly offs, holidays, sessions and the sandwich rule.
  const { rules: attRules } = await resolveAttendancePolicy(tx, emp.tenantId, emp);
  const shifts = await shiftResolver(tx, emp.tenantId, emp.id, input.startDate, input.endDate, attRules.defaultShiftId ?? null);
  const holidays = await publicHolidaysFor(tx, emp.tenantId, emp.locationId, input.startDate, input.endDate);
  out.holidays = [...holidays].sort();
  const { days, breakdown } = countLeaveDays({
    startDate: input.startDate,
    endDate: input.endDate,
    startSession,
    endSession,
    weeklyOffs: shifts.shiftOn(input.startDate).weeklyOffs,
    holidays: out.holidays,
    sandwich: rules.sandwich,
  });
  out.days = days;
  out.breakdown = breakdown;
  if (days <= 0) err("startDate", "The selected dates fall on weekly offs or holidays.");

  if (policy && !opts.onBehalf && rules.minNoticeDays > 0 && daysBetween(opts.today, input.startDate) < rules.minNoticeDays) {
    err("startDate", `Apply at least ${fmtDays(rules.minNoticeDays)} in advance for ${type.name.toLowerCase()}.`);
  }
  if (policy && rules.maxConsecutiveDays != null && days > rules.maxConsecutiveDays) {
    err("endDate", `${type.name} can be taken for at most ${fmtDays(rules.maxConsecutiveDays)} at a time.`);
  }
  for (const b of rules.blackouts ?? []) {
    if (input.startDate <= b.to && input.endDate >= b.from) err("startDate", `Leave is not allowed from ${b.from} to ${b.to}: ${b.reason}.`);
  }

  // Overlap with other pending or approved requests of any type (half-day aware).
  const others = await tx
    .select({ id: leaveRequests.id, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate, startSession: leaveRequests.startSession, endSession: leaveRequests.endSession, status: leaveRequests.status })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.tenantId, emp.tenantId),
        eq(leaveRequests.employeeId, emp.id),
        inArray(leaveRequests.status, ["pending", "approved"]),
        lte(leaveRequests.startDate, input.endDate),
        gte(leaveRequests.endDate, input.startDate),
      ),
    );
  const clash = others.find((o) =>
    requestsOverlap(
      { startDate: input.startDate, endDate: input.endDate, startSession, endSession },
      { startDate: o.startDate, endDate: o.endDate, startSession: o.startSession as Session, endSession: o.endSession as Session },
    ),
  );
  if (clash) err("startDate", `This overlaps a ${clash.status} leave request (${clash.startDate}${clash.endDate !== clash.startDate ? ` to ${clash.endDate}` : ""}).`);

  if (out.tracksBalance) {
    const [b] = await tx
      .select()
      .from(leaveBalances)
      .where(and(eq(leaveBalances.tenantId, emp.tenantId), eq(leaveBalances.employeeId, emp.id), eq(leaveBalances.leaveTypeId, type.id)));
    out.balance = b?.balance ?? 0;
    out.pending = b?.pending ?? 0;
    out.available = Math.round((out.balance - out.pending) * 100) / 100;
    out.after = Math.round((out.available - days) * 100) / 100;
    if (days > 0 && !canAfford(days, out.balance, out.pending, type.allowNegative, type.maxNegativeDays)) {
      err("leaveTypeId", `Insufficient ${type.name.toLowerCase()} balance: ${fmtDays(out.available)} available, ${fmtDays(days)} requested.`);
    }
  }

  out.documentRequired = type.requiresDocumentAfterDays != null && days > type.requiresDocumentAfterDays;
  if (opts.checkDocument && out.documentRequired) {
    if (!opts.documentId) err("documentId", `Attach a supporting document for ${type.name.toLowerCase()} longer than ${fmtDays(type.requiresDocumentAfterDays!)}.`);
    else {
      const [doc] = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.tenantId, emp.tenantId), eq(documents.id, opts.documentId), eq(documents.employeeId, emp.id)));
      if (!doc) err("documentId", "Choose one of the employee's documents.");
    }
  }
  return out;
}

function resolveTarget(ctx: RequestContext, employeeId: string | null | undefined) {
  const target = employeeId ?? ctx.employeeId;
  if (!target) throw forbidden("Your login is not linked to an employee record.");
  const onBehalf = target !== ctx.employeeId;
  if (onBehalf && !can(ctx, "leave.manage", "all")) throw forbidden("Only HR can apply leave on behalf of someone else.");
  return { employeeId: target, onBehalf };
}

/** Live preview for the apply form: day count, balance after, and any blocking problems. */
export async function previewLeave(ctx: RequestContext, input: Omit<LeaveApplyInput, "reason" | "documentId">) {
  const { employeeId, onBehalf } = resolveTarget(ctx, input.employeeId);
  if (!onBehalf) await authorizeEmployee(ctx, "leave.view", employeeId);
  return ctx.db(async (tx) => {
    const emp = await employeeBasics(tx, ctx.tenantId, employeeId);
    const { types, policies } = await loadLeaveSetup(tx, ctx.tenantId);
    const type = types.find((t) => t.id === input.leaveTypeId);
    if (!type) throw notFound("Leave type");
    return evaluate(tx, emp, type, policies, input, { today: todayIn(), onBehalf, checkDocument: false });
  });
}

/* ------------------------------------------------------------------ */
/* Apply                                                               */
/* ------------------------------------------------------------------ */

export async function applyLeave(ctx: RequestContext, input: LeaveApplyInput, opts: { today?: string } = {}) {
  const { employeeId, onBehalf } = resolveTarget(ctx, input.employeeId);
  if (!onBehalf) await authorizeEmployee(ctx, "leave.view", employeeId);
  const today = opts.today ?? todayIn();
  const actor: ApprovalActor = { tenantId: ctx.tenantId, userId: ctx.userId };
  return ctx.db(async (tx) => {
    // Serialize requests of the same employee so overlap and balance checks are race-free.
    await advisoryLock(tx, `leave-employee:${employeeId}`);
    const emp = await employeeBasics(tx, ctx.tenantId, employeeId);
    const { types, policies } = await loadLeaveSetup(tx, ctx.tenantId);
    const type = types.find((t) => t.id === input.leaveTypeId);
    if (!type) throw notFound("Leave type");
    if (tracksBalance(type)) await lockBalance(tx, ctx.tenantId, emp.id, type.id);
    const ev = await evaluate(tx, emp, type, policies, input, { today, onBehalf, documentId: input.documentId, checkDocument: true });
    if (ev.errors.length) {
      const fieldErrors: Record<string, string[]> = {};
      for (const e of ev.errors) (fieldErrors[e.field] ??= []).push(e.message);
      throw validation(ev.errors[0].message, fieldErrors);
    }
    const endSession = input.startDate === input.endDate ? input.startSession : input.endSession;
    const [request] = await tx
      .insert(leaveRequests)
      .values({
        tenantId: ctx.tenantId,
        employeeId: emp.id,
        leaveTypeId: type.id,
        startDate: input.startDate,
        endDate: input.endDate,
        startSession: input.startSession,
        endSession,
        days: ev.days,
        reason: input.reason,
        status: onBehalf ? "approved" : "pending",
        appliedBy: ctx.userId,
        documentId: input.documentId,
        policyVersion: ev.policy?.version ?? null,
        decidedAt: onBehalf ? new Date() : null,
      })
      .returning();

    if (onBehalf) {
      // Recorded by HR: no approval step, settle immediately.
      await settleApproved(tx, actor, request, type);
      await audit(tx, ctx, {
        action: "leave.recorded_by_hr",
        entityType: "leave_request",
        entityId: request.id,
        metadata: { employeeId: emp.id, leaveType: type.code, days: ev.days, from: request.startDate, to: request.endDate },
      });
      return { id: request.id, status: request.status, days: request.days };
    }

    if (tracksBalance(type)) await adjustPending(tx, ctx.tenantId, emp.id, type.id, ev.days);
    await startApproval(tx, actor, {
      subjectType: "leave_request",
      subjectId: request.id,
      title: `${type.name} · ${emp.displayName} · ${fmtDays(ev.days)}`,
      requestedBy: ctx.userId,
      subjectEmployeeId: emp.id,
      context: { leaveTypeCode: type.code, days: ev.days, employeeId: emp.id },
    });
    await emitDomainEvent(tx, ctx.tenantId, "leave.requested", {
      requestId: request.id,
      employeeId: emp.id,
      leaveTypeCode: type.code,
      startDate: request.startDate,
      endDate: request.endDate,
      days: request.days,
    });
    await audit(tx, ctx, {
      action: "leave.requested",
      entityType: "leave_request",
      entityId: request.id,
      metadata: { employeeId: emp.id, leaveType: type.code, days: ev.days, from: request.startDate, to: request.endDate },
    });
    return { id: request.id, status: request.status, days: request.days };
  });
}

/* ------------------------------------------------------------------ */
/* Settlement (called by the approval handler and by HR recording)     */
/* ------------------------------------------------------------------ */

async function typeOf(tx: Tx, tenantId: string, id: string) {
  const [t] = await tx.select().from(leaveTypes).where(and(eq(leaveTypes.tenantId, tenantId), eq(leaveTypes.id, id)));
  if (!t) throw notFound("Leave type");
  return t;
}

async function settleApproved(tx: Tx, actor: ApprovalActor, request: LeaveRequest, type: LeaveType) {
  if (tracksBalance(type)) {
    await postLeaveTxn(tx, actor.tenantId, {
      employeeId: request.employeeId,
      leaveTypeId: request.leaveTypeId,
      kind: "deduction",
      days: -request.days,
      effectiveOn: request.startDate,
      sourceKey: `leave:${request.id}`,
      leaveRequestId: request.id,
      note: `${type.name} ${request.startDate}${request.endDate !== request.startDate ? ` to ${request.endDate}` : ""}`,
      createdBy: actor.userId,
    });
  }
  await computeAttendanceRange(tx, actor.tenantId, request.employeeId, request.startDate, request.endDate);
  await emitDomainEvent(tx, actor.tenantId, "leave.decided", { requestId: request.id, employeeId: request.employeeId, status: "approved", days: request.days });
}

/** Approval handler: approve a pending request (idempotent). */
export async function onLeaveApproved(tx: Tx, actor: ApprovalActor, requestId: string) {
  const [req] = await tx
    .select()
    .from(leaveRequests)
    .where(and(eq(leaveRequests.tenantId, actor.tenantId), eq(leaveRequests.id, requestId)))
    .for("update");
  if (!req || req.status !== "pending") return;
  const type = await typeOf(tx, actor.tenantId, req.leaveTypeId);
  const [updated] = await tx
    .update(leaveRequests)
    .set({ status: "approved", decidedAt: new Date() })
    .where(eq(leaveRequests.id, req.id))
    .returning();
  if (tracksBalance(type)) await adjustPending(tx, actor.tenantId, req.employeeId, req.leaveTypeId, -req.days);
  await settleApproved(tx, actor, updated, type);
  await audit(tx, actor, { action: "leave.approved", entityType: "leave_request", entityId: req.id, metadata: { days: req.days } });
}

/** Approval handler: rejection or withdrawal of a pending request releases the pending days. */
export async function onLeaveClosed(tx: Tx, actor: ApprovalActor, requestId: string, status: "rejected" | "cancelled", comment: string | null) {
  const [req] = await tx
    .select()
    .from(leaveRequests)
    .where(and(eq(leaveRequests.tenantId, actor.tenantId), eq(leaveRequests.id, requestId)))
    .for("update");
  if (!req || req.status !== "pending") return;
  const type = await typeOf(tx, actor.tenantId, req.leaveTypeId);
  await tx
    .update(leaveRequests)
    .set({ status, decidedAt: new Date(), cancelledAt: status === "cancelled" ? new Date() : null })
    .where(eq(leaveRequests.id, req.id));
  if (tracksBalance(type)) await adjustPending(tx, actor.tenantId, req.employeeId, req.leaveTypeId, -req.days);
  if (status === "rejected") {
    await emitDomainEvent(tx, actor.tenantId, "leave.decided", { requestId: req.id, employeeId: req.employeeId, status: "rejected", days: req.days });
  }
  await audit(tx, actor, { action: `leave.${status}`, entityType: "leave_request", entityId: req.id, metadata: { comment: comment ?? undefined } });
}

/* ------------------------------------------------------------------ */
/* Cancellation                                                        */
/* ------------------------------------------------------------------ */

/**
 * Cancel a request. Pending → the approval is withdrawn and pending days are
 * released. Approved → a reversal posting restores the balance (idempotent:
 * cancelling twice posts one reversal) and attendance is recomputed.
 * Employees may cancel approved leave that has not ended; HR may cancel any.
 */
export async function cancelLeave(ctx: RequestContext, requestId: string, reason: string | null = null) {
  const actor: ApprovalActor = { tenantId: ctx.tenantId, userId: ctx.userId };
  const isHr = can(ctx, "leave.manage", "all");
  return ctx.db(async (tx) => {
    const [req] = await tx.select().from(leaveRequests).where(and(eq(leaveRequests.tenantId, ctx.tenantId), eq(leaveRequests.id, requestId)));
    if (!req) throw notFound("Leave request");
    if (req.employeeId !== ctx.employeeId && !isHr) throw forbidden();
    await advisoryLock(tx, `leave-employee:${req.employeeId}`);
    const [cur] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, req.id)).for("update");
    if (cur.status === "cancelled") return { status: "cancelled" as const, reversed: false };
    if (cur.status === "rejected") throw invalidState("This request was rejected; there is nothing to cancel.");

    if (cur.status === "pending") {
      await cancelApprovalForSubject(tx, actor, "leave_request", cur.id);
      // If no approval was open (e.g. a policy change), close the request directly.
      await onLeaveClosed(tx, actor, cur.id, "cancelled", reason);
      return { status: "cancelled" as const, reversed: false };
    }

    if (!isHr && cur.endDate < todayIn()) throw invalidState("This leave has already been taken. Ask HR to cancel past leave.");
    const type = await typeOf(tx, ctx.tenantId, cur.leaveTypeId);
    await tx.update(leaveRequests).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(leaveRequests.id, cur.id));
    let reversed = false;
    if (tracksBalance(type)) {
      const row = await postLeaveTxn(tx, ctx.tenantId, {
        employeeId: cur.employeeId,
        leaveTypeId: cur.leaveTypeId,
        kind: "reversal",
        days: cur.days,
        effectiveOn: cur.startDate,
        sourceKey: `reversal:${cur.id}`,
        leaveRequestId: cur.id,
        note: reason ? `Cancelled: ${reason}` : "Cancelled",
        createdBy: ctx.userId,
      });
      reversed = !!row;
    }
    await computeAttendanceRange(tx, ctx.tenantId, cur.employeeId, cur.startDate, cur.endDate);
    await emitDomainEvent(tx, ctx.tenantId, "leave.decided", { requestId: cur.id, employeeId: cur.employeeId, status: "cancelled", days: cur.days });
    await audit(tx, ctx, { action: "leave.cancelled", entityType: "leave_request", entityId: cur.id, metadata: { reason, reversed, previous: "approved" } });
    return { status: "cancelled" as const, reversed };
  });
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

const requestColumns = {
  r: leaveRequests,
  employeeName: employees.displayName,
  employeeCode: employees.employeeCode,
  typeName: leaveTypes.name,
  typeCode: leaveTypes.code,
  typeColor: leaveTypes.color,
  isPaid: leaveTypes.isPaid,
};

type RequestRow = { r: LeaveRequest; employeeName: string; employeeCode: string; typeName: string; typeCode: string; typeColor: string; isPaid: boolean };

const flatten = (x: RequestRow) => ({
  ...x.r,
  employeeName: x.employeeName,
  employeeCode: x.employeeCode,
  typeName: x.typeName,
  typeCode: x.typeCode,
  typeColor: x.typeColor,
  isPaid: x.isPaid,
});

export type LeaveRequestRow = ReturnType<typeof flatten>;

export async function myLeaveRequests(ctx: RequestContext, employeeId = ctx.employeeId) {
  if (!employeeId) return [];
  await authorizeEmployee(ctx, "leave.view", employeeId);
  return ctx.db(async (tx) => {
    const rows = await tx
      .select(requestColumns)
      .from(leaveRequests)
      .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(eq(leaveRequests.tenantId, ctx.tenantId), eq(leaveRequests.employeeId, employeeId)))
      .orderBy(desc(leaveRequests.startDate), desc(leaveRequests.createdAt))
      .limit(100);
    return rows.map(flatten);
  });
}

/** Requests across the organization (leave.view:all) or the user's team (leave.view:team). */
export async function listLeaveRequests(ctx: RequestContext, q: LeaveListQuery) {
  const scope = scopeOf(ctx, "leave.view");
  if (scope !== "all" && scope !== "team") throw forbidden();
  const teamIds = scope === "team" ? await getTeamEmployeeIds(ctx) : null;
  const pageSize = 25;
  return ctx.db(async (tx) => {
    const where = and(
      eq(leaveRequests.tenantId, ctx.tenantId),
      teamIds ? (teamIds.length ? inArray(leaveRequests.employeeId, teamIds) : sql`false`) : undefined,
      q.status ? eq(leaveRequests.status, q.status) : undefined,
      q.leaveTypeId ? eq(leaveRequests.leaveTypeId, q.leaveTypeId) : undefined,
      q.from ? gte(leaveRequests.endDate, q.from) : undefined,
      q.to ? lte(leaveRequests.startDate, q.to) : undefined,
      q.q ? or(ilike(employees.displayName, `%${q.q}%`), ilike(employees.employeeCode, `%${q.q}%`)) : undefined,
    );
    const [{ total }] = await tx
      .select({ total: count() })
      .from(leaveRequests)
      .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
      .where(where);
    const rows = await tx
      .select(requestColumns)
      .from(leaveRequests)
      .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(where)
      .orderBy(desc(leaveRequests.startDate), desc(leaveRequests.createdAt))
      .limit(pageSize)
      .offset((q.page - 1) * pageSize);
    return { rows: rows.map(flatten), total, page: q.page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
  });
}

export async function getLeaveRequest(ctx: RequestContext, id: string) {
  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .select(requestColumns)
      .from(leaveRequests)
      .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(eq(leaveRequests.tenantId, ctx.tenantId), eq(leaveRequests.id, id)));
    if (!r) return null;
    const approvals = await tx
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.tenantId, ctx.tenantId), eq(approvalRequests.subjectType, "leave_request"), eq(approvalRequests.subjectId, id)))
      .orderBy(desc(approvalRequests.createdAt));
    const steps = await stepsFor(tx, approvals.map((a) => a.id));
    return { request: flatten(r), approval: approvals[0] ?? null, steps, isApprover: steps.some((s) => s.approverUserIds.includes(ctx.userId)) };
  });
  if (!row) throw notFound("Leave request");
  if (!row.isApprover && !(await canAccessEmployee(ctx, "leave.view", row.request.employeeId))) throw forbidden();
  const today = todayIn();
  const own = row.request.employeeId === ctx.employeeId;
  const isHr = can(ctx, "leave.manage", "all");
  const canCancel =
    row.request.status === "pending" ? own || isHr : row.request.status === "approved" ? isHr || (own && row.request.endDate >= today) : false;
  return { ...row, canCancel };
}

/** Recent documents of an employee, offered as attachments when a leave type requires one. */
export async function attachableDocuments(ctx: RequestContext, employeeId: string) {
  await authorizeEmployee(ctx, "leave.view", employeeId);
  return ctx.db((tx) =>
    tx
      .select({ id: documents.id, title: documents.title, createdAt: documents.createdAt })
      .from(documents)
      .where(and(eq(documents.tenantId, ctx.tenantId), eq(documents.employeeId, employeeId), eq(documents.isCurrent, true)))
      .orderBy(desc(documents.createdAt))
      .limit(30),
  );
}

/* ------------------------------------------------------------------ */
/* Team calendar and utilization                                       */
/* ------------------------------------------------------------------ */

export async function teamLeaveCalendar(ctx: RequestContext, month: string) {
  const scope = scopeOf(ctx, "leave.view");
  if (scope !== "all" && scope !== "team") throw forbidden();
  const teamIds = scope === "team" ? await getTeamEmployeeIds(ctx) : null;
  const from = `${month}-01`;
  const to = monthEnd(from);
  return ctx.db(async (tx) => {
    const emps = await tx
      .select({ id: employees.id, name: employees.displayName, code: employees.employeeCode, locationId: employees.locationId })
      .from(employees)
      .where(
        and(
          eq(employees.tenantId, ctx.tenantId),
          isNull(employees.deletedAt),
          inArray(employees.status, ["active", "on_notice"]),
          teamIds ? (teamIds.length ? inArray(employees.id, teamIds) : sql`false`) : undefined,
        ),
      )
      .orderBy(asc(employees.displayName))
      .limit(300);
    const ids = emps.map((e) => e.id);
    const reqs = ids.length
      ? await tx
          .select({ r: leaveRequests, code: leaveTypes.code, name: leaveTypes.name, color: leaveTypes.color })
          .from(leaveRequests)
          .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
          .where(
            and(
              eq(leaveRequests.tenantId, ctx.tenantId),
              inArray(leaveRequests.employeeId, ids),
              inArray(leaveRequests.status, ["approved", "pending"]),
              lte(leaveRequests.startDate, to),
              gte(leaveRequests.endDate, from),
            ),
          )
      : [];
    const holidays = await publicHolidaysFor(tx, ctx.tenantId, null, from, to);
    const people = emps
      .map((e) => {
        const cells: Record<string, { code: string; name: string; color: string; status: string; session: string }> = {};
        for (const { r, code, name, color } of reqs.filter((x) => x.r.employeeId === e.id)) {
          for (const d of eachDate(r.startDate > from ? r.startDate : from, r.endDate < to ? r.endDate : to)) {
            const session = r.startDate === r.endDate ? r.startSession : d === r.startDate ? r.startSession : d === r.endDate ? r.endSession : "full";
            cells[d] = { code, name, color, status: r.status, session };
          }
        }
        return { id: e.id, name: e.name, code: e.code, cells };
      })
      .filter((p) => Object.keys(p.cells).length > 0 || emps.length <= 40);
    return { month, from, to, dates: eachDate(from, to), holidays: [...holidays], people, totalPeople: emps.length };
  });
}

export type LeaveUtilization = {
  from: string;
  to: string;
  byType: { leaveTypeId: string; code: string; name: string; isPaid: boolean; days: number; requests: number; employees: number }[];
  byDepartment: { departmentId: string | null; department: string; days: number; requests: number; employees: number }[];
  totalDays: number;
};

/**
 * Approved leave days taken inside [from, to] by type and department.
 * Requests that straddle the range only contribute their days inside it.
 */
export async function leaveUtilization(ctx: RequestContext, from: string, to: string): Promise<LeaveUtilization> {
  if (!can(ctx, "leave.view", "all") && !can(ctx, "reports.view", "all")) throw forbidden();
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ r: leaveRequests, code: leaveTypes.code, name: leaveTypes.name, isPaid: leaveTypes.isPaid, departmentId: employees.departmentId, department: departments.name })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(and(eq(leaveRequests.tenantId, ctx.tenantId), eq(leaveRequests.status, "approved"), lte(leaveRequests.startDate, to), gte(leaveRequests.endDate, from)));
    const byType = new Map<string, LeaveUtilization["byType"][number] & { emp: Set<string> }>();
    const byDept = new Map<string, LeaveUtilization["byDepartment"][number] & { emp: Set<string> }>();
    let totalDays = 0;
    const policiesCache = await loadLeaveSetup(tx, ctx.tenantId);
    for (const row of rows) {
      const r = row.r;
      let days = r.days;
      if (r.startDate < from || r.endDate > to) {
        const emp = await employeeBasics(tx, ctx.tenantId, r.employeeId);
        const rules = rulesFor(pickLeavePolicy(policiesCache.policies, emp, r.leaveTypeId, r.startDate));
        const hol = await publicHolidaysFor(tx, ctx.tenantId, emp.locationId, r.startDate, r.endDate);
        const { rules: att } = await resolveAttendancePolicy(tx, ctx.tenantId, emp);
        const sh = await shiftResolver(tx, ctx.tenantId, emp.id, r.startDate, r.startDate, att.defaultShiftId ?? null);
        const { breakdown } = countLeaveDays({
          startDate: r.startDate,
          endDate: r.endDate,
          startSession: r.startSession as Session,
          endSession: r.endSession as Session,
          weeklyOffs: sh.shiftOn(r.startDate).weeklyOffs,
          holidays: [...hol],
          sandwich: rules.sandwich,
        });
        days = breakdown.filter((d) => d.date >= from && d.date <= to).reduce((s, d) => s + d.days, 0);
      }
      if (days <= 0) continue;
      totalDays += days;
      const t = byType.get(r.leaveTypeId) ?? { leaveTypeId: r.leaveTypeId, code: row.code, name: row.name, isPaid: row.isPaid, days: 0, requests: 0, employees: 0, emp: new Set<string>() };
      t.days += days;
      t.requests++;
      t.emp.add(r.employeeId);
      byType.set(r.leaveTypeId, t);
      const key = row.departmentId ?? "none";
      const d = byDept.get(key) ?? { departmentId: row.departmentId, department: row.department ?? "No department", days: 0, requests: 0, employees: 0, emp: new Set<string>() };
      d.days += days;
      d.requests++;
      d.emp.add(r.employeeId);
      byDept.set(key, d);
    }
    const finish = <T extends { emp: Set<string>; employees: number }>(x: T) => {
      const { emp, ...rest } = x;
      return { ...rest, employees: emp.size };
    };
    return {
      from,
      to,
      totalDays,
      byType: [...byType.values()].map(finish).sort((a, b) => b.days - a.days),
      byDepartment: [...byDept.values()].map(finish).sort((a, b) => b.days - a.days),
    };
  });
}
