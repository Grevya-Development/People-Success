import "server-only";
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { withSystem } from "../../db/tx";
import { benefitEnrollments, benefitPlans, employees, payrollInputs, payrollPeriods } from "../../db/schema";

export const BENEFIT_SOURCE = "benefit_enrollment";

/** Component code for a plan's salary deduction, e.g. "BENEFIT_GROUP_HEALTH". */
export function benefitComponentCode(planName: string) {
  const slug = planName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return `BENEFIT_${slug || "PLAN"}`;
}

export const periodKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/**
 * Post the employee contribution of every salary-deducted enrollment into
 * each open payroll period. The enrollment in force on the period's last day
 * is charged (one per plan and employee, so a mid-month change is never
 * charged twice). Idempotent: source id "<enrollmentId>:<yyyy-MM>" is unique
 * per tenant. System context: every query filters by tenant.
 */
export async function postBenefitDeductions(tenantId: string) {
  return withSystem(async (tx) => {
    const periods = await tx
      .select()
      .from(payrollPeriods)
      .where(and(eq(payrollPeriods.tenantId, tenantId), eq(payrollPeriods.status, "open")));
    let posted = 0;
    let considered = 0;
    for (const period of periods) {
      const rows = await tx
        .select({
          enrollmentId: benefitEnrollments.id,
          employeeId: benefitEnrollments.employeeId,
          planName: benefitPlans.name,
          amount: benefitPlans.employeeContribution,
        })
        .from(benefitEnrollments)
        .innerJoin(benefitPlans, eq(benefitPlans.id, benefitEnrollments.planId))
        .innerJoin(employees, eq(employees.id, benefitEnrollments.employeeId))
        .where(
          and(
            eq(benefitEnrollments.tenantId, tenantId),
            eq(benefitEnrollments.status, "enrolled"),
            eq(benefitPlans.deductFromSalary, true),
            gt(benefitPlans.employeeContribution, 0),
            eq(employees.legalEntityId, period.legalEntityId),
            isNull(employees.deletedAt),
            lte(benefitEnrollments.effectiveFrom, period.endDate),
            or(isNull(benefitEnrollments.effectiveTo), gt(benefitEnrollments.effectiveTo, period.endDate)),
          ),
        );
      considered += rows.length;
      if (!rows.length) continue;
      const key = periodKey(period.year, period.month);
      const inserted = await tx
        .insert(payrollInputs)
        .values(
          rows.map((r) => ({
            tenantId,
            periodId: period.id,
            employeeId: r.employeeId,
            kind: "deduction" as const,
            componentCode: benefitComponentCode(r.planName),
            amount: r.amount,
            // Post-tax deduction: it does not reduce taxable salary.
            isTaxable: false,
            note: `${r.planName} – employee contribution`,
            sourceType: BENEFIT_SOURCE,
            sourceId: `${r.enrollmentId}:${key}`,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: payrollInputs.id });
      posted += inserted.length;
    }
    return { periods: periods.length, considered, posted };
  }, tenantId);
}

/** Count of posted benefit deductions for a period (used by tests and the HR view). */
export async function benefitDeductionCount(tenantId: string, periodId: string) {
  return withSystem(async (tx) => {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(payrollInputs)
      .where(and(eq(payrollInputs.tenantId, tenantId), eq(payrollInputs.periodId, periodId), eq(payrollInputs.sourceType, BENEFIT_SOURCE)));
    return Number(row?.n ?? 0);
  }, tenantId);
}
