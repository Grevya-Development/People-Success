import { and, asc, eq, sql } from "drizzle-orm";
import { authorize } from "../../auth/context";
import type { Tx } from "../../db/client";
import { invitations, membershipRoles, memberships, roles } from "../../db/schema";
import { diff } from "../../lib/audit";
import { forbidden, invalidState, notFound } from "../../lib/errors";
import { hasScope, mergeGrants, parseGrant, PERMISSIONS, type Grants, type Permission, type Scope } from "@/lib/permissions";
import { createRoleSchema, toGrantStrings, updateRoleSchema, type CreateRoleInput, type UpdateRoleInput } from "@/lib/validation/users";
import { auditAs, friendlyDbError, type SettingsCtx } from "./shared";

export const OWNER_ROLE_KEY = "tenant_owner";

const UNIQUE_MESSAGES = { roles_tenant_name_key: "Another role already uses this name." };

export type RoleSummary = {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionCount: number;
  memberCount: number;
  editable: boolean;
  deletable: boolean;
};

export async function listRoles(ctx: SettingsCtx): Promise<RoleSummary[]> {
  authorize(ctx, "roles.manage", "all");
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        id: roles.id,
        key: roles.key,
        name: roles.name,
        description: roles.description,
        isSystem: roles.isSystem,
        permissions: roles.permissions,
        memberCount: sql<number>`(
          select count(*) from ${membershipRoles} mr join ${memberships} m on m.id = mr.membership_id
          where mr.role_id = ${roles.id} and m.status = 'active')`.mapWith(Number),
      })
      .from(roles)
      .orderBy(sql`${roles.isSystem} desc`, asc(roles.name));
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      permissionCount: r.permissions.filter((g) => parseGrant(g)).length,
      memberCount: r.memberCount,
      editable: r.key !== OWNER_ROLE_KEY,
      deletable: !r.isSystem && r.memberCount === 0,
    }));
  });
}

export async function getRole(ctx: SettingsCtx, id: string) {
  authorize(ctx, "roles.manage", "all");
  return ctx.db(async (tx) => {
    const [role] = await tx.select().from(roles).where(eq(roles.id, id));
    if (!role) throw notFound("Role");
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(membershipRoles)
      .where(eq(membershipRoles.roleId, id));
    const grants = mergeGrants([role.permissions]);
    return { ...role, grants, assignedCount: n, editable: role.key !== OWNER_ROLE_KEY, canRename: !role.isSystem };
  });
}

/** Whether the acting user holds the Tenant Owner role in this tenant. */
export async function actorIsOwner(tx: Tx, ctx: SettingsCtx) {
  const rows = await tx
    .select({ one: sql<number>`1` })
    .from(membershipRoles)
    .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .where(and(eq(memberships.userId, ctx.userId), eq(memberships.status, "active"), eq(roles.key, OWNER_ROLE_KEY)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Privilege-escalation guard: a non-owner may only hand out grants they hold
 * themselves (at the same or wider scope).
 */
export function grantsBeyond(actor: Grants, grants: string[]): string[] {
  const out: string[] = [];
  for (const g of grants) {
    const parsed = parseGrant(g);
    if (!parsed) continue;
    const [perm, scope] = parsed;
    if (!hasScope(actor, perm, scope)) out.push(PERMISSIONS[perm].label);
  }
  return out;
}

/** User ids of every member holding the role, for access-cache invalidation. */
export async function roleUserIds(tx: Tx, roleId: string) {
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(membershipRoles)
    .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
    .where(eq(membershipRoles.roleId, roleId));
  return [...new Set(rows.map((r) => r.userId))];
}

export async function createRole(ctx: SettingsCtx, raw: CreateRoleInput) {
  authorize(ctx, "roles.manage", "all");
  const input = createRoleSchema.parse(raw);
  try {
    return await ctx.db(async (tx) => {
      let permissions: string[] = [];
      if (input.copyFromRoleId) {
        const [source] = await tx.select().from(roles).where(eq(roles.id, input.copyFromRoleId));
        if (!source) throw notFound("Role to copy");
        permissions = toGrantStrings(
          Object.entries(mergeGrants([source.permissions])).map(([permission, scope]) => ({ permission, scope: scope as Scope })),
        );
        if (!(await actorIsOwner(tx, ctx))) {
          const beyond = grantsBeyond(ctx.grants, permissions);
          if (beyond.length) throw forbidden(`You cannot copy permissions you do not hold: ${beyond.slice(0, 3).join(", ")}${beyond.length > 3 ? "…" : ""}.`);
        }
      }
      const [row] = await tx
        .insert(roles)
        .values({ tenantId: ctx.tenantId, key: null, name: input.name, description: input.description ?? null, isSystem: false, permissions })
        .returning();
      await auditAs(tx, ctx, {
        action: "role.created",
        entityType: "role",
        entityId: row.id,
        changes: diff(null, { name: row.name, description: row.description, permissions: row.permissions }),
        metadata: input.copyFromRoleId ? { copiedFrom: input.copyFromRoleId } : undefined,
      });
      return { id: row.id };
    });
  } catch (err) {
    friendlyDbError(err, UNIQUE_MESSAGES);
  }
}

/**
 * Update a role's name, description and permissions. The Tenant Owner role is
 * immutable; built-in roles keep their names. Returns the users whose cached
 * access must be refreshed.
 */
export async function updateRole(ctx: SettingsCtx, raw: UpdateRoleInput): Promise<{ affectedUserIds: string[]; changed: boolean }> {
  authorize(ctx, "roles.manage", "all");
  const input = updateRoleSchema.parse(raw);
  try {
    return await ctx.db(async (tx) => {
      const [role] = await tx.select().from(roles).where(eq(roles.id, input.id)).for("update");
      if (!role) throw notFound("Role");
      if (role.key === OWNER_ROLE_KEY) throw forbidden("The Tenant Owner role always has every permission and cannot be edited.");
      if (role.isSystem && input.name !== role.name) throw invalidState("Built-in roles cannot be renamed. Create a custom role instead.");

      const next = toGrantStrings(input.permissions);
      const prev = toGrantStrings(
        Object.entries(mergeGrants([role.permissions])).map(([permission, scope]) => ({ permission, scope: scope as Scope })),
      );
      const added = next.filter((g) => !prev.includes(g));
      if (added.length && !(await actorIsOwner(tx, ctx))) {
        const beyond = grantsBeyond(ctx.grants, added);
        if (beyond.length) {
          throw forbidden(`You cannot grant permissions you do not hold: ${beyond.slice(0, 3).join(", ")}${beyond.length > 3 ? "…" : ""}.`);
        }
      }
      const permsChanged = next.join(",") !== prev.join(",");
      const changed = permsChanged || input.name !== role.name || (input.description ?? null) !== role.description;
      if (!changed) return { affectedUserIds: [], changed: false };

      await tx
        .update(roles)
        .set({ name: input.name, description: input.description ?? null, permissions: next })
        .where(eq(roles.id, role.id));
      const removed = prev.filter((g) => !next.includes(g));
      await auditAs(tx, ctx, {
        action: "role.updated",
        entityType: "role",
        entityId: role.id,
        changes: diff({ name: role.name, description: role.description }, { name: input.name, description: input.description ?? null }),
        metadata: permsChanged ? { added, removed } : undefined,
      });
      // Names appear in the shell too, so refresh members on any change.
      return { affectedUserIds: await roleUserIds(tx, role.id), changed: true };
    });
  } catch (err) {
    friendlyDbError(err, UNIQUE_MESSAGES);
  }
}

export async function deleteRole(ctx: SettingsCtx, id: string) {
  authorize(ctx, "roles.manage", "all");
  return ctx.db(async (tx) => {
    const [role] = await tx.select().from(roles).where(eq(roles.id, id)).for("update");
    if (!role) throw notFound("Role");
    if (role.isSystem) throw invalidState("Built-in roles cannot be deleted.");
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(membershipRoles)
      .where(eq(membershipRoles.roleId, id));
    if (n > 0) throw invalidState(`This role is assigned to ${n} member${n === 1 ? "" : "s"}. Remove it from them first.`);
    const [{ p }] = await tx
      .select({ p: sql<number>`count(*)`.mapWith(Number) })
      .from(invitations)
      .where(and(eq(invitations.status, "pending"), sql`${id}::uuid = any(${invitations.roleIds})`));
    if (p > 0) throw invalidState(`This role is part of ${p} pending invitation${p === 1 ? "" : "s"}. Revoke them first.`);
    await tx.delete(roles).where(eq(roles.id, id));
    await auditAs(tx, ctx, { action: "role.deleted", entityType: "role", entityId: id, metadata: { name: role.name } });
    return { id };
  });
}

/** Permission catalogue grouped for the editor. */
export function permissionGroups() {
  const groups = new Map<string, { key: Permission; label: string; scoped: boolean; sensitive: boolean }[]>();
  for (const [key, def] of Object.entries(PERMISSIONS) as [Permission, (typeof PERMISSIONS)[Permission]][]) {
    const d = def as { label: string; group: string; scoped?: boolean; sensitive?: boolean };
    const list = groups.get(d.group) ?? [];
    list.push({ key, label: d.label, scoped: !!d.scoped, sensitive: !!d.sensitive });
    groups.set(d.group, list);
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}
