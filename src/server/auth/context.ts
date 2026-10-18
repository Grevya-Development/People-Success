import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { supabaseServer } from "./supabase";
import { loadAccess, type Access } from "./access";
import { withTenant } from "../db/tx";
import type { Tx } from "../db/client";
import { AppError, forbidden } from "../lib/errors";
import { hasScope, type Grants, type Permission, type Scope } from "@/lib/permissions";

export const TENANT_COOKIE = "ps_tenant";

export type Session = { userId: string; email: string | null; aal: string | null };

/**
 * Verified session from the Supabase auth cookie. getClaims() validates the
 * JWT signature locally against the cached JWKS (ES256), so this does not
 * call the auth server on every request.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  // Session reads are request-time by definition (token expiry uses the clock).
  await connection();
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const c = data.claims;
  return { userId: c.sub, email: (c.email as string) ?? null, aal: (c.aal as string) ?? null };
});

export type RequestContext = {
  userId: string;
  email: string;
  fullName: string | null;
  isPlatformAdmin: boolean;
  tenantId: string;
  tenantName: string;
  membershipId: string;
  employeeId: string | null;
  roles: { id: string; key: string | null; name: string }[];
  grants: Grants;
  perms: string;
  tenants: Access["tenants"];
  /** Run queries as this user inside their tenant (RLS enforced). */
  db: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
};

export const getAccess = cache(async (): Promise<Access | null> => {
  const session = await getSession();
  if (!session) return null;
  const preferred = (await cookies()).get(TENANT_COOKIE)?.value ?? null;
  return loadAccess(session.userId, preferred);
});

function buildContext(access: Access): RequestContext | null {
  const a = access.active;
  if (!a) return null;
  const scope = { tenantId: a.tenant.id, userId: access.user.id, employeeId: a.employeeId, perms: a.perms };
  return {
    userId: access.user.id,
    email: access.user.email,
    fullName: access.user.fullName,
    isPlatformAdmin: access.user.isPlatformAdmin,
    tenantId: a.tenant.id,
    tenantName: a.tenant.name,
    membershipId: a.membershipId,
    employeeId: a.employeeId,
    roles: a.roles,
    grants: a.grants,
    perms: a.perms,
    tenants: access.tenants,
    db: (fn) => withTenant(scope, fn),
  };
}

/** Context or null. Use in places that render differently for signed-out users. */
export const getContext = cache(async (): Promise<RequestContext | null> => {
  const access = await getAccess();
  return access ? buildContext(access) : null;
});

/** Context for pages: redirects to sign-in or org setup when missing. */
export async function requireContext(): Promise<RequestContext> {
  const access = await getAccess();
  if (!access) redirect("/login");
  const ctx = buildContext(access);
  if (!ctx) redirect("/setup/organization");
  return ctx;
}

/** Context for actions and API handlers: throws instead of redirecting. */
export async function requireActionContext(): Promise<RequestContext> {
  const access = await getAccess();
  if (!access) throw new AppError("UNAUTHENTICATED", "Your session has expired. Please sign in again.");
  const ctx = buildContext(access);
  if (!ctx) throw new AppError("FORBIDDEN", "You are not a member of an active organization.");
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Authorization                                                       */
/* ------------------------------------------------------------------ */

export const can = (ctx: Pick<RequestContext, "grants">, perm: Permission, scope: Scope = "self") =>
  hasScope(ctx.grants, perm, scope);

export const scopeOf = (ctx: Pick<RequestContext, "grants">, perm: Permission): Scope | null =>
  ctx.grants[perm] ?? null;

export function authorize(ctx: Pick<RequestContext, "grants">, perm: Permission, scope: Scope = "self") {
  if (!hasScope(ctx.grants, perm, scope)) throw forbidden();
}

/**
 * Reporting subtree (direct + indirect reports) of the signed-in employee,
 * memoized per request. Used to apply "team" scope.
 */
export const getTeamEmployeeIds = cache(async (ctx: RequestContext): Promise<string[]> => {
  if (!ctx.employeeId) return [];
  const rows = await ctx.db((tx) =>
    tx.execute<{ id: string }>(sql`
      with recursive tree(id, depth) as (
        select e.id, 1 from employees e where e.manager_id = ${ctx.employeeId} and e.deleted_at is null
        union all
        select e.id, t.depth + 1 from employees e join tree t on e.manager_id = t.id
        where e.deleted_at is null and t.depth < 50
      )
      select id from tree`),
  );
  return rows.map((r) => r.id);
});

/**
 * Whether ctx may act on records belonging to employeeId under perm.
 * Resolves self / team / all scope.
 */
export async function canAccessEmployee(ctx: RequestContext, perm: Permission, employeeId: string) {
  const scope = scopeOf(ctx, perm);
  if (!scope) return false;
  if (scope === "all") return true;
  if (employeeId === ctx.employeeId) return true;
  if (scope === "team") return (await getTeamEmployeeIds(ctx)).includes(employeeId);
  return false;
}

export async function authorizeEmployee(ctx: RequestContext, perm: Permission, employeeId: string) {
  if (!(await canAccessEmployee(ctx, perm, employeeId))) throw forbidden();
}

/** Client IP and user agent for audit records. */
export async function requestMeta() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent"), requestId: h.get("x-request-id") };
}
