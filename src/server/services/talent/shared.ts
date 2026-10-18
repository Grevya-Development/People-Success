import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { departments, designations, employees, locations } from "../../db/schema";
import { forbidden } from "../../lib/errors";
import type { RequestContext } from "../../auth/context";

export type EmployeeBasics = {
  id: string;
  name: string;
  code: string;
  userId: string | null;
  managerId: string | null;
  departmentId: string | null;
  designationId: string | null;
  locationId: string | null;
  joiningDate: string;
  status: string;
};

export const CURRENT_STATUSES = ["active", "on_notice"] as const;

/** Basic employee facts for a set of ids (tenant-scoped by RLS or by the caller in system context). */
export async function employeeBasics(tx: Tx, ids: (string | null | undefined)[]): Promise<Map<string, EmployeeBasics>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const rows = await tx
    .select({
      id: employees.id,
      name: employees.displayName,
      code: employees.employeeCode,
      userId: employees.userId,
      managerId: employees.managerId,
      departmentId: employees.departmentId,
      designationId: employees.designationId,
      locationId: employees.locationId,
      joiningDate: employees.joiningDate,
      status: employees.status,
    })
    .from(employees)
    .where(and(inArray(employees.id, unique), isNull(employees.deletedAt)));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function userIdsOf(tx: Tx, employeeIds: (string | null | undefined)[]) {
  const map = await employeeBasics(tx, employeeIds);
  return [...map.values()].map((e) => e.userId).filter((u): u is string => !!u);
}

/** The signed-in user's employee id, or a clear error when the account is not linked. */
export function requireEmployeeId(ctx: RequestContext): string {
  if (!ctx.employeeId) throw forbidden("Your account is not linked to an employee record yet. Ask HR to link it.");
  return ctx.employeeId;
}

export async function lookupLabels(tx: Tx) {
  const [deps, locs, desigs] = await Promise.all([
    tx.select({ id: departments.id, name: departments.name }).from(departments),
    tx.select({ id: locations.id, name: locations.name }).from(locations),
    tx.select({ id: designations.id, title: designations.title }).from(designations),
  ]);
  return {
    departments: Object.fromEntries(deps.map((d) => [d.id, d.name])) as Record<string, string>,
    locations: Object.fromEntries(locs.map((l) => [l.id, l.name])) as Record<string, string>,
    designations: Object.fromEntries(desigs.map((d) => [d.id, d.title])) as Record<string, string>,
  };
}

export type Option = { value: string; label: string; hint?: string };

/** Active employees as select options (directory data is tenant-visible). */
export async function employeeOptions(tx: Tx, opts: { ids?: string[] } = {}): Promise<Option[]> {
  if (opts.ids && !opts.ids.length) return [];
  const rows = await tx
    .select({ id: employees.id, name: employees.displayName, code: employees.employeeCode })
    .from(employees)
    .where(
      and(
        isNull(employees.deletedAt),
        inArray(employees.status, [...CURRENT_STATUSES]),
        opts.ids ? inArray(employees.id, opts.ids) : undefined,
      ),
    )
    .orderBy(employees.displayName)
    .limit(5000);
  return rows.map((r) => ({ value: r.id, label: r.name, hint: r.code }));
}

/** Direct reports of an employee (current only). */
export async function directReportIds(tx: Tx, managerId: string) {
  const rows = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.managerId, managerId), isNull(employees.deletedAt), inArray(employees.status, [...CURRENT_STATUSES])));
  return rows.map((r) => r.id);
}

/** Question ids for user-built forms. */
export const newQuestionId = () => Math.random().toString(36).slice(2, 10);
