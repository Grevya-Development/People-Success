import { sql } from "drizzle-orm";
import { db, type Tx } from "./client";

export type DbScope = {
  tenantId: string;
  /** Verified Supabase user id. */
  userId: string;
  employeeId: string | null;
  /** Serialized grants, e.g. "employees.view:all,leave.approve:team". */
  perms: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` in a transaction as the `authenticated` role with the tenant,
 * user and permission context set. Postgres RLS then enforces tenant
 * isolation and sensitive-table rules for every statement inside.
 *
 * All settings are transaction-local (`set_config(..., true)`), so pooled
 * connections never leak context between requests.
 */
export async function withTenant<T>(scope: DbScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(scope.tenantId) || !UUID.test(scope.userId)) {
    throw new Error("withTenant: invalid scope");
  }
  const claims = JSON.stringify({ sub: scope.userId, role: "authenticated" });
  return db.transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('request.jwt.claims', ${claims}, true),
      set_config('app.tenant_id', ${scope.tenantId}, true),
      set_config('app.employee_id', ${scope.employeeId ?? ""}, true),
      set_config('app.perms', ${scope.perms}, true),
      set_config('role', 'authenticated', true)`);
    return fn(tx);
  });
}

/**
 * Trusted system context (background jobs, signup, webhooks). Bypasses RLS,
 * so callers MUST filter by tenant explicitly. Never call this with ids taken
 * from user input without first authorizing the request.
 */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>, tenantId?: string): Promise<T> {
  return db.transaction(async (tx) => {
    if (tenantId) {
      if (!UUID.test(tenantId)) throw new Error("withSystem: invalid tenant");
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    }
    return fn(tx);
  });
}
