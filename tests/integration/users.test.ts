import { describe, expect, it, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { emailOutbox, employees, invitations, legalEntities, membershipRoles, memberships, roles } from "@/server/db/schema";
import type { RequestContext } from "@/server/auth/context";
import { createRole, deleteRole, getRole, updateRole } from "@/server/services/settings/roles";
import { listMembers, setMembershipStatus, updateMemberRoles } from "@/server/services/users/members";
import {
  acceptInvitation,
  createInvitation,
  getInvitationByToken,
  listInvitations,
  pendingInvitationsForEmail,
  resendInvitation,
  revokeInvitation,
} from "@/server/services/users/invitations";
import { addMember, contextFor, createOwnedTenant, createUser, uniqueEmail } from "../helpers/fixtures";

const roleId = async (tenantId: string, key: string) =>
  (await db.select().from(roles).where(and(eq(roles.tenantId, tenantId), eq(roles.key, key))))[0];

describe("roles", () => {
  let t: Awaited<ReturnType<typeof createOwnedTenant>>;
  let owner: RequestContext;

  beforeAll(async () => {
    t = await createOwnedTenant();
    owner = await contextFor(t.tenant.id, t.user.id);
  });

  it("reports every member of an edited role for access invalidation", async () => {
    const m1 = await addMember(t.tenant.id, ["people_manager"]);
    const m2 = await addMember(t.tenant.id, ["people_manager", "employee"]);
    await addMember(t.tenant.id, ["employee"]);
    const role = await roleId(t.tenant.id, "people_manager");
    const current = await getRole(owner, role.id);
    const perms = Object.entries(current.grants).map(([permission, scope]) => ({ permission, scope: scope! }));

    const res = await updateRole(owner, { id: role.id, name: role.name, permissions: [...perms, { permission: "reports.view", scope: "all" }] });
    expect(res.changed).toBe(true);
    expect(res.affectedUserIds.sort()).toEqual([m1.user.id, m2.user.id].sort());
    const [after] = await db.select().from(roles).where(eq(roles.id, role.id));
    expect(after.permissions).toContain("reports.view:all");
    // Every stored grant is normalized to "<permission>:<scope>".
    expect(after.permissions.every((g) => g.includes(":"))).toBe(true);

    // No-op saves do not invalidate anyone.
    const again = await getRole(owner, role.id);
    const same = await updateRole(owner, {
      id: role.id,
      name: role.name,
      description: again.description ?? undefined,
      permissions: Object.entries(again.grants).map(([permission, scope]) => ({ permission, scope: scope! })),
    });
    expect(same).toEqual({ affectedUserIds: [], changed: false });
  });

  it("coerces unscoped permissions to all and keeps scoped ones", async () => {
    const created = await createRole(owner, { name: "Shift supervisor" });
    await updateRole(owner, {
      id: created.id,
      name: "Shift supervisor",
      permissions: [
        { permission: "attendance.approve", scope: "team" },
        { permission: "settings.manage", scope: "self" },
      ],
    });
    const [row] = await db.select().from(roles).where(eq(roles.id, created.id));
    expect(row.permissions).toEqual(["attendance.approve:team", "settings.manage:all"]);
  });

  it("protects the owner role and built-in roles", async () => {
    const ownerRole = await roleId(t.tenant.id, "tenant_owner");
    await expect(updateRole(owner, { id: ownerRole.id, name: ownerRole.name, permissions: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const hr = await roleId(t.tenant.id, "hr_admin");
    await expect(updateRole(owner, { id: hr.id, name: "Renamed", permissions: [] })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(deleteRole(owner, hr.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("deletes custom roles only when unassigned", async () => {
    const custom = await createRole(owner, { name: "Temp role", copyFromRoleId: (await roleId(t.tenant.id, "employee")).id });
    const m = await addMember(t.tenant.id, ["employee"]);
    await db.insert(membershipRoles).values({ tenantId: t.tenant.id, membershipId: m.membershipId, roleId: custom.id });
    await expect(deleteRole(owner, custom.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await db.delete(membershipRoles).where(eq(membershipRoles.roleId, custom.id));
    await expect(deleteRole(owner, custom.id)).resolves.toEqual({ id: custom.id });
  });

  it("stops non-owners from granting permissions they do not hold", async () => {
    const admin = await addMember(t.tenant.id, ["hr_admin"]);
    const ctx = await contextFor(t.tenant.id, admin.user.id);
    const created = await createRole(ctx, { name: "Payroll helper" });
    await expect(
      updateRole(ctx, { id: created.id, name: "Payroll helper", permissions: [{ permission: "payroll.run", scope: "all" }] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      updateRole(ctx, { id: created.id, name: "Payroll helper", permissions: [{ permission: "leave.view", scope: "all" }] }),
    ).resolves.toMatchObject({ changed: true });
  });
});

describe("members and last-owner guard", () => {
  let t: Awaited<ReturnType<typeof createOwnedTenant>>;
  let owner: RequestContext;

  beforeAll(async () => {
    t = await createOwnedTenant();
    owner = await contextFor(t.tenant.id, t.user.id);
  });

  it("cannot remove the last active tenant owner", async () => {
    const employee = await roleId(t.tenant.id, "employee");
    await expect(updateMemberRoles(owner, { membershipId: owner.membershipId, roleIds: [employee.id] })).rejects.toMatchObject({
      code: "INVALID_STATE",
      message: expect.stringMatching(/Tenant Owner/),
    });
    // Unchanged after the rollback.
    const rows = await listMembers(owner);
    expect(rows.find((r) => r.isSelf)?.isOwner).toBe(true);
  });

  it("cannot suspend yourself, and only owners can suspend owners", async () => {
    await expect(setMembershipStatus(owner, { membershipId: owner.membershipId, status: "suspended" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const second = await addMember(t.tenant.id, ["tenant_owner"]);
    const admin = await addMember(t.tenant.id, ["hr_admin"]);
    const adminCtx = await contextFor(t.tenant.id, admin.user.id);
    await expect(setMembershipStatus(adminCtx, { membershipId: second.membershipId, status: "suspended" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // hr_admin cannot hand out Tenant Owner either.
    const ownerRole = await roleId(t.tenant.id, "tenant_owner");
    await expect(updateMemberRoles(adminCtx, { membershipId: admin.membershipId, roleIds: [ownerRole.id] })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // With a second owner, the first owner may suspend them, then the guard applies again.
    await expect(setMembershipStatus(owner, { membershipId: second.membershipId, status: "suspended" })).resolves.toEqual({ affectedUserIds: [second.user.id] });
    const employee = await roleId(t.tenant.id, "employee");
    await expect(updateMemberRoles(owner, { membershipId: owner.membershipId, roleIds: [employee.id] })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await setMembershipStatus(owner, { membershipId: second.membershipId, status: "active" });
    // Now there are two active owners, so the first may step down.
    await expect(
      updateMemberRoles(owner, { membershipId: owner.membershipId, roleIds: [employee.id, (await roleId(t.tenant.id, "hr_admin")).id] }),
    ).resolves.toEqual({ affectedUserIds: [t.user.id] });
  });
});

describe("invitations", () => {
  let t: Awaited<ReturnType<typeof createOwnedTenant>>;
  let owner: RequestContext;
  let employeeRole: string;

  beforeAll(async () => {
    t = await createOwnedTenant();
    owner = await contextFor(t.tenant.id, t.user.id);
    employeeRole = (await roleId(t.tenant.id, "hr_manager")).id;
  });

  it("creates, emails and accepts an invitation, linking the employee", async () => {
    const invitee = await createUser(uniqueEmail("invitee"), "Priya Sharma");
    const [le] = await db.select().from(legalEntities).where(eq(legalEntities.tenantId, t.tenant.id));
    const [emp] = await db
      .insert(employees)
      .values({ tenantId: t.tenant.id, legalEntityId: le.id, employeeCode: "INV001", firstName: "Priya", displayName: "Priya Sharma", joiningDate: "2025-04-01", status: "active" })
      .returning();

    const inv = await createInvitation(owner, { email: invitee.email.toUpperCase(), roleIds: [employeeRole], employeeId: emp.id });
    const [row] = await db.select().from(invitations).where(eq(invitations.id, inv.id));
    expect(row.email).toBe(invitee.email);
    expect(row.tokenHash).not.toContain(inv.token);
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 86400_000);
    const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, inv.outboxId!));
    expect(mail.toAddress).toBe(invitee.email);
    expect(mail.html).toContain(`/invite/${inv.token}`);

    const publicView = await getInvitationByToken(inv.token);
    expect(publicView).toMatchObject({ state: "valid", email: invitee.email, tenantName: t.tenant.name });

    // A second invitation for the same address is refused while one is pending.
    await expect(createInvitation(owner, { email: invitee.email, roleIds: [employeeRole] })).rejects.toMatchObject({ code: "CONFLICT" });

    const res = await acceptInvitation({ userId: invitee.id, email: invitee.email }, { token: inv.token });
    expect(res.tenantId).toBe(t.tenant.id);
    const [m] = await db.select().from(memberships).where(and(eq(memberships.tenantId, t.tenant.id), eq(memberships.userId, invitee.id)));
    expect(m.status).toBe("active");
    const assigned = await db.select().from(membershipRoles).where(eq(membershipRoles.membershipId, m.id));
    expect(assigned.map((r) => r.roleId)).toEqual([employeeRole]);
    const [linked] = await db.select().from(employees).where(eq(employees.id, emp.id));
    expect(linked.userId).toBe(invitee.id);
    expect((await getInvitationByToken(inv.token)).state).toBe("accepted");
    await expect(acceptInvitation({ userId: invitee.id, email: invitee.email }, { token: inv.token })).rejects.toMatchObject({ code: "INVALID_STATE" });

    // Already a member now: re-inviting is a conflict.
    await expect(createInvitation(owner, { email: invitee.email, roleIds: [employeeRole] })).rejects.toMatchObject({ code: "CONFLICT" });
    const members = await listMembers(owner);
    expect(members.find((x) => x.userId === invitee.id)?.employee?.id).toBe(emp.id);
  });

  it("rejects a session whose email does not match", async () => {
    const email = uniqueEmail("target");
    const inv = await createInvitation(owner, { email, roleIds: [employeeRole] });
    const stranger = await createUser(uniqueEmail("stranger"));
    await expect(acceptInvitation({ userId: stranger.id, email: stranger.email }, { token: inv.token })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining(email),
    });
    const [m] = await db.select().from(memberships).where(and(eq(memberships.tenantId, t.tenant.id), eq(memberships.userId, stranger.id)));
    expect(m).toBeUndefined();
  });

  it("rejects expired, revoked and rotated tokens", async () => {
    const user = await createUser(uniqueEmail("late"));
    const inv = await createInvitation(owner, { email: user.email, roleIds: [employeeRole] });
    await db.update(invitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitations.id, inv.id));
    expect((await getInvitationByToken(inv.token)).state).toBe("expired");
    await expect(acceptInvitation({ userId: user.id, email: user.email }, { token: inv.token })).rejects.toMatchObject({
      code: "INVALID_STATE",
      message: expect.stringMatching(/expired/),
    });
    expect((await listInvitations(owner)).find((i) => i.id === inv.id)?.status).toBe("expired");

    // Resend rotates the token: the old link stops working, the new one is valid.
    const resent = await resendInvitation(owner, inv.id);
    expect(resent.token).not.toBe(inv.token);
    expect((await getInvitationByToken(inv.token)).state).toBe("invalid");
    expect((await getInvitationByToken(resent.token)).state).toBe("valid");
    expect(await pendingInvitationsForEmail(user.email.toUpperCase())).toHaveLength(1);

    await revokeInvitation(owner, inv.id);
    expect((await getInvitationByToken(resent.token)).state).toBe("revoked");
    await expect(acceptInvitation({ userId: user.id, email: user.email }, { invitationId: inv.id })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await getInvitationByToken("not-a-real-token-value-0000")).toEqual({ state: "invalid" });
  });

  it("is tenant-isolated: another tenant cannot see or revoke the invitation", async () => {
    const other = await createOwnedTenant();
    const otherCtx = await contextFor(other.tenant.id, other.user.id);
    const inv = await createInvitation(owner, { email: uniqueEmail("iso"), roleIds: [employeeRole] });
    expect((await listInvitations(otherCtx)).some((i) => i.id === inv.id)).toBe(false);
    await expect(revokeInvitation(otherCtx, inv.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Roles from another tenant cannot be assigned.
    await expect(createInvitation(otherCtx, { email: uniqueEmail("x"), roleIds: [employeeRole] })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("requires users.manage", async () => {
    const mgr = await addMember(t.tenant.id, ["people_manager"]);
    const ctx = await contextFor(t.tenant.id, mgr.user.id);
    await expect(createInvitation(ctx, { email: uniqueEmail("y"), roleIds: [employeeRole] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
