import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { employees, legalEntities, memberships, roles, users } from "../../db/schema";

export type Option = { value: string; label: string; hint?: string };

/** Employees for pickers (heads, leads, invitation links). */
export async function employeeOptions(tx: Tx, opts: { withoutUser?: boolean } = {}): Promise<Option[]> {
  const rows = await tx
    .select({ id: employees.id, name: employees.displayName, code: employees.employeeCode, email: employees.workEmail })
    .from(employees)
    .where(
      and(
        isNull(employees.deletedAt),
        ne(employees.status, "exited"),
        opts.withoutUser ? isNull(employees.userId) : undefined,
      ),
    )
    .orderBy(asc(employees.displayName))
    .limit(5000);
  return rows.map((r) => ({ value: r.id, label: r.name, hint: [r.code, r.email].filter(Boolean).join(" · ") }));
}

export async function legalEntityOptions(tx: Tx): Promise<Option[]> {
  const rows = await tx
    .select({ id: legalEntities.id, name: legalEntities.name })
    .from(legalEntities)
    .where(eq(legalEntities.isActive, true))
    .orderBy(asc(legalEntities.name));
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

/** Active members of the tenant, labelled with their name and email. */
export async function memberOptions(tx: Tx, tenantId: string): Promise<Option[]> {
  const rows = await tx
    .select({ id: users.id, name: users.fullName, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "active")))
    .orderBy(asc(users.fullName), asc(users.email));
  return rows.map((r) => ({ value: r.id, label: r.name ?? r.email, hint: r.email }));
}

export async function roleOptions(tx: Tx, opts: { builtInOnly?: boolean } = {}) {
  const rows = await tx
    .select({ id: roles.id, key: roles.key, name: roles.name, description: roles.description, isSystem: roles.isSystem })
    .from(roles)
    .orderBy(asc(roles.name));
  return opts.builtInOnly ? rows.filter((r) => r.key) : rows;
}

export async function employeeNamesById(tx: Tx, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (!unique.length) return new Map<string, string>();
  const rows = await tx.select({ id: employees.id, name: employees.displayName }).from(employees).where(inArray(employees.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}
