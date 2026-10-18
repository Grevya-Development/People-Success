import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { employees, jobs } from "../../db/schema";
import { notFound } from "../../lib/errors";
import type { AuditActor } from "../../lib/audit";
import { addDaysIso } from "@/lib/leave-math";

/**
 * Time module conventions
 * - All functions that take `tx` also take `tenantId` and filter by it
 *   explicitly, so they are safe both under RLS (ctx.db) and in system jobs.
 * - Attendance clock times are interpreted in India Standard Time (UTC+05:30,
 *   no daylight saving). Location time zones other than IST are not yet used
 *   for punch-to-day mapping.
 */
export const IST_OFFSET_MIN = 330;

/** yyyy-MM-dd of an instant in IST. */
export const istDate = (d: Date) => new Date(d.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);

/** HH:mm of an instant in IST. */
export const istTime = (d: Date) => new Date(d.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(11, 16);

/** Instant for a local IST date and "HH:mm[:ss]" time. */
export const istInstant = (date: string, time: string) => new Date(`${date}T${time.length === 5 ? `${time}:00` : time}+05:30`);

export const yesterdayOf = (date: string) => addDaysIso(date, -1);

export const systemActor = (tenantId: string): AuditActor => ({ tenantId, userId: null, actorType: "system" });

/** Serialize concurrent writers on a logical key for the rest of the transaction. */
export async function advisoryLock(tx: Tx, key: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/**
 * Enqueue a background job without RETURNING (the jobs table is not
 * readable by ordinary users under RLS). Duplicate dedupe keys are ignored.
 */
export async function enqueueTenantJob(tx: Tx, tenantId: string, type: string, payload: Record<string, unknown>, dedupeKey?: string) {
  await tx
    .insert(jobs)
    .values({ tenantId, type, payload, dedupeKey: dedupeKey ?? null, runAt: new Date(), maxAttempts: 3 })
    .onConflictDoNothing();
}

export type EmployeeBasics = {
  id: string;
  tenantId: string;
  userId: string | null;
  displayName: string;
  employeeCode: string;
  status: string;
  employmentType: string;
  legalEntityId: string;
  locationId: string | null;
  departmentId: string | null;
  managerId: string | null;
  joiningDate: string;
  /** Last day of employment (last working day or exit date), if any. */
  lastDate: string | null;
};

const basicsColumns = {
  id: employees.id,
  tenantId: employees.tenantId,
  userId: employees.userId,
  displayName: employees.displayName,
  employeeCode: employees.employeeCode,
  status: employees.status,
  employmentType: employees.employmentType,
  legalEntityId: employees.legalEntityId,
  locationId: employees.locationId,
  departmentId: employees.departmentId,
  managerId: employees.managerId,
  joiningDate: employees.joiningDate,
  lastWorkingDate: employees.lastWorkingDate,
  exitDate: employees.exitDate,
};

type BasicsRow = Pick<typeof employees.$inferSelect, keyof typeof basicsColumns>;

const toBasics = (r: BasicsRow): EmployeeBasics => ({
  id: r.id,
  tenantId: r.tenantId,
  userId: r.userId,
  displayName: r.displayName,
  employeeCode: r.employeeCode,
  status: r.status,
  employmentType: r.employmentType,
  legalEntityId: r.legalEntityId,
  locationId: r.locationId,
  departmentId: r.departmentId,
  managerId: r.managerId,
  joiningDate: r.joiningDate,
  lastDate: r.lastWorkingDate ?? r.exitDate ?? null,
});

export async function employeeBasics(tx: Tx, tenantId: string, employeeId: string): Promise<EmployeeBasics> {
  const [row] = await tx
    .select(basicsColumns)
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), eq(employees.id, employeeId), isNull(employees.deletedAt)))
    .limit(1);
  if (!row) throw notFound("Employee");
  return toBasics(row);
}

/** Employees who may have attendance or leave on some day in [from, to]. */
export async function employeesActiveBetween(tx: Tx, tenantId: string, from: string, to: string, ids?: string[]): Promise<EmployeeBasics[]> {
  const rows = await tx
    .select(basicsColumns)
    .from(employees)
    .where(
      and(
        eq(employees.tenantId, tenantId),
        isNull(employees.deletedAt),
        sql`${employees.joiningDate} <= ${to}`,
        sql`coalesce(${employees.lastWorkingDate}, ${employees.exitDate}, '9999-12-31'::date) >= ${from}`,
        sql`${employees.status} in ('active','on_notice','exited')`,
        ids ? (ids.length ? sql`${employees.id} in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})` : sql`false`) : undefined,
      ),
    );
  return rows.map(toBasics);
}

/* ------------------------------------------------------------------ */
/* Policy conditions                                                   */
/* ------------------------------------------------------------------ */

export type PolicyConditions = Record<string, string | string[]>;

/** Every non-empty condition must include the employee's value. Empty = everyone. */
export function matchesConditions(conditions: PolicyConditions | null | undefined, e: Pick<EmployeeBasics, "employmentType" | "locationId" | "legalEntityId" | "departmentId">) {
  if (!conditions) return true;
  const attrs: Record<string, string | null> = {
    employmentType: e.employmentType,
    locationId: e.locationId,
    legalEntityId: e.legalEntityId,
    departmentId: e.departmentId,
  };
  return Object.entries(conditions).every(([key, expected]) => {
    const list = Array.isArray(expected) ? expected : expected ? [expected] : [];
    if (!list.length) return true;
    const actual = attrs[key];
    return actual != null && list.includes(actual);
  });
}

/** Drop empty arrays so stored conditions stay minimal. */
export function compactConditions(c: Record<string, string[]>): PolicyConditions {
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v.length > 0));
}

export const fmtDays = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} day${n === 1 ? "" : "s"}`;
