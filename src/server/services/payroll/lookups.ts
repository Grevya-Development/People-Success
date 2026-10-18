import "server-only";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { RequestContext } from "../../auth/context";
import { employees, legalEntities, payComponents, salaryStructures } from "../../db/schema";
import { authorizePayrollRead } from "./shared";

/** Options for payroll forms (employee pickers, components, structures, legal entities). */
export async function payrollLookups(ctx: RequestContext, opts: { legalEntityId?: string } = {}) {
  authorizePayrollRead(ctx);
  return ctx.db(async (tx) => {
    const [emps, comps, structures, entities] = await Promise.all([
      tx
        .select({ id: employees.id, name: employees.displayName, code: employees.employeeCode, legalEntityId: employees.legalEntityId })
        .from(employees)
        .where(and(isNull(employees.deletedAt), ne(employees.status, "pending"), opts.legalEntityId ? eq(employees.legalEntityId, opts.legalEntityId) : undefined))
        .orderBy(asc(employees.displayName))
        .limit(2000),
      tx.select({ code: payComponents.code, name: payComponents.name, kind: payComponents.kind, calculation: payComponents.calculation, isTaxable: payComponents.isTaxable }).from(payComponents).where(eq(payComponents.isActive, true)).orderBy(asc(payComponents.sortOrder)),
      tx.select({ id: salaryStructures.id, name: salaryStructures.name }).from(salaryStructures).where(eq(salaryStructures.isActive, true)).orderBy(asc(salaryStructures.name)),
      tx.select({ id: legalEntities.id, name: legalEntities.name }).from(legalEntities).where(eq(legalEntities.isActive, true)).orderBy(asc(legalEntities.name)),
    ]);
    return {
      employees: emps.map((e) => ({ value: e.id, label: `${e.name} (${e.code})` })),
      components: comps,
      structures: structures.map((s) => ({ value: s.id, label: s.name })),
      legalEntities: entities.map((l) => ({ value: l.id, label: l.name })),
    };
  });
}
