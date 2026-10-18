import "server-only";
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import type { RequestContext } from "../../auth/context";
import { can } from "../../auth/context";
import { payrollLineItems, payrollRunEmployees, payrollRuns } from "../../db/schema";
import { forbidden, invalidState, notFound } from "../../lib/errors";
import { sha256 } from "../../lib/crypto";
import { canonicalJson } from "@/lib/payroll/variance";
import { MONTHS } from "@/lib/india";
import type { Permission } from "@/lib/permissions";

export type RunRow = typeof payrollRuns.$inferSelect;
export type RunStatus = RunRow["status"];

export const POSTED_STATUSES: RunStatus[] = ["locked", "disbursed", "published"];
export const FROZEN_STATUSES: RunStatus[] = ["approved", "locked", "disbursed", "published"];

export const periodLabel = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;

const PAYROLL_PERMS: Permission[] = ["payroll.view", "payroll.run", "payroll.approve", "payroll.config"];

/** Any payroll staff permission (tenant-wide). */
export const isPayrollStaff = (ctx: Pick<RequestContext, "grants">) => PAYROLL_PERMS.some((p) => can(ctx, p, "all"));

export function authorizePayrollRead(ctx: Pick<RequestContext, "grants">) {
  if (!isPayrollStaff(ctx)) throw forbidden();
}

export function authorizeAny(ctx: Pick<RequestContext, "grants">, perms: Permission[]) {
  if (!perms.some((p) => can(ctx, p, "all"))) throw forbidden();
}

export async function lockRun(tx: Tx, runId: string) {
  const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).for("update");
  if (!run) throw notFound("Payroll run");
  return run;
}

export function assertStatus(run: RunRow, allowed: RunStatus[], action: string) {
  if (!allowed.includes(run.status)) {
    throw invalidState(`Cannot ${action} a run that is ${run.status.replace(/_/g, " ")}.`);
  }
}

/**
 * Run `fn` with additional payroll grants for the current transaction only.
 *
 * Used in exactly two places where the database policy is narrower than the
 * business rule, after the service has authorized the action itself:
 *  - approval outcomes: the approval engine has verified the decider is an
 *    assigned approver (e.g. an HR reviewer without payroll rights rejecting),
 *    so the run's state transition must follow the decision;
 *  - locking by a payroll.approve holder posts loan repayments, but
 *    employee_loans updates require payroll.run under RLS.
 * See docs/PAYROLL.md ("RLS gaps") for the policy change that removes this.
 */
export async function withPayrollGrants<T>(tx: Tx, extra: Permission[], fn: () => Promise<T>): Promise<T> {
  const rows = await tx.execute<{ perms: string | null }>(sql`select current_setting('app.perms', true) as perms`);
  const current = rows[0]?.perms ?? "";
  const elevated = [current, ...extra.map((p) => `${p}:all`)].filter(Boolean).join(",");
  await tx.execute(sql`select set_config('app.perms', ${elevated}, true)`);
  try {
    return await fn();
  } finally {
    try {
      await tx.execute(sql`select set_config('app.perms', ${current}, true)`);
    } catch {
      // The transaction is already aborted; its settings are discarded with it.
    }
  }
}

/**
 * SHA-256 over the canonical JSON of every run employee result and line item.
 * Computed at submission; verified before lock, disbursement and publishing.
 */
export async function computeSnapshotHash(tx: Tx, runId: string) {
  const emps = await tx
    .select({
      id: payrollRunEmployees.id,
      employeeId: payrollRunEmployees.employeeId,
      status: payrollRunEmployees.status,
      calendarDays: payrollRunEmployees.calendarDays,
      payableDays: payrollRunEmployees.payableDays,
      lopDays: payrollRunEmployees.lopDays,
      grossEarnings: payrollRunEmployees.grossEarnings,
      totalDeductions: payrollRunEmployees.totalDeductions,
      employerContributions: payrollRunEmployees.employerContributions,
      netPay: payrollRunEmployees.netPay,
      currency: payrollRunEmployees.currency,
    })
    .from(payrollRunEmployees)
    .where(eq(payrollRunEmployees.runId, runId))
    .orderBy(asc(payrollRunEmployees.employeeId));
  const ids = emps.map((e) => e.id);
  const lines = ids.length
    ? await tx
        .select({
          runEmployeeId: payrollLineItems.runEmployeeId,
          componentCode: payrollLineItems.componentCode,
          componentName: payrollLineItems.componentName,
          kind: payrollLineItems.kind,
          amount: payrollLineItems.amount,
          isTaxable: payrollLineItems.isTaxable,
          explanation: payrollLineItems.explanation,
          sortOrder: payrollLineItems.sortOrder,
        })
        .from(payrollLineItems)
        .where(inArray(payrollLineItems.runEmployeeId, ids))
    : [];
  const byEmp = new Map<string, typeof lines>();
  for (const l of lines) byEmp.set(l.runEmployeeId, [...(byEmp.get(l.runEmployeeId) ?? []), l]);
  const payload = emps.map(({ id, ...e }) => ({
    ...e,
    payableDays: Number(e.payableDays),
    lopDays: Number(e.lopDays),
    lines: (byEmp.get(id) ?? [])
      .map((l) => ({ componentCode: l.componentCode, componentName: l.componentName, kind: l.kind, amount: l.amount, isTaxable: l.isTaxable, explanation: l.explanation, sortOrder: l.sortOrder }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.componentCode.localeCompare(b.componentCode) || a.amount - b.amount || a.explanation.localeCompare(b.explanation)),
  }));
  return sha256(canonicalJson({ runId, employees: payload }));
}

export async function verifySnapshot(tx: Tx, run: RunRow) {
  if (!run.snapshotHash) throw invalidState("This run has no approval snapshot. Submit it for approval first.");
  const now = await computeSnapshotHash(tx, run.id);
  if (now !== run.snapshotHash) {
    throw invalidState("Payroll results no longer match the approved snapshot. The run cannot proceed; contact your administrator.");
  }
}

export const actorOf = (ctx: RequestContext) => ({ tenantId: ctx.tenantId, userId: ctx.userId });
