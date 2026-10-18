import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { addDays } from "date-fns";
import { authorize } from "../../auth/context";
import type { Tx } from "../../db/client";
import { withSystem } from "../../db/tx";
import { employees, invitations, membershipRoles, memberships, roles, tenants, users } from "../../db/schema";
import { env } from "../../env";
import { audit, diff } from "../../lib/audit";
import { conflict, forbidden, invalidState, notFound, validation } from "../../lib/errors";
import { randomToken, sha256 } from "../../lib/crypto";
import { inviteUserSchema, type AcceptInvitationInput, type InviteUserInput } from "@/lib/validation/users";
import { enqueueEmail, renderEmail } from "../email";
import { auditAs, recordSetupSteps, type SettingsCtx } from "../settings/shared";
import { assertAssignableRoles } from "./guards";

export const INVITATION_TTL_DAYS = 7;

export type InvitationRow = {
  id: string;
  email: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  roles: string[];
  employeeName: string | null;
  invitedByName: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
};

const effectiveStatus = (status: InvitationRow["status"], expiresAt: Date) =>
  status === "pending" && expiresAt.getTime() <= Date.now() ? "expired" : status;

export async function listInvitations(ctx: SettingsCtx): Promise<InvitationRow[]> {
  authorize(ctx, "users.manage", "all");
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ inv: invitations, invitedByName: sql<string | null>`coalesce(${users.fullName}, ${users.email})` })
      .from(invitations)
      .leftJoin(users, eq(users.id, invitations.invitedBy))
      .where(sql`${invitations.status} = 'pending' or ${invitations.updatedAt} > now() - interval '30 days'`)
      .orderBy(desc(invitations.createdAt))
      .limit(200);
    const roleIds = [...new Set(rows.flatMap((r) => r.inv.roleIds))];
    const roleNames = roleIds.length
      ? new Map((await tx.select({ id: roles.id, name: roles.name }).from(roles).where(inArray(roles.id, roleIds))).map((r) => [r.id, r.name]))
      : new Map<string, string>();
    const empIds = rows.map((r) => r.inv.employeeId).filter((v): v is string => !!v);
    const empNames = empIds.length
      ? new Map((await tx.select({ id: employees.id, name: employees.displayName }).from(employees).where(inArray(employees.id, empIds))).map((e) => [e.id, e.name]))
      : new Map<string, string>();
    return rows.map(({ inv, invitedByName }) => ({
      id: inv.id,
      email: inv.email,
      status: effectiveStatus(inv.status, inv.expiresAt),
      roles: inv.roleIds.map((id) => roleNames.get(id)).filter((v): v is string => !!v),
      employeeName: inv.employeeId ? (empNames.get(inv.employeeId) ?? null) : null,
      invitedByName,
      expiresAt: inv.expiresAt.toISOString(),
      acceptedAt: inv.acceptedAt?.toISOString() ?? null,
      createdAt: inv.createdAt.toISOString(),
    }));
  });
}

export const invitationUrl = (token: string) => `${env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/invite/${token}`;

async function queueInvitationEmail(
  tx: Tx,
  ctx: SettingsCtx,
  inv: { id: string; email: string; roleIds: string[]; tokenHash: string; expiresAt: Date },
  token: string,
) {
  const [[tenant], [inviter], roleRows] = await Promise.all([
    tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, ctx.tenantId)),
    tx.select({ name: users.fullName, email: users.email }).from(users).where(eq(users.id, ctx.userId)),
    inv.roleIds.length ? tx.select({ name: roles.name }).from(roles).where(inArray(roles.id, inv.roleIds)) : Promise.resolve([]),
  ]);
  const orgName = tenant?.name ?? "your organization";
  const inviterName = inviter?.name ?? inviter?.email ?? "A colleague";
  const roleList = roleRows.map((r) => r.name).join(", ");
  const { html, text } = renderEmail({
    title: `Join ${orgName} on PeopleSuccess`,
    body: [
      `${inviterName} invited you to join ${orgName} on PeopleSuccess${roleList ? ` as ${roleList}` : ""}.`,
      `Accept the invitation with this email address (${inv.email}). You can create an account or sign in if you already have one.`,
    ],
    cta: { label: "Accept invitation", href: invitationUrl(token) },
    footer: `This invitation expires on ${inv.expiresAt.toUTCString().slice(0, 16)}. If you were not expecting it, you can ignore this email.`,
  });
  return enqueueEmail(tx, {
    tenantId: ctx.tenantId,
    to: inv.email,
    template: "invitation",
    subject: `${inviterName} invited you to ${orgName} on PeopleSuccess`,
    html,
    text,
    dedupeKey: `invitation:${inv.id}:${inv.tokenHash.slice(0, 16)}`,
  });
}

export type InvitationResult = {
  id: string;
  /** Raw token: only returned to server code (tests, email). Never send it to the browser. */
  token: string;
  outboxId: string | null;
};

export async function createInvitation(ctx: SettingsCtx, raw: InviteUserInput): Promise<InvitationResult> {
  authorize(ctx, "users.manage", "all");
  const input = inviteUserSchema.parse(raw);
  return ctx.db(async (tx) => {
    const [member] = await tx
      .select({ status: memberships.status })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.tenantId, ctx.tenantId), sql`lower(${users.email}) = ${input.email}`));
    if (member?.status === "active") throw conflict("This person is already an active member of your organization.");

    const roleRows = await assertAssignableRoles(tx, ctx, input.roleIds);

    if (input.employeeId) {
      const [emp] = await tx
        .select({ id: employees.id, userId: employees.userId })
        .from(employees)
        .where(and(eq(employees.id, input.employeeId), isNull(employees.deletedAt)));
      if (!emp) throw validation("Choose a valid employee.", { employeeId: ["Employee not found"] });
      if (emp.userId) throw validation("That employee is already linked to a user.", { employeeId: ["Already linked to a login"] });
    }

    const open = await tx
      .select()
      .from(invitations)
      .where(and(eq(invitations.status, "pending"), sql`lower(${invitations.email}) = ${input.email}`))
      .for("update");
    for (const o of open) {
      if (o.expiresAt.getTime() > Date.now()) {
        throw conflict("An invitation is already pending for this email. Resend it instead.");
      }
      await tx.update(invitations).set({ status: "expired" }).where(eq(invitations.id, o.id));
    }

    const token = randomToken();
    const [inv] = await tx
      .insert(invitations)
      .values({
        tenantId: ctx.tenantId,
        email: input.email,
        roleIds: roleRows.map((r) => r.id),
        employeeId: input.employeeId,
        tokenHash: sha256(token),
        expiresAt: addDays(new Date(), INVITATION_TTL_DAYS),
        invitedBy: ctx.userId,
      })
      .returning();
    const outboxId = await queueInvitationEmail(tx, ctx, inv, token);
    await auditAs(tx, ctx, {
      action: "invitation.created",
      entityType: "invitation",
      entityId: inv.id,
      changes: diff(null, { email: inv.email, roles: roleRows.map((r) => r.name), employeeId: inv.employeeId }),
    });
    await recordSetupSteps(tx, ctx.tenantId, ["admins"]);
    return { id: inv.id, token, outboxId };
  });
}

/** Rotate the token (old links stop working), extend the expiry and email again. */
export async function resendInvitation(ctx: SettingsCtx, id: string): Promise<InvitationResult> {
  authorize(ctx, "users.manage", "all");
  return ctx.db(async (tx) => {
    const [inv] = await tx.select().from(invitations).where(eq(invitations.id, id)).for("update");
    if (!inv) throw notFound("Invitation");
    if (inv.status !== "pending" && inv.status !== "expired") throw invalidState(`This invitation was already ${inv.status}.`);
    const [member] = await tx
      .select({ status: memberships.status })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.tenantId, ctx.tenantId), sql`lower(${users.email}) = lower(${inv.email})`));
    if (member?.status === "active") throw conflict("This person is already an active member of your organization.");

    const token = randomToken();
    const [updated] = await tx
      .update(invitations)
      .set({ tokenHash: sha256(token), status: "pending", expiresAt: addDays(new Date(), INVITATION_TTL_DAYS) })
      .where(eq(invitations.id, inv.id))
      .returning();
    const outboxId = await queueInvitationEmail(tx, ctx, updated, token);
    await auditAs(tx, ctx, { action: "invitation.resent", entityType: "invitation", entityId: inv.id, metadata: { email: inv.email } });
    return { id: inv.id, token, outboxId };
  });
}

export async function revokeInvitation(ctx: SettingsCtx, id: string) {
  authorize(ctx, "users.manage", "all");
  return ctx.db(async (tx) => {
    const [inv] = await tx.select().from(invitations).where(eq(invitations.id, id)).for("update");
    if (!inv) throw notFound("Invitation");
    if (inv.status !== "pending") throw invalidState(`This invitation was already ${inv.status}.`);
    await tx.update(invitations).set({ status: "revoked" }).where(eq(invitations.id, inv.id));
    await auditAs(tx, ctx, {
      action: "invitation.revoked",
      entityType: "invitation",
      entityId: inv.id,
      changes: diff({ status: inv.status }, { status: "revoked" }),
      metadata: { email: inv.email },
    });
    return { id };
  });
}

/* ------------------------------------------------------------------ */
/* Public acceptance (system context: the user is not a member yet)    */
/* ------------------------------------------------------------------ */

export type InvitationState = "valid" | "invalid" | "expired" | "revoked" | "accepted";

export type PublicInvitation = {
  state: InvitationState;
  id?: string;
  email?: string;
  tenantName?: string;
  inviterName?: string | null;
  expiresAt?: string;
};

function stateOf(inv: { status: string; expiresAt: Date }, tenantStatus: string): InvitationState {
  if (tenantStatus === "suspended" || tenantStatus === "closed") return "invalid";
  if (inv.status === "accepted") return "accepted";
  if (inv.status === "revoked") return "revoked";
  if (inv.status === "expired" || inv.expiresAt.getTime() <= Date.now()) return "expired";
  return "valid";
}

/** Look up an invitation by its raw token for the public /invite page. */
export async function getInvitationByToken(token: string): Promise<PublicInvitation> {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) return { state: "invalid" };
  return withSystem(async (tx) => {
    const [row] = await tx
      .select({
        id: invitations.id,
        email: invitations.email,
        status: invitations.status,
        expiresAt: invitations.expiresAt,
        tenantName: tenants.name,
        tenantStatus: tenants.status,
        inviterName: sql<string | null>`coalesce(${users.fullName}, ${users.email})`,
      })
      .from(invitations)
      .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
      .leftJoin(users, eq(users.id, invitations.invitedBy))
      .where(eq(invitations.tokenHash, sha256(token)))
      .limit(1);
    if (!row) return { state: "invalid" as const };
    return {
      state: stateOf(row, row.tenantStatus),
      id: row.id,
      email: row.email,
      tenantName: row.tenantName,
      inviterName: row.inviterName,
      expiresAt: row.expiresAt.toISOString(),
    };
  });
}

/** Valid invitations addressed to a (verified) email, for users who signed up from an invite. */
export async function pendingInvitationsForEmail(email: string) {
  return withSystem(async (tx) => {
    const rows = await tx
      .select({
        id: invitations.id,
        tenantName: tenants.name,
        tenantStatus: tenants.status,
        status: invitations.status,
        expiresAt: invitations.expiresAt,
        inviterName: sql<string | null>`coalesce(${users.fullName}, ${users.email})`,
      })
      .from(invitations)
      .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
      .leftJoin(users, eq(users.id, invitations.invitedBy))
      .where(and(eq(invitations.status, "pending"), sql`lower(${invitations.email}) = lower(${email})`))
      .orderBy(desc(invitations.createdAt));
    return rows
      .filter((r) => stateOf(r, r.tenantStatus) === "valid")
      .map((r) => ({ id: r.id, tenantName: r.tenantName, inviterName: r.inviterName, expiresAt: r.expiresAt.toISOString() }));
  });
}

export type AcceptSession = { userId: string; email: string | null };

/**
 * Accept an invitation in one system transaction: re-validate it, require the
 * signed-in email to match, activate the membership, assign the roles, link
 * the employee record and mark the invitation accepted.
 *
 * Accepting by id (instead of token) is allowed because the session email is
 * verified by Supabase and must equal the invited address.
 */
export async function acceptInvitation(session: AcceptSession, input: AcceptInvitationInput) {
  return withSystem(async (tx) => {
    const where =
      "token" in input ? eq(invitations.tokenHash, sha256(input.token)) : eq(invitations.id, input.invitationId);
    const [inv] = await tx.select().from(invitations).where(where).for("update");
    if (!inv) throw notFound("Invitation");
    const [tenant] = await tx.select({ id: tenants.id, name: tenants.name, status: tenants.status }).from(tenants).where(eq(tenants.id, inv.tenantId));
    const state = stateOf(inv, tenant?.status ?? "closed");
    if (state === "accepted") throw invalidState("This invitation has already been accepted.");
    if (state === "revoked") throw invalidState("This invitation was revoked. Ask your administrator for a new one.");
    if (state === "expired") throw invalidState("This invitation has expired. Ask your administrator to resend it.");
    if (state !== "valid" || !tenant) throw invalidState("This invitation is no longer valid.");

    if (!session.email || session.email.trim().toLowerCase() !== inv.email.trim().toLowerCase()) {
      throw forbidden(`This invitation was sent to ${inv.email}. Sign in with that email address to accept it.`);
    }
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, session.userId));
    if (!user) throw invalidState("Your account profile is not ready yet. Please sign in again.");

    const [membership] = await tx
      .insert(memberships)
      .values({ tenantId: inv.tenantId, userId: session.userId, status: "active", invitedBy: inv.invitedBy })
      .onConflictDoUpdate({
        target: [memberships.tenantId, memberships.userId],
        set: { status: "active", invitedBy: inv.invitedBy, updatedAt: new Date() },
      })
      .returning({ id: memberships.id });

    // Roles may have been deleted since the invite; fall back to self-service.
    let roleRows = inv.roleIds.length
      ? await tx
          .select({ id: roles.id, name: roles.name })
          .from(roles)
          .where(and(eq(roles.tenantId, inv.tenantId), inArray(roles.id, inv.roleIds)))
      : [];
    if (!roleRows.length) {
      roleRows = await tx
        .select({ id: roles.id, name: roles.name })
        .from(roles)
        .where(and(eq(roles.tenantId, inv.tenantId), eq(roles.key, "employee")));
    }
    if (roleRows.length) {
      await tx
        .insert(membershipRoles)
        .values(roleRows.map((r) => ({ tenantId: inv.tenantId, membershipId: membership.id, roleId: r.id, grantedBy: inv.invitedBy })))
        .onConflictDoNothing();
    }

    let linkedEmployeeId: string | null = null;
    if (inv.employeeId) {
      const [alreadyLinked] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.tenantId, inv.tenantId), eq(employees.userId, session.userId)));
      if (!alreadyLinked) {
        const linked = await tx
          .update(employees)
          .set({ userId: session.userId })
          .where(
            and(
              eq(employees.tenantId, inv.tenantId),
              eq(employees.id, inv.employeeId),
              isNull(employees.userId),
              isNull(employees.deletedAt),
            ),
          )
          .returning({ id: employees.id });
        linkedEmployeeId = linked[0]?.id ?? null;
      }
    }

    await tx.update(invitations).set({ status: "accepted", acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
    await tx.update(users).set({ lastActiveTenantId: inv.tenantId }).where(eq(users.id, session.userId));
    await audit(tx, { tenantId: inv.tenantId, userId: session.userId }, {
      action: "invitation.accepted",
      entityType: "invitation",
      entityId: inv.id,
      metadata: { membershipId: membership.id, roles: roleRows.map((r) => r.name), linkedEmployeeId },
    });
    return { tenantId: inv.tenantId, tenantName: tenant.name, membershipId: membership.id };
  });
}
