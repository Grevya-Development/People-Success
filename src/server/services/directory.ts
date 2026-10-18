import { and, eq, inArray, isNotNull, isNull, lte, gte, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import {
  approvalDelegations,
  departments,
  employees,
  membershipRoles,
  memberships,
  roles,
} from "../db/schema";

/**
 * Lookups shared by approvals, notifications and workflows. All take an open
 * transaction so they run under the caller's tenant context.
 */

export async function userIdForEmployee(tx: Tx, employeeId: string | null | undefined) {
  if (!employeeId) return null;
  const [row] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, employeeId)).limit(1);
  return row?.userId ?? null;
}

export async function managerOf(tx: Tx, employeeId: string | null | undefined) {
  if (!employeeId) return null;
  const [row] = await tx.select({ managerId: employees.managerId }).from(employees).where(eq(employees.id, employeeId)).limit(1);
  return row?.managerId ?? null;
}

export async function departmentHeadOf(tx: Tx, employeeId: string | null | undefined) {
  if (!employeeId) return null;
  const [row] = await tx
    .select({ head: departments.headEmployeeId })
    .from(employees)
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .where(eq(employees.id, employeeId))
    .limit(1);
  return row?.head ?? null;
}

/** Active users holding any of the given built-in role keys in this tenant. */
export async function userIdsWithRoles(tx: Tx, tenantId: string, roleKeys: string[]) {
  if (!roleKeys.length) return [];
  const rows = await tx
    .selectDistinct({ userId: memberships.userId })
    .from(membershipRoles)
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
    .where(and(eq(roles.tenantId, tenantId), inArray(roles.key, roleKeys), eq(memberships.status, "active")));
  return rows.map((r) => r.userId);
}

/** Active users holding any role that grants `permission` (any scope). */
export async function userIdsWithPermission(tx: Tx, tenantId: string, permission: string) {
  const rows = await tx
    .selectDistinct({ userId: memberships.userId })
    .from(membershipRoles)
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
    .where(
      and(
        eq(roles.tenantId, tenantId),
        eq(memberships.status, "active"),
        sql`exists (select 1 from unnest(${roles.permissions}) p where p like ${permission + ":%"})`,
      ),
    );
  return rows.map((r) => r.userId);
}

/** Expand approvers with anyone they delegated approvals to for today. */
export async function withDelegates(tx: Tx, tenantId: string, userIds: string[], subjectType: string, today: string) {
  if (!userIds.length) return userIds;
  const rows = await tx
    .select({ to: approvalDelegations.toUserId, types: approvalDelegations.subjectTypes })
    .from(approvalDelegations)
    .where(
      and(
        eq(approvalDelegations.tenantId, tenantId),
        inArray(approvalDelegations.fromUserId, userIds),
        lte(approvalDelegations.startsOn, today),
        gte(approvalDelegations.endsOn, today),
      ),
    );
  const extra = rows.filter((r) => !r.types?.length || r.types.includes(subjectType)).map((r) => r.to);
  return [...new Set([...userIds, ...extra])];
}

export async function employeeNames(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await tx
    .select({ id: employees.id, name: employees.displayName })
    .from(employees)
    .where(inArray(employees.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function activeEmployeeIdsWithUsers(tx: Tx) {
  return tx
    .select({ id: employees.id, userId: employees.userId })
    .from(employees)
    .where(and(isNull(employees.deletedAt), isNotNull(employees.userId), inArray(employees.status, ["active", "on_notice"])));
}
