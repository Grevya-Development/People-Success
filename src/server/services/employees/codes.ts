import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { employees, tenantCounters, tenants } from "../../db/schema";

/** Atomically increment a per-tenant counter and return the new value. */
export async function nextCounter(tx: Tx, tenantId: string, key: string) {
  const [row] = await tx
    .insert(tenantCounters)
    .values({ tenantId, key, value: 1 })
    .onConflictDoUpdate({
      target: [tenantCounters.tenantId, tenantCounters.key],
      set: { value: sql`${tenantCounters.value} + 1` },
    })
    .returning({ value: tenantCounters.value });
  return row.value;
}

export function formatEmployeeCode(prefix: string, padding: number, n: number) {
  return `${prefix}${String(n).padStart(padding, "0")}`;
}

/**
 * Next employee code using the tenant's configured format. Skips numbers
 * already taken by manually entered or imported codes.
 */
export async function generateEmployeeCode(tx: Tx, tenantId: string) {
  const [tenant] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  const { prefix, padding } = tenant?.settings.employeeIdFormat ?? { prefix: "EMP", padding: 4 };
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = formatEmployeeCode(prefix, padding, await nextCounter(tx, tenantId, "employee_code"));
    const [taken] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.employeeCode, code)))
      .limit(1);
    if (!taken) return code;
  }
  throw new Error("Could not allocate an employee code");
}
