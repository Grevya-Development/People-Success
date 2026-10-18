import "server-only";
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { withSystem } from "../../db/tx";
import { employees, expenseCategories, expenseClaims, expenseItems, payrollInputs, payrollPeriods } from "../../db/schema";
import { audit } from "../../lib/audit";
import { notify } from "../notifications";
import { userIdForEmployee } from "../directory";
import { todayIn } from "@/lib/format";
import { MONTHS } from "@/lib/india";

export const REIMBURSEMENT_SOURCE = "expense_claim";
export const REIMBURSEMENT_COMPONENT = "REIMB";

/**
 * Payroll inputs and periods are payroll-only under RLS. An approved claim
 * must reach payroll even when the final approver is a fallback approver
 * without payroll rights, so — after the approval engine has verified the
 * decider — the reimbursement insert runs with payroll.run added to this
 * transaction's grants. Nothing else runs under the elevated grants. In
 * system context (jobs) RLS does not apply and this is a no-op.
 */
async function withPayrollPosting<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  const [state] = await tx.execute<{ role: string | null; perms: string | null }>(
    sql`select current_setting('role', true) as role, current_setting('app.perms', true) as perms`,
  );
  if (state?.role !== "authenticated") return fn();
  const current = state.perms ?? "";
  await tx.execute(sql`select set_config('app.perms', ${[current, "payroll.run:all"].filter(Boolean).join(",")}, true)`);
  try {
    return await fn();
  } finally {
    try {
      await tx.execute(sql`select set_config('app.perms', ${current}, true)`);
    } catch {
      // Transaction already aborted; its settings are discarded with it.
    }
  }
}

export type PostResult =
  | { status: "posted"; periodLabel: string; inputIds: string[] }
  | { status: "already_posted" }
  | { status: "awaiting_period" }
  | { status: "skipped"; reason: string };

/**
 * Post an approved payroll-method claim as reimbursement input(s) into the
 * employee's open payroll period. Idempotent: the unique index on
 * (tenant, source_type, source_id) means a claim is posted at most once,
 * however many times approval handlers or jobs call this.
 *
 * Items in taxable categories are posted as a separate, taxable input
 * (source id "<claimId>:taxable") so tax treatment follows the category.
 */
export async function postReimbursement(tx: Tx, tenantId: string, claimId: string, actorUserId: string | null): Promise<PostResult> {
  const [claim] = await tx
    .select()
    .from(expenseClaims)
    .where(and(eq(expenseClaims.id, claimId), eq(expenseClaims.tenantId, tenantId)))
    .for("update");
  if (!claim) return { status: "skipped", reason: "not found" };
  if (claim.status !== "approved") return { status: "skipped", reason: `claim is ${claim.status}` };
  if (claim.reimbursementMethod !== "payroll") return { status: "skipped", reason: "bank transfer" };
  if (claim.payrollInputId) return { status: "already_posted" };

  const [emp] = await tx
    .select({ legalEntityId: employees.legalEntityId })
    .from(employees)
    .where(and(eq(employees.id, claim.employeeId), eq(employees.tenantId, tenantId)));
  if (!emp) return { status: "skipped", reason: "employee missing" };

  const groups = await tx
    .select({
      taxable: expenseCategories.isTaxable,
      amount: sql<number>`sum(${expenseItems.amount})`.mapWith(Number),
    })
    .from(expenseItems)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenseItems.categoryId))
    .where(eq(expenseItems.claimId, claim.id))
    .groupBy(expenseCategories.isTaxable);
  if (!groups.length) return { status: "skipped", reason: "no items" };

  return withPayrollPosting(tx, async () => {
    const today = todayIn();
    const [period] = await tx
      .select()
      .from(payrollPeriods)
      .where(
        and(
          eq(payrollPeriods.tenantId, tenantId),
          eq(payrollPeriods.legalEntityId, emp.legalEntityId),
          eq(payrollPeriods.status, "open"),
          gte(payrollPeriods.inputCutoffDate, today),
        ),
      )
      .orderBy(asc(payrollPeriods.year), asc(payrollPeriods.month))
      .limit(1);
    if (!period) return { status: "awaiting_period" as const };

    // A single-group claim uses the claim id; a mixed claim adds a taxable twin.
    const onlyTaxable = groups.length === 1 && groups[0].taxable;
    const rows = groups.map((g) => ({
      tenantId,
      periodId: period.id,
      employeeId: claim.employeeId,
      kind: "reimbursement" as const,
      componentCode: REIMBURSEMENT_COMPONENT,
      amount: g.amount,
      isTaxable: g.taxable,
      note: `Expense claim ${claim.number}${g.taxable && !onlyTaxable ? " (taxable items)" : ""}`,
      sourceType: REIMBURSEMENT_SOURCE,
      sourceId: g.taxable && !onlyTaxable ? `${claim.id}:taxable` : claim.id,
      createdBy: actorUserId,
    }));
    await tx.insert(payrollInputs).values(rows).onConflictDoNothing();
    const posted = await tx
      .select({ id: payrollInputs.id, sourceId: payrollInputs.sourceId })
      .from(payrollInputs)
      .where(
        and(
          eq(payrollInputs.tenantId, tenantId),
          eq(payrollInputs.sourceType, REIMBURSEMENT_SOURCE),
          sql`${payrollInputs.sourceId} in (${claim.id}, ${claim.id + ":taxable"})`,
        ),
      );
    const primary = posted.find((p) => p.sourceId === claim.id) ?? posted[0];
    await tx.update(expenseClaims).set({ payrollInputId: primary?.id ?? null }).where(eq(expenseClaims.id, claim.id));
    const periodLabel = `${MONTHS[period.month - 1]} ${period.year}`;
    await audit(tx, { tenantId, userId: actorUserId, actorType: actorUserId ? "user" : "system" }, {
      action: "expense_claim.posted_to_payroll",
      entityType: "expense_claim",
      entityId: claim.id,
      metadata: { periodId: period.id, period: periodLabel, inputs: posted.length },
    });
    return { status: "posted" as const, periodLabel, inputIds: posted.map((p) => p.id) };
  });
}

/**
 * Post every approved payroll-method claim still waiting for a period.
 * Run daily and whenever a payroll period opens. System context.
 */
export async function postPendingReimbursements(tenantId: string) {
  return withSystem(async (tx) => {
    const waiting = await tx
      .select({ id: expenseClaims.id, number: expenseClaims.number, employeeId: expenseClaims.employeeId })
      .from(expenseClaims)
      .where(
        and(
          eq(expenseClaims.tenantId, tenantId),
          eq(expenseClaims.status, "approved"),
          eq(expenseClaims.reimbursementMethod, "payroll"),
          isNull(expenseClaims.payrollInputId),
        ),
      )
      .limit(500);
    let posted = 0;
    for (const c of waiting) {
      const r = await postReimbursement(tx, tenantId, c.id, null);
      if (r.status !== "posted") continue;
      posted++;
      const userId = await userIdForEmployee(tx, c.employeeId);
      if (userId) {
        await notify(tx, {
          tenantId,
          userIds: [userId],
          category: "expenses",
          title: `${c.number} added to ${r.periodLabel} payroll`,
          body: "Your approved reimbursement will be paid with salary.",
          href: `/expenses/${c.id}`,
          dedupeKey: `expense:${c.id}:posted`,
        });
      }
    }
    return { waiting: waiting.length, posted };
  }, tenantId);
}
