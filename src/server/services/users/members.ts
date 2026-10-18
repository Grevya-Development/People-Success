import { and, asc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { authorize } from "../../auth/context";
import { employees, membershipRoles, memberships, roles, users } from "../../db/schema";
import { diff } from "../../lib/audit";
import { forbidden, invalidState, notFound } from "../../lib/errors";
import {
  membershipStatusSchema,
  updateMemberRolesSchema,
  type UpdateMemberRolesInput,
} from "@/lib/validation/users";
import type { z } from "zod";
import { auditAs, type SettingsCtx } from "../settings/shared";
import { actorIsOwner, OWNER_ROLE_KEY } from "../settings/roles";
import { assertAssignableRoles, assertTenantGuards, membershipHasOwnerRole } from "./guards";

export type MemberRow = {
  membershipId: string;
  userId: string;
  name: string | null;
  email: string;
  status: "invited" | "active" | "suspended" | "deactivated";
  roles: { id: string; key: string | null; name: string }[];
  employee: { id: string; name: string; code: string } | null;
  isSelf: boolean;
  isOwner: boolean;
  joinedAt: string;
};

export async function listMembers(ctx: SettingsCtx): Promise<MemberRow[]> {
  authorize(ctx, "users.manage", "all");
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        membershipId: memberships.id,
        userId: memberships.userId,
        status: memberships.status,
        createdAt: memberships.createdAt,
        name: users.fullName,
        email: users.email,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.tenantId, ctx.tenantId))
      .orderBy(asc(users.fullName), asc(users.email));
    const ids = rows.map((r) => r.membershipId);
    const roleRows = ids.length
      ? await tx
          .select({ membershipId: membershipRoles.membershipId, id: roles.id, key: roles.key, name: roles.name })
          .from(membershipRoles)
          .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
          .where(inArray(membershipRoles.membershipId, ids))
          .orderBy(asc(roles.name))
      : [];
    const userIds = rows.map((r) => r.userId);
    const linked = userIds.length
      ? await tx
          .select({ userId: employees.userId, id: employees.id, name: employees.displayName, code: employees.employeeCode })
          .from(employees)
          .where(and(inArray(employees.userId, userIds), isNull(employees.deletedAt)))
      : [];
    const empByUser = new Map(linked.map((e) => [e.userId, { id: e.id, name: e.name, code: e.code }]));
    return rows.map((r) => {
      const rs = roleRows.filter((x) => x.membershipId === r.membershipId).map(({ id, key, name }) => ({ id, key, name }));
      return {
        membershipId: r.membershipId,
        userId: r.userId,
        name: r.name,
        email: r.email,
        status: r.status,
        roles: rs,
        employee: empByUser.get(r.userId) ?? null,
        isSelf: r.userId === ctx.userId,
        isOwner: rs.some((x) => x.key === OWNER_ROLE_KEY),
        joinedAt: r.createdAt.toISOString(),
      };
    });
  });
}

/**
 * Replace a member's roles. Guard rails: Tenant Owner can only be granted or
 * removed by an owner, non-owners cannot assign permissions they lack, and
 * the tenant must keep an active owner and an active user manager.
 */
export async function updateMemberRoles(ctx: SettingsCtx, raw: UpdateMemberRolesInput): Promise<{ affectedUserIds: string[] }> {
  authorize(ctx, "users.manage", "all");
  const input = updateMemberRolesSchema.parse(raw);
  return ctx.db(async (tx) => {
    const [m] = await tx.select().from(memberships).where(eq(memberships.id, input.membershipId)).for("update");
    if (!m) throw notFound("Member");
    const current = await tx
      .select({ id: roles.id, name: roles.name })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(eq(membershipRoles.membershipId, m.id));
    const next = await assertAssignableRoles(tx, ctx, input.roleIds, { previousRoleIds: current.map((r) => r.id) });
    const nextIds = next.map((r) => r.id);

    await tx
      .delete(membershipRoles)
      .where(and(eq(membershipRoles.membershipId, m.id), nextIds.length ? notInArray(membershipRoles.roleId, nextIds) : undefined));
    await tx
      .insert(membershipRoles)
      .values(nextIds.map((roleId) => ({ tenantId: ctx.tenantId, membershipId: m.id, roleId, grantedBy: ctx.userId })))
      .onConflictDoNothing();

    await assertTenantGuards(tx, ctx.tenantId);
    await auditAs(tx, ctx, {
      action: "member.roles_changed",
      entityType: "membership",
      entityId: m.id,
      changes: diff({ roles: current.map((r) => r.name).sort() }, { roles: next.map((r) => r.name).sort() }),
      metadata: { userId: m.userId },
    });
    return { affectedUserIds: [m.userId] };
  });
}

export async function setMembershipStatus(
  ctx: SettingsCtx,
  raw: z.input<typeof membershipStatusSchema>,
): Promise<{ affectedUserIds: string[] }> {
  authorize(ctx, "users.manage", "all");
  const input = membershipStatusSchema.parse(raw);
  return ctx.db(async (tx) => {
    const [m] = await tx.select().from(memberships).where(eq(memberships.id, input.membershipId)).for("update");
    if (!m) throw notFound("Member");
    if (m.userId === ctx.userId) throw invalidState("You cannot change the status of your own membership.");
    if (m.status === input.status) return { affectedUserIds: [] };
    if (m.status === "invited") throw invalidState("This person has not accepted their invitation yet.");
    if ((await membershipHasOwnerRole(tx, m.id)) && !(await actorIsOwner(tx, ctx))) {
      throw forbidden("Only a Tenant Owner can suspend or reactivate another owner.");
    }
    await tx.update(memberships).set({ status: input.status }).where(eq(memberships.id, m.id));
    await assertTenantGuards(tx, ctx.tenantId);
    await auditAs(tx, ctx, {
      action: input.status === "suspended" ? "member.suspended" : "member.reactivated",
      entityType: "membership",
      entityId: m.id,
      changes: diff({ status: m.status }, { status: input.status }),
      metadata: { userId: m.userId },
    });
    return { affectedUserIds: [m.userId] };
  });
}
