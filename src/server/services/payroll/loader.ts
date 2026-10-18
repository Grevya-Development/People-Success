import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import {
  attendanceDays,
  compensationRecords,
  departments,
  designations,
  employeeLoans,
  employeeSensitive,
  employees,
  leaveRequests,
  leaveTypes,
  legalEntities,
  locations,
  payComponents,
  payrollInputs,
  payrollLineItems,
  payrollPeriods,
  payrollRunEmployees,
  payrollRuns,
  salaryStructures,
  taxDeclarations,
} from "../../db/schema";
import { fyStartYearOf } from "@/lib/payroll/dates";
import type { Ytd } from "@/lib/payroll/types";
import { EMPTY_YTD } from "@/lib/payroll/types";
import { POSTED_STATUSES } from "./shared";

export type PeriodRow = typeof payrollPeriods.$inferSelect;
export type EmployeeRow = typeof employees.$inferSelect;

/**
 * Employees on the period's payroll: same legal entity, not deleted, worker
 * type "employee", status active / on notice / exited, joined on or before
 * the period end, and not gone before the period start.
 */
export async function eligibleEmployees(tx: Tx, period: PeriodRow) {
  return tx
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.legalEntityId, period.legalEntityId),
        isNull(employees.deletedAt),
        eq(employees.workerType, "employee"),
        inArray(employees.status, ["active", "on_notice", "exited"]),
        lte(employees.joiningDate, period.endDate),
        or(sql`coalesce(${employees.lastWorkingDate}, ${employees.exitDate}) is null`, sql`coalesce(${employees.lastWorkingDate}, ${employees.exitDate}) >= ${period.startDate}`),
      ),
    )
    .orderBy(asc(employees.employeeCode));
}

export const lastDayOf = (e: Pick<EmployeeRow, "lastWorkingDate" | "exitDate">) => e.lastWorkingDate ?? e.exitDate ?? null;

export type EmployeeData = {
  employee: EmployeeRow;
  compensation: typeof compensationRecords.$inferSelect | null;
  compensationChangedOn: string | null;
  structure: typeof salaryStructures.$inferSelect | null;
  structureIsDefault: boolean;
  attendance: { date: string; payableFraction: number }[];
  unpaidLeave: { startDate: string; endDate: string; days: number }[];
  inputs: (typeof payrollInputs.$inferSelect)[];
  loans: (typeof employeeLoans.$inferSelect)[];
  sensitive: Pick<typeof employeeSensitive.$inferSelect, "panLast4" | "uan" | "bankAccountLast4" | "bankIfsc" | "bankName" | "taxRegime" | "bankAccountEnc"> | null;
  declaration: typeof taxDeclarations.$inferSelect | null;
  workState: string | null;
  designation: string | null;
  department: string | null;
  location: string | null;
  ytd: Ytd;
  esiCoveredEarlier: boolean;
};

const ym = (y: number, m: number) => y * 12 + m;

/**
 * Loads everything the engine needs for a set of employees in one pass of
 * batched queries (no per-employee round trips).
 */
export async function loadEmployeeData(
  tx: Tx,
  period: PeriodRow,
  emps: EmployeeRow[],
  opts: { esiPeriodStart: { year: number; month: number } | null },
): Promise<Map<string, EmployeeData>> {
  const ids = emps.map((e) => e.id);
  const out = new Map<string, EmployeeData>();
  if (!ids.length) return out;
  const fy = fyStartYearOf(period.year, period.month);

  const [comps, defaults, att, leaves, inputs, loans, sens, decls, locs, desigs, depts, le] = await Promise.all([
    tx
      .select()
      .from(compensationRecords)
      .where(and(inArray(compensationRecords.employeeId, ids), lte(compensationRecords.effectiveFrom, period.endDate), or(isNull(compensationRecords.effectiveTo), gte(compensationRecords.effectiveTo, period.startDate))))
      .orderBy(asc(compensationRecords.effectiveFrom)),
    tx.select().from(salaryStructures).where(and(eq(salaryStructures.isDefault, true), eq(salaryStructures.isActive, true))).limit(1),
    tx
      .select({ employeeId: attendanceDays.employeeId, date: attendanceDays.date, payableFraction: attendanceDays.payableFraction })
      .from(attendanceDays)
      .where(and(inArray(attendanceDays.employeeId, ids), gte(attendanceDays.date, period.startDate), lte(attendanceDays.date, period.endDate))),
    tx
      .select({ employeeId: leaveRequests.employeeId, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate, days: leaveRequests.days })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(inArray(leaveRequests.employeeId, ids), eq(leaveRequests.status, "approved"), eq(leaveTypes.isPaid, false), lte(leaveRequests.startDate, period.endDate), gte(leaveRequests.endDate, period.startDate))),
    tx.select().from(payrollInputs).where(and(eq(payrollInputs.periodId, period.id), inArray(payrollInputs.employeeId, ids))).orderBy(asc(payrollInputs.createdAt), asc(payrollInputs.id)),
    tx.select().from(employeeLoans).where(and(inArray(employeeLoans.employeeId, ids), eq(employeeLoans.status, "active"), sql`${employeeLoans.outstanding} > 0`)),
    tx
      .select({
        employeeId: employeeSensitive.employeeId,
        panLast4: employeeSensitive.panLast4,
        uan: employeeSensitive.uan,
        bankAccountLast4: employeeSensitive.bankAccountLast4,
        bankIfsc: employeeSensitive.bankIfsc,
        bankName: employeeSensitive.bankName,
        taxRegime: employeeSensitive.taxRegime,
        bankAccountEnc: employeeSensitive.bankAccountEnc,
      })
      .from(employeeSensitive)
      .where(inArray(employeeSensitive.employeeId, ids)),
    tx.select().from(taxDeclarations).where(and(inArray(taxDeclarations.employeeId, ids), eq(taxDeclarations.fyStartYear, fy))),
    tx.select({ id: locations.id, name: locations.name, stateCode: locations.stateCode }).from(locations),
    tx.select({ id: designations.id, title: designations.title }).from(designations),
    tx.select({ id: departments.id, name: departments.name }).from(departments),
    tx.select({ stateCode: legalEntities.stateCode }).from(legalEntities).where(eq(legalEntities.id, period.legalEntityId)),
  ]);

  // YTD (same FY, same legal entity, earlier periods) from posted runs.
  const fyStart = ym(fy, 4);
  const current = ym(period.year, period.month);
  const ytdRows = await tx
    .select({
      employeeId: payrollRunEmployees.employeeId,
      periodId: payrollRuns.periodId,
      year: payrollPeriods.year,
      month: payrollPeriods.month,
      code: payrollLineItems.componentCode,
      kind: payrollLineItems.kind,
      isTaxable: payrollLineItems.isTaxable,
      amount: payrollLineItems.amount,
    })
    .from(payrollLineItems)
    .innerJoin(payrollRunEmployees, eq(payrollRunEmployees.id, payrollLineItems.runEmployeeId))
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunEmployees.runId))
    .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
    .where(
      and(
        inArray(payrollRunEmployees.employeeId, ids),
        inArray(payrollRuns.status, POSTED_STATUSES),
        eq(payrollRuns.legalEntityId, period.legalEntityId),
        sql`(${payrollPeriods.year} * 12 + ${payrollPeriods.month}) >= ${fyStart}`,
        sql`(${payrollPeriods.year} * 12 + ${payrollPeriods.month}) < ${current}`,
      ),
    );

  const locById = new Map(locs.map((l) => [l.id, l]));
  const desigById = new Map(desigs.map((d) => [d.id, d.title]));
  const deptById = new Map(depts.map((d) => [d.id, d.name]));
  const structureIds = [...new Set(comps.map((c) => c.salaryStructureId).filter(Boolean) as string[])];
  const structures = structureIds.length ? await tx.select().from(salaryStructures).where(inArray(salaryStructures.id, structureIds)) : [];
  const structById = new Map(structures.map((s) => [s.id, s]));
  const defaultStructure = defaults[0] ?? null;

  for (const e of emps) {
    const last = lastDayOf(e);
    const windowEnd = last && last < period.endDate ? last : period.endDate;
    const windowStart = e.joiningDate > period.startDate ? e.joiningDate : period.startDate;
    const mine = comps.filter((c) => c.employeeId === e.id);
    const compensation = mine.find((c) => c.effectiveFrom <= windowEnd && (!c.effectiveTo || c.effectiveTo > windowEnd)) ?? null;
    const changed = mine.find((c) => c.effectiveFrom > windowStart && c.effectiveFrom <= windowEnd)?.effectiveFrom ?? null;
    const assigned = compensation?.salaryStructureId ? (structById.get(compensation.salaryStructureId) ?? null) : null;
    const ytd: Ytd = { ...EMPTY_YTD };
    const months = new Set<string>();
    let esiEarlier = false;
    for (const r of ytdRows.filter((x) => x.employeeId === e.id)) {
      months.add(r.periodId);
      if ((r.kind === "earning" || r.kind === "reimbursement") && r.isTaxable) ytd.taxableEarnings += r.amount;
      if (r.code === "TDS") ytd.tds += r.amount;
      if (r.code === "PF_EE") ytd.pfEmployee += r.amount;
      if (r.code === "PT") ytd.professionalTax += r.amount;
      if (r.code === "HRA") ytd.hra += r.amount;
      if (r.code === "BASIC") ytd.basic += r.amount;
    }
    ytd.monthsProcessed = months.size;
    if (opts.esiPeriodStart) {
      const start = ym(opts.esiPeriodStart.year, opts.esiPeriodStart.month);
      esiEarlier = ytdRows.some((r) => r.employeeId === e.id && r.code === "ESI_EE" && r.amount > 0 && ym(r.year, r.month) >= start);
    }
    const loc = e.locationId ? locById.get(e.locationId) : undefined;
    out.set(e.id, {
      employee: e,
      compensation,
      compensationChangedOn: changed,
      structure: assigned ?? (compensation && !compensation.salaryStructureId ? defaultStructure : null),
      structureIsDefault: !assigned && !!defaultStructure,
      attendance: att.filter((a) => a.employeeId === e.id).map((a) => ({ date: a.date, payableFraction: Number(a.payableFraction) })),
      unpaidLeave: leaves.filter((l) => l.employeeId === e.id).map((l) => ({ startDate: l.startDate, endDate: l.endDate, days: Number(l.days) })),
      inputs: inputs.filter((i) => i.employeeId === e.id),
      loans: loans.filter((l) => l.employeeId === e.id && ym(l.startPeriodYear, l.startPeriodMonth) <= current),
      sensitive: sens.find((s) => s.employeeId === e.id) ?? null,
      declaration: decls.find((d) => d.employeeId === e.id) ?? null,
      workState: loc?.stateCode ?? le[0]?.stateCode ?? null,
      designation: e.designationId ? (desigById.get(e.designationId) ?? null) : null,
      department: e.departmentId ? (deptById.get(e.departmentId) ?? null) : null,
      location: loc?.name ?? null,
      ytd,
      esiCoveredEarlier: esiEarlier,
    });
  }
  return out;
}

/** Results of the latest posted regular run before this period (variance baseline). */
export async function previousPostedRun(tx: Tx, period: PeriodRow, employeeIds: string[]) {
  const [prev] = await tx
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
    .where(
      and(
        eq(payrollRuns.legalEntityId, period.legalEntityId),
        eq(payrollRuns.kind, "regular"),
        inArray(payrollRuns.status, POSTED_STATUSES),
        lt(sql`(${payrollPeriods.year} * 12 + ${payrollPeriods.month})`, ym(period.year, period.month)),
      ),
    )
    .orderBy(desc(payrollPeriods.year), desc(payrollPeriods.month))
    .limit(1);
  if (!prev || !employeeIds.length) return { runId: prev?.id ?? null, byEmployee: new Map<string, { gross: number; net: number; lines: { componentCode: string; componentName: string; kind: string; amount: number }[] }>() };
  const emps = await tx
    .select()
    .from(payrollRunEmployees)
    .where(and(eq(payrollRunEmployees.runId, prev.id), inArray(payrollRunEmployees.employeeId, employeeIds)));
  const lines = emps.length
    ? await tx
        .select()
        .from(payrollLineItems)
        .where(inArray(payrollLineItems.runEmployeeId, emps.map((e) => e.id)))
    : [];
  const byEmployee = new Map(
    emps.map((e) => [
      e.employeeId,
      {
        gross: e.grossEarnings,
        net: e.netPay,
        lines: lines.filter((l) => l.runEmployeeId === e.id).map((l) => ({ componentCode: l.componentCode, componentName: l.componentName, kind: l.kind, amount: l.amount })),
      },
    ]),
  );
  return { runId: prev.id, byEmployee };
}

export async function componentsFor(tx: Tx) {
  return tx.select().from(payComponents).where(eq(payComponents.isActive, true)).orderBy(asc(payComponents.sortOrder));
}
