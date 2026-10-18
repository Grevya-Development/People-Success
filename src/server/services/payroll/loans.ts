import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import type { RequestContext } from "../../auth/context";
import { authorize } from "../../auth/context";
import { employeeLoans, employees, loanRepayments } from "../../db/schema";
import { audit } from "../../lib/audit";
import { notFound } from "../../lib/errors";
import { toPaise, type loanSchema } from "@/lib/validation/payroll";
import { authorizePayrollRead } from "./shared";

export async function listLoans(ctx: RequestContext) {
  authorizePayrollRead(ctx);
  return ctx.db(async (tx) =>
    tx
      .select({ l: employeeLoans, name: employees.displayName, code: employees.employeeCode })
      .from(employeeLoans)
      .innerJoin(employees, eq(employees.id, employeeLoans.employeeId))
      .orderBy(desc(employeeLoans.createdAt))
      .limit(200),
  );
}

/** Record an approved loan or salary advance; installments are recovered from the start period. */
export async function createLoan(ctx: RequestContext, input: z.output<typeof loanSchema>) {
  authorize(ctx, "payroll.run", "all");
  return ctx.db(async (tx) => {
    const [emp] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, input.employeeId), isNull(employees.deletedAt)));
    if (!emp) throw notFound("Employee");
    const principal = toPaise(input.principal);
    const [row] = await tx
      .insert(employeeLoans)
      .values({
        tenantId: ctx.tenantId,
        employeeId: input.employeeId,
        kind: input.kind,
        principal,
        monthlyInstallment: toPaise(input.monthlyInstallment),
        outstanding: principal,
        startPeriodYear: input.startYear,
        startPeriodMonth: input.startMonth,
        approvedBy: ctx.userId,
        notes: input.notes,
      })
      .returning();
    await audit(tx, ctx, { action: "payroll.loan_created", entityType: "employee_loan", entityId: row.id, metadata: { employeeId: row.employeeId, kind: row.kind, start: `${row.startPeriodYear}-${row.startPeriodMonth}` } });
    return row;
  });
}

export async function loanRepaymentHistory(ctx: RequestContext, loanId: string) {
  authorizePayrollRead(ctx);
  return ctx.db((tx) => tx.select().from(loanRepayments).where(eq(loanRepayments.loanId, loanId)).orderBy(desc(loanRepayments.createdAt)));
}
