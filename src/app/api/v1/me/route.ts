import { apiHandler } from "@/server/api/http";

/** GET /api/v1/me — the authenticated user, organization and effective permissions. */
export const GET = apiHandler(async ({ ctx }) => ({
  user: { id: ctx.userId, email: ctx.email, name: ctx.fullName },
  organization: { id: ctx.tenantId, name: ctx.tenantName },
  employeeId: ctx.employeeId,
  roles: ctx.roles.map((r) => ({ key: r.key, name: r.name })),
  permissions: ctx.grants,
}));
