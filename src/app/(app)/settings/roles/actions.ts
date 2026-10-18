"use server";

import { refresh, updateTag } from "next/cache";
import { defineAction } from "@/server/lib/action";
import { accessTag } from "@/server/auth/access";
import { createRole, deleteRole, updateRole } from "@/server/services/settings/roles";
import { createRoleSchema, roleIdSchema, updateRoleSchema } from "@/lib/validation/users";

const opts = { permission: "roles.manage", scope: "all" } as const;

export const createRoleAction = defineAction({ input: createRoleSchema, ...opts }, async (ctx, input) => {
  const res = await createRole(ctx, input);
  refresh();
  return res;
});

export const updateRoleAction = defineAction({ input: updateRoleSchema, ...opts }, async (ctx, input) => {
  const res = await updateRole(ctx, input);
  // Grants are cached per user; refresh everyone holding the role right away.
  for (const userId of res.affectedUserIds) updateTag(accessTag(userId));
  refresh();
  return { changed: res.changed, affected: res.affectedUserIds.length };
});

export const deleteRoleAction = defineAction({ input: roleIdSchema, ...opts }, async (ctx, { id }) => {
  const res = await deleteRole(ctx, id);
  refresh();
  return res;
});
