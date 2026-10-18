import { z } from "zod";
import { PERMISSIONS, type Permission, type Scope } from "@/lib/permissions";
import { password } from "@/lib/validation/auth";

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);

/* ------------------------------------------------------------------ */
/* Members and invitations                                             */
/* ------------------------------------------------------------------ */

export const inviteUserSchema = z.object({
  email,
  roleIds: z.array(z.uuid()).min(1, "Choose at least one role").max(20),
  employeeId: z.uuid().nullable().optional().transform((v) => v ?? null),
});
export type InviteUserInput = z.input<typeof inviteUserSchema>;

export const invitationIdSchema = z.object({ id: z.uuid() });

export const updateMemberRolesSchema = z.object({
  membershipId: z.uuid(),
  roleIds: z.array(z.uuid()).min(1, "Choose at least one role").max(20),
});
export type UpdateMemberRolesInput = z.input<typeof updateMemberRolesSchema>;

export const membershipStatusSchema = z.object({
  membershipId: z.uuid(),
  status: z.enum(["active", "suspended"]),
});

/** Raw invitation tokens are 32 random bytes, base64url encoded (43 chars). */
export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/, "Invalid invitation link");

export const acceptInvitationSchema = z.union([
  z.object({ token: invitationTokenSchema }),
  z.object({ invitationId: z.uuid() }),
]);
export type AcceptInvitationInput = z.input<typeof acceptInvitationSchema>;

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

const permissionKey = z.string().refine((p): p is Permission => p in PERMISSIONS, "Unknown permission");
const scope = z.enum(["self", "team", "all"]);

export const rolePermissionsSchema = z
  .array(z.object({ permission: permissionKey, scope }))
  .max(Object.keys(PERMISSIONS).length);

export const createRoleSchema = z.object({
  name: z.string().trim().min(2, "Enter a role name").max(60, "Use at most 60 characters"),
  description: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : undefined)),
  copyFromRoleId: z.uuid().nullable().optional().transform((v) => v ?? null),
});
export type CreateRoleInput = z.input<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(2, "Enter a role name").max(60, "Use at most 60 characters"),
  description: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : undefined)),
  permissions: rolePermissionsSchema,
});
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;

export const roleIdSchema = z.object({ id: z.uuid() });

/** Normalize to the stored grant format "<permission>:<scope>"; unscoped permissions are always "all". */
export function toGrantStrings(items: { permission: string; scope: Scope }[]): string[] {
  const out = new Map<string, Scope>();
  for (const { permission, scope: s } of items) {
    if (!(permission in PERMISSIONS)) continue;
    const def = PERMISSIONS[permission as Permission] as { scoped?: boolean };
    out.set(permission, def.scoped ? s : "all");
  }
  return [...out.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([p, s]) => `${p}:${s}`);
}

/* ------------------------------------------------------------------ */
/* Invitation sign-up (public)                                         */
/* ------------------------------------------------------------------ */

export const inviteSignUpSchema = z.object({
  token: invitationTokenSchema,
  fullName: z.string().trim().min(2, "Enter your full name").max(120),
  password,
});
export type InviteSignUpInput = z.input<typeof inviteSignUpSchema>;
