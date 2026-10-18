import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { RequestContext } from "../../auth/context";
import { AppError } from "../../lib/errors";
import type { Tx } from "../../db/client";
import {
  costCenters,
  departments,
  designations,
  employees,
  grades,
  legalEntities,
  locations,
} from "../../db/schema";

export type Option = { value: string; label: string; hint?: string };

export type EmployeeFormLookups = {
  legalEntities: Option[];
  departments: Option[];
  designations: Option[];
  locations: Option[];
  grades: Option[];
  costCenters: Option[];
  managers: Option[];
  defaultLegalEntityId: string | null;
};

/** Options for employee forms. One round trip of parallel indexed queries. */
export async function employeeFormLookups(ctx: RequestContext): Promise<EmployeeFormLookups> {
  return ctx.db(async (tx) => {
    const [les, deps, desigs, locs, grs, ccs, mgrs] = await Promise.all([
      tx.select().from(legalEntities).where(eq(legalEntities.isActive, true)).orderBy(asc(legalEntities.name)),
      tx.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.isActive, true)).orderBy(asc(departments.name)),
      tx.select({ id: designations.id, title: designations.title }).from(designations).where(eq(designations.isActive, true)).orderBy(asc(designations.title)),
      tx.select({ id: locations.id, name: locations.name }).from(locations).where(eq(locations.isActive, true)).orderBy(asc(locations.name)),
      tx.select({ id: grades.id, code: grades.code, name: grades.name }).from(grades).orderBy(asc(grades.rank)),
      tx.select({ id: costCenters.id, code: costCenters.code, name: costCenters.name }).from(costCenters).where(eq(costCenters.isActive, true)).orderBy(asc(costCenters.code)),
      tx
        .select({ id: employees.id, name: employees.displayName, code: employees.employeeCode })
        .from(employees)
        .where(and(isNull(employees.deletedAt), inArray(employees.status, ["active", "on_notice"])))
        .orderBy(asc(employees.displayName))
        .limit(5000),
    ]);
    return {
      legalEntities: les.map((l) => ({ value: l.id, label: l.name })),
      defaultLegalEntityId: les.find((l) => l.isDefault)?.id ?? les[0]?.id ?? null,
      departments: deps.map((d) => ({ value: d.id, label: d.name })),
      designations: desigs.map((d) => ({ value: d.id, label: d.title })),
      locations: locs.map((l) => ({ value: l.id, label: l.name })),
      grades: grs.map((g) => ({ value: g.id, label: `${g.code} · ${g.name}` })),
      costCenters: ccs.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })),
      managers: mgrs.map((m) => ({ value: m.id, label: m.name, hint: m.code })),
    };
  });
}

/**
 * Verify that referenced org records exist in the caller's tenant. RLS hides
 * other tenants' rows, so a missing row means the id is invalid here.
 */
export async function assertOrgRefs(
  tx: Tx,
  refs: {
    legalEntityId?: string | null;
    departmentId?: string | null;
    designationId?: string | null;
    locationId?: string | null;
    gradeId?: string | null;
    costCenterId?: string | null;
    managerId?: string | null;
  },
) {
  const checks: [string, string | null | undefined, () => Promise<unknown[]>][] = [
    ["legalEntityId", refs.legalEntityId, () => tx.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.id, refs.legalEntityId!))],
    ["departmentId", refs.departmentId, () => tx.select({ id: departments.id }).from(departments).where(eq(departments.id, refs.departmentId!))],
    ["designationId", refs.designationId, () => tx.select({ id: designations.id }).from(designations).where(eq(designations.id, refs.designationId!))],
    ["locationId", refs.locationId, () => tx.select({ id: locations.id }).from(locations).where(eq(locations.id, refs.locationId!))],
    ["gradeId", refs.gradeId, () => tx.select({ id: grades.id }).from(grades).where(eq(grades.id, refs.gradeId!))],
    ["costCenterId", refs.costCenterId, () => tx.select({ id: costCenters.id }).from(costCenters).where(eq(costCenters.id, refs.costCenterId!))],
    [
      "managerId",
      refs.managerId,
      () =>
        tx
          .select({ id: employees.id })
          .from(employees)
          .where(and(eq(employees.id, refs.managerId!), isNull(employees.deletedAt), inArray(employees.status, ["active", "on_notice", "pending"]))),
    ],
  ];
  const results = await Promise.all(checks.map(async ([field, id, q]) => (id ? [field, (await q()).length > 0] : [field, true])));
  const bad = results.filter(([, ok]) => !ok).map(([f]) => f as string);
  if (bad.length) {
    throw new AppError("VALIDATION", "Some selections are no longer valid. Refresh and try again.", {
      fieldErrors: Object.fromEntries(bad.map((f) => [f, ["Not found"]])),
    });
  }
}
