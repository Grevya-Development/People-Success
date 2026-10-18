import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, sql, gte, lte } from "drizzle-orm";
import type { z } from "zod";
import type { Tx } from "../../db/client";
import type { RequestContext } from "../../auth/context";
import { authorize, can } from "../../auth/context";
import {
  approvalRequests,
  attendanceDays,
  disbursementBatches,
  disbursements,
  employeeLoans,
  employees,
  legalEntities,
  loanRepayments,
  payrollLineItems,
  payrollPeriods,
  payrollRunEmployees,
  payrollRuns,
  payslips,
  users,
} from "../../db/schema";
import { audit } from "../../lib/audit";
import { AppError, forbidden, invalidState, notFound } from "../../lib/errors";
import { emitDomainEvent } from "../events";
import { cancelApprovalForSubject, startApproval, type ApprovalActor } from "../approvals/engine";
import { daysInclusive } from "@/lib/payroll/dates";
import type { Message } from "@/lib/payroll/types";
import type { adjustmentRunSchema, fnfRunSchema, lockRunSchema } from "@/lib/validation/payroll";
import type { FnfSetup } from "./calculate";
import { lastDayOf } from "./loader";
import { actorOf, assertStatus, authorizePayrollRead, computeSnapshotHash, lockRun, periodLabel, POSTED_STATUSES, verifySnapshot, withPayrollGrants, type RunRow } from "./shared";

export const RUN_SUBJECT = "payroll_run";

async function periodFor(tx: Tx, periodId: string) {
  const [period] = await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId));
  if (!period) throw notFound("Payroll period");
  return period;
}

/* ------------------------------------------------------------------ */
/* Creation                                                            */
/* ------------------------------------------------------------------ */

/** Creates (or returns the existing) regular run for a period. */
export async function createRegularRun(ctx: RequestContext, periodId: string) {
  authorize(ctx, "payroll.run", "all");
  return ctx.db(async (tx) => {
    const period = await periodFor(tx, periodId);
    if (period.status === "locked" || period.status === "closed") throw invalidState("This period is locked. Use an adjustment run for corrections.");
    const [existing] = await tx
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.periodId, periodId), eq(payrollRuns.kind, "regular"), ne(payrollRuns.status, "cancelled")));
    if (existing) return { run: existing, created: false };
    const [run] = await tx
      .insert(payrollRuns)
      .values({ tenantId: ctx.tenantId, periodId, legalEntityId: period.legalEntityId, kind: "regular", createdBy: ctx.userId })
      .onConflictDoNothing()
      .returning();
    if (!run) {
      const [raced] = await tx.select().from(payrollRuns).where(and(eq(payrollRuns.periodId, periodId), eq(payrollRuns.kind, "regular"), ne(payrollRuns.status, "cancelled")));
      return { run: raced, created: false };
    }
    await audit(tx, ctx, { action: "payroll.run_created", entityType: "payroll_run", entityId: run.id, metadata: { kind: "regular", periodId } });
    return { run, created: true };
  });
}

async function insertPlaceholders(tx: Tx, ctx: RequestContext, runId: string, calendarDays: number, rows: { employeeId: string; setup: Record<string, unknown> }[]) {
  await tx.insert(payrollRunEmployees).values(
    rows.map((r) => ({
      tenantId: ctx.tenantId,
      runId,
      employeeId: r.employeeId,
      status: "on_hold" as const,
      calendarDays,
      payableDays: 0,
      lopDays: 0,
      grossEarnings: 0,
      totalDeductions: 0,
      employerContributions: 0,
      netPay: 0,
      snapshot: { setup: r.setup },
      messages: [{ severity: "info" as const, code: "not_calculated", message: "Not calculated yet." }],
    })),
  );
}

export async function createFnfRun(ctx: RequestContext, input: z.output<typeof fnfRunSchema>) {
  authorize(ctx, "payroll.run", "all");
  return ctx.db(async (tx) => {
    const period = await periodFor(tx, input.periodId);
    const [emp] = await tx.select().from(employees).where(and(eq(employees.id, input.employeeId), isNull(employees.deletedAt)));
    if (!emp) throw notFound("Employee");
    if (emp.legalEntityId !== period.legalEntityId) throw new AppError("VALIDATION", "The employee belongs to a different legal entity.");
    const last = lastDayOf(emp);
    if (!last) throw invalidState("Record the employee's last working day before starting a full and final settlement.");
    if (last > period.endDate) throw invalidState(`The last working day (${last}) is after this period. Settle in the period that contains it.`);
    const open = await tx
      .select({ id: payrollRuns.id })
      .from(payrollRuns)
      .innerJoin(payrollRunEmployees, eq(payrollRunEmployees.runId, payrollRuns.id))
      .where(and(eq(payrollRuns.kind, "full_and_final"), ne(payrollRuns.status, "cancelled"), eq(payrollRunEmployees.employeeId, emp.id)));
    if (open.length) throw new AppError("CONFLICT", "A full and final settlement already exists for this employee.");
    const [run] = await tx
      .insert(payrollRuns)
      .values({ tenantId: ctx.tenantId, periodId: period.id, legalEntityId: period.legalEntityId, kind: "full_and_final", createdBy: ctx.userId, notes: `Full and final settlement: ${emp.displayName} (${emp.employeeCode})` })
      .returning();
    const setup: FnfSetup = {
      kind: "fnf",
      leaveEncashmentDays: input.leaveEncashmentDays,
      encashmentDivisor: input.encashmentDivisor,
      noticePayDays: input.noticePayDays,
      noticeRecoveryDays: input.noticeRecoveryDays,
      includeGratuity: input.includeGratuity,
    };
    await insertPlaceholders(tx, ctx, run.id, daysInclusive(period.startDate, period.endDate), [{ employeeId: emp.id, setup }]);
    await audit(tx, ctx, { action: "payroll.run_created", entityType: "payroll_run", entityId: run.id, metadata: { kind: "full_and_final", periodId: period.id, employeeId: emp.id } });
    return run;
  });
}

export async function createAdjustmentRun(ctx: RequestContext, input: z.output<typeof adjustmentRunSchema>) {
  authorize(ctx, "payroll.run", "all");
  return ctx.db(async (tx) => {
    const [parent] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, input.parentRunId));
    if (!parent) throw notFound("Payroll run");
    if (!POSTED_STATUSES.includes(parent.status)) throw invalidState("Adjustments can only be made to a locked run.");
    if (parent.kind === "adjustment") throw invalidState("Create the adjustment against the original run.");
    const period = await periodFor(tx, parent.periodId);
    const ids = [...new Set(input.employeeIds)];
    const inParent = await tx
      .select({ e: payrollRunEmployees.employeeId })
      .from(payrollRunEmployees)
      .where(and(eq(payrollRunEmployees.runId, parent.id), inArray(payrollRunEmployees.employeeId, ids)));
    if (inParent.length !== ids.length) throw new AppError("VALIDATION", "Every selected employee must be in the original run.");
    const [run] = await tx
      .insert(payrollRuns)
      .values({ tenantId: ctx.tenantId, periodId: parent.periodId, legalEntityId: parent.legalEntityId, kind: "adjustment", parentRunId: parent.id, createdBy: ctx.userId, notes: input.notes })
      .returning();
    await insertPlaceholders(tx, ctx, run.id, daysInclusive(period.startDate, period.endDate), ids.map((employeeId) => ({ employeeId, setup: { kind: "adjustment" } })));
    await audit(tx, ctx, { action: "payroll.run_created", entityType: "payroll_run", entityId: run.id, metadata: { kind: "adjustment", parentRunId: parent.id, employees: ids.length } });
    return run;
  });
}

export async function cancelRun(ctx: RequestContext, runId: string) {
  authorize(ctx, "payroll.run", "all");
  return ctx.db(async (tx) => {
    const run = await lockRun(tx, runId);
    assertStatus(run, ["draft", "calculated"], "cancel");
    await tx.update(payrollRuns).set({ status: "cancelled", snapshotHash: null }).where(eq(payrollRuns.id, run.id));
    await audit(tx, ctx, { action: "payroll.run_cancelled", entityType: "payroll_run", entityId: run.id, metadata: { kind: run.kind } });
    return { id: run.id };
  });
}

/* ------------------------------------------------------------------ */
/* Approval                                                            */
/* ------------------------------------------------------------------ */

export async function submitRun(ctx: RequestContext, runId: string) {
  authorize(ctx, "payroll.run", "all");
  return ctx.db(async (tx) => {
    const run = await lockRun(tx, runId);
    assertStatus(run, ["calculated"], "submit");
    const rows = await tx.select({ status: payrollRunEmployees.status }).from(payrollRunEmployees).where(eq(payrollRunEmployees.runId, run.id));
    if (!rows.length) throw invalidState("The run has no employees.");
    const errors = rows.filter((r) => r.status === "error").length;
    if (errors) throw invalidState(`Resolve ${errors} employee error${errors === 1 ? "" : "s"} and recalculate before submitting.`);
    if (rows.some((r) => r.status === "on_hold")) throw invalidState("Calculate the run before submitting.");
    const period = await periodFor(tx, run.periodId);
    const [le] = await tx.select({ name: legalEntities.name }).from(legalEntities).where(eq(legalEntities.id, run.legalEntityId));
    const hash = await computeSnapshotHash(tx, run.id);
    await tx.update(payrollRuns).set({ status: "pending_approval", snapshotHash: hash }).where(eq(payrollRuns.id, run.id));
    const kindLabel = run.kind === "regular" ? "Payroll" : run.kind === "full_and_final" ? "Full and final settlement" : run.kind === "adjustment" ? "Payroll adjustment" : "Off-cycle payroll";
    await startApproval(tx, actorOf(ctx), {
      subjectType: RUN_SUBJECT,
      subjectId: run.id,
      title: `${kindLabel} · ${periodLabel(period.year, period.month)} · ${le?.name ?? ""}`.trim(),
      requestedBy: ctx.userId,
      subjectEmployeeId: null,
      context: { kind: run.kind, employees: rows.length, net: run.totals?.net ?? 0, usesUnverifiedRules: run.usesUnverifiedRules },
    });
    await audit(tx, ctx, { action: "payroll.run_submitted", entityType: "payroll_run", entityId: run.id, metadata: { snapshotHash: hash, employees: rows.length } });
    return { snapshotHash: hash };
  });
}

/** Pull a run back from approval (returns it to "calculated"). */
export async function withdrawRun(ctx: RequestContext, runId: string) {
  authorize(ctx, "payroll.run", "all");
  return ctx.db(async (tx) => {
    const run = await lockRun(tx, runId);
    assertStatus(run, ["pending_approval"], "withdraw");
    await cancelApprovalForSubject(tx, actorOf(ctx), RUN_SUBJECT, run.id);
    const [after] = await tx.select({ status: payrollRuns.status }).from(payrollRuns).where(eq(payrollRuns.id, run.id));
    if (after.status === "pending_approval") await returnToCalculated(tx, run.id);
    await audit(tx, ctx, { action: "payroll.run_withdrawn", entityType: "payroll_run", entityId: run.id });
    return { id: run.id };
  });
}

async function returnToCalculated(tx: Tx, runId: string) {
  await tx.update(payrollRuns).set({ status: "calculated", snapshotHash: null, approvedAt: null }).where(and(eq(payrollRuns.id, runId), inArray(payrollRuns.status, ["pending_approval"])));
}

/** Approval engine outcomes (called inside the approver's transaction). */
export async function onRunApproved(tx: Tx, actor: ApprovalActor, runId: string) {
  await withPayrollGrants(tx, ["payroll.view", "payroll.approve"], async () => {
    const run = await lockRun(tx, runId);
    if (run.status !== "pending_approval") throw invalidState(`The payroll run is ${run.status.replace(/_/g, " ")}, not awaiting approval.`);
    await verifySnapshot(tx, run);
    await tx.update(payrollRuns).set({ status: "approved", approvedAt: new Date() }).where(eq(payrollRuns.id, run.id));
    await audit(tx, actor, { action: "payroll.run_approved", entityType: "payroll_run", entityId: run.id, metadata: { snapshotHash: run.snapshotHash } });
  });
}

export async function onRunReturned(tx: Tx, actor: ApprovalActor, runId: string, outcome: "rejected" | "cancelled") {
  await withPayrollGrants(tx, ["payroll.view", "payroll.run"], async () => {
    const run = await lockRun(tx, runId);
    if (run.status !== "pending_approval") return;
    await returnToCalculated(tx, run.id);
    await audit(tx, actor, { action: outcome === "rejected" ? "payroll.run_rejected" : "payroll.run_approval_cancelled", entityType: "payroll_run", entityId: run.id });
  });
}

/* ------------------------------------------------------------------ */
/* Lock                                                                */
/* ------------------------------------------------------------------ */

/**
 * Lock an approved run: verify the snapshot hash, require an explicit
 * override when unverified rule sets were used, freeze attendance, post loan
 * repayments (once per loan and run) and lock the period (regular runs).
 */
export async function lockPayrollRun(ctx: RequestContext, input: z.output<typeof lockRunSchema>) {
  authorize(ctx, "payroll.approve", "all");
  return ctx.db(async (tx) => {
    const run = await lockRun(tx, input.runId);
    assertStatus(run, ["approved"], "lock");
    await verifySnapshot(tx, run);
    if (run.usesUnverifiedRules && !input.overrideUnverified) {
      throw new AppError("PRECONDITION", "This run used statutory rule sets that are not verified. Verify them, or lock with an explicit override.", { details: { needsOverride: true } });
    }
    const period = await periodFor(tx, run.periodId);
    const emps = await tx.select().from(payrollRunEmployees).where(eq(payrollRunEmployees.runId, run.id));
    const now = new Date();

    // Freeze attendance for the period (regular and F&F runs).
    let attendanceLocked = 0;
    if (run.kind !== "adjustment" && emps.length) {
      const locked = await tx
        .update(attendanceDays)
        .set({ lockedByRunId: run.id })
        .where(and(inArray(attendanceDays.employeeId, emps.map((e) => e.employeeId)), gte(attendanceDays.date, period.startDate), lte(attendanceDays.date, period.endDate), isNull(attendanceDays.lockedByRunId)))
        .returning({ id: attendanceDays.id });
      attendanceLocked = locked.length;
    }

    // Loan repayments: unique (loan, run) makes this idempotent.
    let repayments = 0;
    const planned = emps.flatMap((e) => ((e.snapshot as { loans?: { loanId: string; amount: number }[] }).loans ?? []).map((l) => ({ ...l, employeeId: e.employeeId })));
    if (planned.length) {
      await withPayrollGrants(tx, ["payroll.run"], async () => {
        for (const p of planned) {
          if (!(p.amount > 0)) continue;
          const [inserted] = await tx.insert(loanRepayments).values({ tenantId: ctx.tenantId, loanId: p.loanId, runId: run.id, amount: p.amount }).onConflictDoNothing().returning({ id: loanRepayments.id });
          if (!inserted) continue;
          const [loan] = await tx
            .update(employeeLoans)
            .set({ outstanding: sql`greatest(${employeeLoans.outstanding} - ${p.amount}, 0)` })
            .where(eq(employeeLoans.id, p.loanId))
            .returning({ outstanding: employeeLoans.outstanding });
          if (!loan) throw invalidState("A loan in this run could not be updated.");
          if (loan.outstanding === 0) await tx.update(employeeLoans).set({ status: "closed" }).where(eq(employeeLoans.id, p.loanId));
          repayments++;
        }
      });
    }

    await tx
      .update(payrollRuns)
      .set({ status: "locked", lockedAt: now, unverifiedOverrideBy: run.usesUnverifiedRules ? ctx.userId : null })
      .where(eq(payrollRuns.id, run.id));
    if (run.kind === "regular") await tx.update(payrollPeriods).set({ status: "locked" }).where(eq(payrollPeriods.id, period.id));
    await audit(tx, ctx, {
      action: "payroll.run_locked",
      entityType: "payroll_run",
      entityId: run.id,
      metadata: { snapshotHash: run.snapshotHash, unverifiedOverride: run.usesUnverifiedRules, confirmation: run.usesUnverifiedRules ? input.confirmation : undefined, attendanceLocked, repayments },
    });
    await emitDomainEvent(tx, ctx.tenantId, "payroll.locked", { runId: run.id, periodId: period.id, kind: run.kind, legalEntityId: run.legalEntityId }, { dedupeKey: `payroll.locked:${run.id}` });
    return { lockedAt: now.toISOString(), attendanceLocked, repayments };
  });
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export type RunEmployeeRow = {
  id: string;
  employeeId: string;
  name: string;
  code: string;
  status: string;
  calendarDays: number;
  payableDays: number;
  lopDays: number;
  gross: number;
  deductions: number;
  employer: number;
  net: number;
  netPct: number | null;
  varianceFlagged: boolean;
  messages: Message[];
};

export type RunAction = "calculate" | "submit" | "withdraw" | "cancel" | "lock" | "disburse" | "publish" | "adjust" | "explain";

export function runActions(ctx: Pick<RequestContext, "grants">, run: Pick<RunRow, "status" | "kind">, extra: { hasErrors: boolean; employees: number; pendingDisbursement: boolean; payslipsPending: boolean }): RunAction[] {
  const out: RunAction[] = [];
  const canRun = can(ctx, "payroll.run", "all");
  const canApprove = can(ctx, "payroll.approve", "all");
  if (canRun && (run.status === "draft" || run.status === "calculated")) out.push("calculate", "cancel");
  if (canRun && run.status === "calculated" && !extra.hasErrors && extra.employees > 0) out.push("submit");
  if (canRun && run.status === "pending_approval") out.push("withdraw");
  if (canApprove && run.status === "approved") out.push("lock");
  if (canRun && POSTED_STATUSES.includes(run.status) && extra.pendingDisbursement) out.push("disburse");
  if ((canApprove || canRun) && POSTED_STATUSES.includes(run.status) && extra.payslipsPending) out.push("publish");
  if (canRun && POSTED_STATUSES.includes(run.status) && run.kind !== "adjustment") out.push("adjust");
  if (can(ctx, "payroll.view", "all") && run.status !== "draft" && run.status !== "cancelled") out.push("explain");
  return out;
}

export async function getRunDetail(ctx: RequestContext, runId: string) {
  authorizePayrollRead(ctx);
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select({ run: payrollRuns, period: payrollPeriods, le: legalEntities.name, createdByName: users.fullName })
      .from(payrollRuns)
      .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
      .innerJoin(legalEntities, eq(legalEntities.id, payrollRuns.legalEntityId))
      .leftJoin(users, eq(users.id, payrollRuns.createdBy))
      .where(eq(payrollRuns.id, runId));
    if (!row) throw notFound("Payroll run");
    const emps = await tx
      .select({ e: payrollRunEmployees, name: employees.displayName, code: employees.employeeCode })
      .from(payrollRunEmployees)
      .innerJoin(employees, eq(employees.id, payrollRunEmployees.employeeId))
      .where(eq(payrollRunEmployees.runId, runId))
      .orderBy(asc(employees.displayName));
    const [approval] = await tx
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.subjectType, RUN_SUBJECT), eq(approvalRequests.subjectId, runId)))
      .orderBy(desc(approvalRequests.createdAt))
      .limit(1);
    const batches = await tx.select().from(disbursementBatches).where(eq(disbursementBatches.runId, runId)).orderBy(desc(disbursementBatches.createdAt));
    const disb = await tx.select({ status: disbursements.status, employeeId: disbursements.employeeId }).from(disbursements).where(eq(disbursements.runId, runId));
    const slips = await tx.select({ employeeId: payslips.employeeId, publishedAt: payslips.publishedAt }).from(payslips).where(eq(payslips.runId, runId));
    const children = await tx.select({ id: payrollRuns.id, kind: payrollRuns.kind, status: payrollRuns.status, createdAt: payrollRuns.createdAt }).from(payrollRuns).where(eq(payrollRuns.parentRunId, runId));
    const employeesOut: RunEmployeeRow[] = emps.map(({ e, name, code }) => {
      const v = (e.snapshot as { variance?: { netPct: number | null; flagged: boolean } | null }).variance;
      return {
        id: e.id,
        employeeId: e.employeeId,
        name,
        code,
        status: e.status,
        calendarDays: e.calendarDays,
        payableDays: Number(e.payableDays),
        lopDays: Number(e.lopDays),
        gross: e.grossEarnings,
        deductions: e.totalDeductions,
        employer: e.employerContributions,
        net: e.netPay,
        netPct: v?.netPct ?? null,
        varianceFlagged: !!v?.flagged && v.netPct !== null,
        messages: e.messages,
      };
    });
    const payable = employeesOut.filter((e) => e.net > 0 && e.status !== "error" && e.status !== "on_hold" && e.status !== "excluded");
    const activeDisb = new Set(disb.filter((d) => d.status !== "failed" && d.status !== "cancelled").map((d) => d.employeeId));
    const published = new Set(slips.filter((s) => s.publishedAt).map((s) => s.employeeId));
    const extra = {
      hasErrors: employeesOut.some((e) => e.status === "error"),
      employees: employeesOut.length,
      pendingDisbursement: payable.some((e) => !activeDisb.has(e.employeeId)),
      payslipsPending: employeesOut.some((e) => e.status !== "error" && e.status !== "on_hold" && e.status !== "excluded" && !published.has(e.employeeId)),
    };
    return {
      run: row.run,
      period: row.period,
      periodLabel: periodLabel(row.period.year, row.period.month),
      legalEntityName: row.le,
      createdByName: row.createdByName,
      employees: employeesOut,
      approval: approval ? { id: approval.id, status: approval.status, currentStep: approval.currentStep, createdAt: approval.createdAt.toISOString() } : null,
      batches: batches.map((b) => ({ id: b.id, format: b.format, count: b.count, totalAmount: b.totalAmount, status: b.status, createdAt: b.createdAt.toISOString(), documentId: b.documentId })),
      disbursementCounts: countBy(disb.map((d) => d.status)),
      payslipCount: published.size,
      children: children.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
      actions: runActions(ctx, row.run, extra),
    };
  });
}

const countBy = (xs: string[]) => xs.reduce<Record<string, number>>((acc, x) => ((acc[x] = (acc[x] ?? 0) + 1), acc), {});

export async function getRunEmployeeDetail(ctx: RequestContext, runEmployeeId: string) {
  authorizePayrollRead(ctx);
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select({ e: payrollRunEmployees, name: employees.displayName, code: employees.employeeCode })
      .from(payrollRunEmployees)
      .innerJoin(employees, eq(employees.id, payrollRunEmployees.employeeId))
      .where(eq(payrollRunEmployees.id, runEmployeeId));
    if (!row) throw notFound("Payroll result");
    const lines = await tx.select().from(payrollLineItems).where(eq(payrollLineItems.runEmployeeId, runEmployeeId)).orderBy(asc(payrollLineItems.sortOrder), asc(payrollLineItems.componentCode));
    return {
      id: row.e.id,
      runId: row.e.runId,
      employeeId: row.e.employeeId,
      name: row.name,
      code: row.code,
      status: row.e.status,
      calendarDays: row.e.calendarDays,
      payableDays: Number(row.e.payableDays),
      lopDays: Number(row.e.lopDays),
      gross: row.e.grossEarnings,
      deductions: row.e.totalDeductions,
      employer: row.e.employerContributions,
      net: row.e.netPay,
      messages: row.e.messages,
      snapshot: row.e.snapshot,
      lines: lines.map((l) => ({ id: l.id, componentCode: l.componentCode, componentName: l.componentName, kind: l.kind, amount: l.amount, isTaxable: l.isTaxable, explanation: l.explanation })),
    };
  });
}

/** Exited / exiting employees of a period's legal entity with no settlement yet (F&F picker). */
export async function settlementCandidates(ctx: RequestContext, periodId: string) {
  authorize(ctx, "payroll.run", "all");
  return ctx.db(async (tx) => {
    const period = await periodFor(tx, periodId);
    const rows = await tx
      .select({ id: employees.id, name: employees.displayName, code: employees.employeeCode, lwd: sql<string | null>`coalesce(${employees.lastWorkingDate}, ${employees.exitDate})` })
      .from(employees)
      .where(
        and(
          eq(employees.legalEntityId, period.legalEntityId),
          isNull(employees.deletedAt),
          sql`coalesce(${employees.lastWorkingDate}, ${employees.exitDate}) is not null`,
          sql`coalesce(${employees.lastWorkingDate}, ${employees.exitDate}) <= ${period.endDate}`,
          sql`not exists (select 1 from payroll_runs r join payroll_run_employees pre on pre.run_id = r.id where r.kind = 'full_and_final' and r.status <> 'cancelled' and pre.employee_id = ${employees.id})`,
        ),
      )
      .orderBy(asc(employees.displayName))
      .limit(200);
    return rows;
  });
}

export function assertCanSeePayroll(ctx: RequestContext) {
  if (!can(ctx, "payroll.view", "all") && !can(ctx, "payroll.run", "all") && !can(ctx, "payroll.approve", "all")) throw forbidden();
}
