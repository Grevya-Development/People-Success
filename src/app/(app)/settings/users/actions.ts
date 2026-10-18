"use server";

import { after } from "next/server";
import { refresh, updateTag } from "next/cache";
import { defineAction } from "@/server/lib/action";
import { accessTag } from "@/server/auth/access";
import { sendNow } from "@/server/services/email";
import { createInvitation, resendInvitation, revokeInvitation } from "@/server/services/users/invitations";
import { setMembershipStatus, updateMemberRoles } from "@/server/services/users/members";
import { invitationIdSchema, inviteUserSchema, membershipStatusSchema, updateMemberRolesSchema } from "@/lib/validation/users";

const opts = { permission: "users.manage", scope: "all" } as const;

export const inviteUserAction = defineAction({ input: inviteUserSchema, ...opts }, async (ctx, input) => {
  const res = await createInvitation(ctx, input);
  // The outbox row is committed now; deliver right away, the worker retries failures.
  after(() => sendNow(res.outboxId));
  refresh();
  return { id: res.id };
});

export const resendInvitationAction = defineAction({ input: invitationIdSchema, ...opts }, async (ctx, { id }) => {
  const res = await resendInvitation(ctx, id);
  after(() => sendNow(res.outboxId));
  refresh();
  return { id: res.id };
});

export const revokeInvitationAction = defineAction({ input: invitationIdSchema, ...opts }, async (ctx, { id }) => {
  const res = await revokeInvitation(ctx, id);
  refresh();
  return res;
});

export const updateMemberRolesAction = defineAction({ input: updateMemberRolesSchema, ...opts }, async (ctx, input) => {
  const res = await updateMemberRoles(ctx, input);
  for (const userId of res.affectedUserIds) updateTag(accessTag(userId));
  refresh();
  return null;
});

export const setMembershipStatusAction = defineAction({ input: membershipStatusSchema, ...opts }, async (ctx, input) => {
  const res = await setMembershipStatus(ctx, input);
  for (const userId of res.affectedUserIds) updateTag(accessTag(userId));
  refresh();
  return null;
});
