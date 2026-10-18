import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { db } from "@/server/db/client";
import { employees, membershipRoles, memberships, roles } from "@/server/db/schema";
import { withTenant, type DbScope } from "@/server/db/tx";
import { createOrganization } from "@/server/services/tenancy/provision";
import { mergeGrants, serializeGrants } from "@/lib/permissions";
import type { RequestContext } from "@/server/auth/context";

export const TEST_PASSWORD = "Test-password-123";

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const uniqueEmail = (prefix = "user") => `${prefix}-${randomUUID().slice(0, 8)}@test.peoplesuccess.local`;

export async function createUser(email = uniqueEmail(), fullName = "Test User") {
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  return { id: data.user.id, email };
}

/** Creates a user that owns a fresh tenant. */
export async function createOwnedTenant(name = `Test Org ${randomUUID().slice(0, 6)}`) {
  const user = await createUser(uniqueEmail("owner"), `${name} Owner`);
  const tenant = await createOrganization(user.id, {
    name,
    legalName: `${name} Private Limited`,
    stateCode: "KA",
    fiscalYearStartMonth: 4,
    timezone: "Asia/Kolkata",
  });
  return { user, tenant };
}

/** Adds a user to a tenant with the given built-in role keys. */
export async function addMember(tenantId: string, roleKeys: string[], opts: { employeeId?: string } = {}) {
  const user = await createUser(uniqueEmail(roleKeys[0] ?? "member"));
  const [m] = await db
    .insert(memberships)
    .values({ tenantId, userId: user.id, status: "active" })
    .returning();
  if (opts.employeeId) await db.update(employees).set({ userId: user.id }).where(eq(employees.id, opts.employeeId));
  const roleRows = await db.select().from(roles).where(eq(roles.tenantId, tenantId));
  for (const key of roleKeys) {
    const role = roleRows.find((r) => r.key === key);
    if (!role) throw new Error(`role ${key} missing`);
    await db.insert(membershipRoles).values({ tenantId, membershipId: m.id, roleId: role.id });
  }
  return { user, membershipId: m.id };
}

/** Builds a RequestContext equivalent to what the app resolves for a signed-in user. */
export async function contextFor(
  tenantId: string,
  userId: string,
  opts: { employeeId?: string | null } = {},
): Promise<RequestContext> {
  const [m] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .then((rows) => rows.filter((r) => r.tenantId === tenantId));
  const roleRows = m
    ? await db
        .select({ id: roles.id, key: roles.key, name: roles.name, permissions: roles.permissions })
        .from(membershipRoles)
        .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
        .where(eq(membershipRoles.membershipId, m.id))
    : [];
  const grants = mergeGrants(roleRows.map((r) => r.permissions));
  const linked = await db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.userId, userId))
    .then((rows) => rows[0]?.id ?? null);
  const employeeId = opts.employeeId !== undefined ? opts.employeeId : linked;
  const scope: DbScope = { tenantId, userId, employeeId, perms: serializeGrants(grants) };
  return {
    userId,
    email: "test@example.com",
    fullName: "Test",
    isPlatformAdmin: false,
    tenantId,
    tenantName: "Test",
    membershipId: m?.id ?? randomUUID(),
    employeeId,
    roles: roleRows.map(({ id, key, name }) => ({ id, key, name })),
    grants,
    perms: scope.perms,
    tenants: [],
    db: (fn) => withTenant(scope, fn),
  };
}
