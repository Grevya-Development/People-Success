import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { membershipRoles, memberships, roles } from "../../db/schema";
import { forbidden, invalidState, validation } from "../../lib/errors";
import { mergeGrants } from "@/lib/permissions";
import { actorIsOwner, grantsBeyond, OWNER_ROLE_KEY } from "../settings/roles";
import type { SettingsCtx } from "../settings/shared";

/**
 * Invariants that must hold after any membership or role-assignment change.
 * Checked inside the same transaction, so a violation rolls everything back.
 */
export async function assertTenantGuards(tx: Tx, tenantId: string) {
  const [{ owners, managers }] = await tx.execute<{ owners: number; managers: number }>(sql`
    select
      count(distinct m.id) filter (where r.key = ${OWNER_ROLE_KEY})::int as owners,
      count(distinct m.id) filter (where exists (
        select 1 from unnest(r.permissions) p where p = 'users.manage' or p = 'users.manage:all'
      ))::int as managers
    from ${memberships} m
    join ${membershipRoles} mr on mr.membership_id = m.id
    join ${roles} r on r.id = mr.role_id
    where m.tenant_id = ${tenantId} and m.status = 'active'`);
  if (Number(owners) === 0) {
    throw invalidState("The organization must keep at least one active Tenant Owner. Make someone else an owner first.");
  }
  if (Number(managers) === 0) {
    throw invalidState("At least one active member must be able to manage users. Give another member that access first.");
  }
}

export type RoleRow = { id: string; key: string | null; name: string; permissions: string[] };

/**
 * Validate role ids for assignment (they must exist in this tenant) and stop
 * privilege escalation: only owners may grant or revoke Tenant Owner, and
 * non-owners may only assign roles whose permissions they hold themselves.
 */
export async function assertAssignableRoles(
  tx: Tx,
  ctx: SettingsCtx,
  roleIds: string[],
  opts: { previousRoleIds?: string[] } = {},
): Promise<RoleRow[]> {
  const unique = [...new Set(roleIds)];
  const rows = unique.length
    ? await tx
        .select({ id: roles.id, key: roles.key, name: roles.name, permissions: roles.permissions })
        .from(roles)
        .where(inArray(roles.id, unique))
    : [];
  if (rows.length !== unique.length) throw validation("One of the selected roles no longer exists.", { roleIds: ["Choose valid roles"] });

  const previous = new Set(opts.previousRoleIds ?? []);
  const added = rows.filter((r) => !previous.has(r.id));
  const ownerId = await ownerRoleId(tx);
  const ownerRemoved = !!ownerId && previous.has(ownerId) && !unique.includes(ownerId);
  const ownerRoleTouched = added.some((r) => r.key === OWNER_ROLE_KEY) || ownerRemoved;

  if (ownerRoleTouched || added.length) {
    const isOwner = await actorIsOwner(tx, ctx);
    if (ownerRoleTouched && !isOwner) throw forbidden("Only a Tenant Owner can grant or remove the Tenant Owner role.");
    if (!isOwner) {
      const beyond = grantsBeyond(ctx.grants, Object.entries(mergeGrants(added.map((r) => r.permissions))).map(([p, s]) => `${p}:${s}`));
      if (beyond.length) {
        throw forbidden(`You cannot assign a role with permissions you do not hold (${beyond.slice(0, 3).join(", ")}${beyond.length > 3 ? "…" : ""}).`);
      }
    }
  }
  return rows;
}

async function ownerRoleId(tx: Tx) {
  const [row] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, OWNER_ROLE_KEY)).limit(1);
  return row?.id ?? null;
}

export async function membershipHasOwnerRole(tx: Tx, membershipId: string) {
  const rows = await tx
    .select({ one: sql<number>`1` })
    .from(membershipRoles)
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .where(and(eq(membershipRoles.membershipId, membershipId), eq(roles.key, OWNER_ROLE_KEY)))
    .limit(1);
  return rows.length > 0;
}
