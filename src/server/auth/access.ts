import { and, eq, inArray, isNull } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "../db/client";
import { employees, membershipRoles, memberships, roles, tenants, users } from "../db/schema";
import { mergeGrants, serializeGrants, type Grants } from "@/lib/permissions";

export type TenantSummary = { id: string; name: string; slug: string; status: string };

export type Access = {
  user: { id: string; email: string; fullName: string | null; isPlatformAdmin: boolean };
  tenants: TenantSummary[];
  /** Null when the user has no active membership yet (must create or join an org). */
  active: null | {
    tenant: TenantSummary;
    membershipId: string;
    employeeId: string | null;
    roles: { id: string; key: string | null; name: string }[];
    grants: Grants;
    perms: string;
  };
};

export const accessTag = (userId: string) => `access:${userId}`;
export const tenantAccessTag = (tenantId: string) => `access-tenant:${tenantId}`;

/**
 * Resolve the user's tenants, active membership, roles and merged grants.
 * Cached per (user, preferred tenant) for a short time; mutations that change
 * roles or memberships call updateTag(accessTag(...)) to refresh immediately.
 * Runs in system context because it is the step that establishes the tenant.
 */
export async function loadAccess(userId: string, preferredTenantId: string | null): Promise<Access | null> {
  "use cache";
  cacheTag(accessTag(userId));
  cacheLife({ stale: 60, revalidate: 60, expire: 300 });

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      isPlatformAdmin: users.isPlatformAdmin,
      lastActiveTenantId: users.lastActiveTenantId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;

  const rows = await db
    .select({
      membershipId: memberships.id,
      // The employee record linked to this login (employees.user_id is the single source).
      employeeId: employees.id,
      tenantId: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .leftJoin(
      employees,
      and(eq(employees.tenantId, memberships.tenantId), eq(employees.userId, memberships.userId), isNull(employees.deletedAt)),
    )
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
    .orderBy(tenants.name);

  const tenantList: TenantSummary[] = rows
    .filter((r) => r.status !== "closed")
    .map((r) => ({ id: r.tenantId, name: r.name, slug: r.slug, status: r.status }));

  const pick =
    rows.find((r) => r.tenantId === preferredTenantId) ??
    rows.find((r) => r.tenantId === user.lastActiveTenantId) ??
    rows[0];

  const base = {
    user: { id: user.id, email: user.email, fullName: user.fullName, isPlatformAdmin: user.isPlatformAdmin },
    tenants: tenantList,
  };
  if (!pick || pick.status === "suspended" || pick.status === "closed") return { ...base, active: null };

  const roleRows = await db
    .select({ id: roles.id, key: roles.key, name: roles.name, permissions: roles.permissions })
    .from(membershipRoles)
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .where(eq(membershipRoles.membershipId, pick.membershipId));

  const grants = mergeGrants(roleRows.map((r) => r.permissions));

  return {
    ...base,
    active: {
      tenant: { id: pick.tenantId, name: pick.name, slug: pick.slug, status: pick.status },
      membershipId: pick.membershipId,
      employeeId: pick.employeeId,
      roles: roleRows.map(({ id, key, name }) => ({ id, key, name })),
      grants,
      perms: serializeGrants(grants),
    },
  };
}

/** Ids of every user in a tenant, used to invalidate cached access after role edits. */
export async function tenantUserIds(tenantId: string, roleId?: string) {
  if (roleId) {
    const rows = await db
      .select({ userId: memberships.userId })
      .from(membershipRoles)
      .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
      .where(and(eq(membershipRoles.tenantId, tenantId), eq(membershipRoles.roleId, roleId)));
    return rows.map((r) => r.userId);
  }
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.tenantId, tenantId));
  return rows.map((r) => r.userId);
}

export async function membershipUserIds(membershipIds: string[]) {
  if (!membershipIds.length) return [];
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(inArray(memberships.id, membershipIds));
  return rows.map((r) => r.userId);
}
