import { eq, sql, type Column } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Tx } from "../../db/client";
import { tenants } from "../../db/schema";
import type { RequestContext } from "../../auth/context";
import { audit, type AuditEntry } from "../../lib/audit";
import { AppError, fromDatabaseError } from "../../lib/errors";
import type { SetupStepKey } from "@/lib/setup-steps";

export type SettingsCtx = Pick<RequestContext, "tenantId" | "userId" | "grants" | "db">;

export const auditAs = (tx: Tx, ctx: SettingsCtx, entry: AuditEntry) =>
  audit(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, entry);

/** Plain JSON-able snapshot of a row for audit diffs. */
export function snapshot<T extends Record<string, unknown>>(row: T | null | undefined): Record<string, unknown> | null {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "tenantId" || k === "createdAt" || k === "updatedAt") continue;
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

/**
 * Record setup-wizard steps as complete (idempotent). Runs under RLS, so for
 * users without settings.manage the update silently affects no rows; the
 * wizard still computes readiness from live data.
 */
export async function recordSetupSteps(tx: Tx, tenantId: string, steps: SetupStepKey[]) {
  if (!steps.length) return;
  await tx.execute(sql`
    update tenants
    set settings = jsonb_set(
      settings,
      '{setup,completedSteps}',
      (
        select coalesce(jsonb_agg(distinct s), '[]'::jsonb)
        from jsonb_array_elements_text(coalesce(settings #> '{setup,completedSteps}', '[]'::jsonb) || ${JSON.stringify(steps)}::jsonb) s
      ),
      true
    ),
    updated_at = now()
    where id = ${tenantId}`);
}

/** Map Postgres errors raised by our triggers / constraints to friendly messages. */
export function friendlyDbError(err: unknown, messages: Record<string, string> = {}): never {
  if (err instanceof AppError) throw err;
  const cause = ((err as { cause?: unknown })?.cause ?? err) as { code?: string; constraint_name?: string; message?: string };
  const constraint = cause?.constraint_name ?? "";
  if (constraint && messages[constraint]) throw new AppError("CONFLICT", messages[constraint]);
  if (cause?.code === "23514" && /department/i.test(cause.message ?? "")) {
    throw new AppError("VALIDATION", "That parent would create a loop in the department hierarchy.", {
      fieldErrors: { parentId: ["Choose a parent that is not this department or one of its sub-departments"] },
    });
  }
  throw fromDatabaseError(err) ?? err;
}

/** Number of rows (visible under RLS) that reference `id` through any of the given columns. */
export async function referenceCount(tx: Tx, refs: { table: PgTable; column: Column }[], id: string) {
  if (!refs.length) return 0;
  const parts = refs.map((r) => sql`(select count(*) from ${r.table} where ${r.column} = ${id})`);
  const rows = await tx.execute<{ n: number }>(sql`select (${sql.join(parts, sql` + `)})::int as n`);
  return Number(rows[0]?.n ?? 0);
}

export async function lockTenant(tx: Tx, tenantId: string) {
  const [row] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for("update");
  return row ?? null;
}
