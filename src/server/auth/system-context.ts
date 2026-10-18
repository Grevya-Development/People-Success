import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { employees, membershipRoles, memberships, roles, tenants, users } from "../db/schema";
import { withTenant } from "../db/tx";
import { mergeGrants, serializeGrants } from "@/lib/permissions";
import type { RequestContext } from "./context";

/**
 * Build a RequestContext for a user outside an HTTP request (background jobs
 * acting on someone's behalf, e.g. scheduled reports). Resolves the user's
 * CURRENT membership and roles, so revoked access takes effect immediately.
 * Returns null if the user is no longer an active member.
 */
export async function contextForUser(tenantId: string, userId: string): Promise<RequestContext | null> {
  const [row] = await db
    .select({ membershipId: memberships.id, tenantName: tenants.name, email: users.email, fullName: users.fullName, isPlatformAdmin: users.isPlatformAdmin })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId), eq(memberships.status, "active")));
  if (!row) return null;
  const [roleRows, [emp]] = await Promise.all([
    db
      .select({ id: roles.id, key: roles.key, name: roles.name, permissions: roles.permissions })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(eq(membershipRoles.membershipId, row.membershipId)),
    db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.userId, userId), isNull(employees.deletedAt))),
  ]);
  const grants = mergeGrants(roleRows.map((r) => r.permissions));
  const perms = serializeGrants(grants);
  const employeeId = emp?.id ?? null;
  return {
    userId,
    email: row.email,
    fullName: row.fullName,
    isPlatformAdmin: row.isPlatformAdmin,
    tenantId,
    tenantName: row.tenantName,
    membershipId: row.membershipId,
    employeeId,
    roles: roleRows.map(({ id, key, name }) => ({ id, key, name })),
    grants,
    perms,
    tenants: [],
    db: (fn) => withTenant({ tenantId, userId, employeeId, perms }, fn),
  };
}
