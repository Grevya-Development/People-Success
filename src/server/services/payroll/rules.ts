import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, or, gt, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Tx } from "../../db/client";
import type { RequestContext } from "../../auth/context";
import { authorize } from "../../auth/context";
import { payrollRuns, statutoryRuleSets, users } from "../../db/schema";
import { audit } from "../../lib/audit";
import { AppError, invalidState, notFound } from "../../lib/errors";
import { DEFAULT_RULE_SETS } from "@/lib/payroll/defaults";
import { parseRuleParameters, validateRuleParameters, type RuleKind, type RuleParamsByKind } from "@/lib/payroll/params";
import type { markVerifiedSchema, ruleSetVersionSchema } from "@/lib/validation/payroll";
import { authorizePayrollRead } from "./shared";

export type RuleSetRow = typeof statutoryRuleSets.$inferSelect;

export type RuleSetSummary = {
  id: string;
  kind: string;
  jurisdiction: string;
  name: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  version: number;
  verified: boolean;
  verifiedAt: string | null;
  verifiedByName: string | null;
  sourceReference: string | null;
  notes: string | null;
  parameters: Record<string, unknown>;
  usedByPostedRun: boolean;
  isLatestVersion: boolean;
};

export async function listRuleSets(ctx: RequestContext): Promise<RuleSetSummary[]> {
  authorizePayrollRead(ctx);
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ r: statutoryRuleSets, verifiedByName: users.fullName })
      .from(statutoryRuleSets)
      .leftJoin(users, eq(users.id, statutoryRuleSets.verifiedBy))
      .orderBy(asc(statutoryRuleSets.kind), asc(statutoryRuleSets.jurisdiction), desc(statutoryRuleSets.effectiveFrom), desc(statutoryRuleSets.version));
    const used = await usedRuleSetIds(tx);
    const latest = new Map<string, number>();
    for (const { r } of rows) {
      const k = `${r.kind}|${r.jurisdiction}|${r.effectiveFrom}`;
      latest.set(k, Math.max(latest.get(k) ?? 0, r.version));
    }
    return rows.map(({ r, verifiedByName }) => ({
      id: r.id,
      kind: r.kind,
      jurisdiction: r.jurisdiction,
      name: r.name,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      version: r.version,
      verified: !!r.verifiedAt,
      verifiedAt: r.verifiedAt?.toISOString() ?? null,
      verifiedByName,
      sourceReference: r.sourceReference,
      notes: r.notes,
      parameters: r.parameters,
      usedByPostedRun: used.has(r.id),
      isLatestVersion: latest.get(`${r.kind}|${r.jurisdiction}|${r.effectiveFrom}`) === r.version,
    }));
  });
}

/** Rule-set ids referenced by any locked, disbursed or published run. */
async function usedRuleSetIds(tx: Tx) {
  const rows = await tx.execute<{ id: string }>(sql`
    select distinct (rs ->> 'id') as id
    from ${payrollRuns} r, jsonb_array_elements(coalesce(r.calculation_basis -> 'ruleSets', '[]'::jsonb)) rs
    where r.status in ('locked','disbursed','published')`);
  return new Set(rows.map((r) => r.id));
}

/** Idempotently insert the default rule sets (unverified). Existing rows are never touched. */
export async function seedDefaultRuleSets(ctx: RequestContext) {
  authorize(ctx, "payroll.config", "all");
  return ctx.db(async (tx) => {
    let created = 0;
    for (const d of DEFAULT_RULE_SETS) {
      const [existing] = await tx
        .select({ id: statutoryRuleSets.id })
        .from(statutoryRuleSets)
        .where(and(eq(statutoryRuleSets.kind, d.kind), eq(statutoryRuleSets.jurisdiction, d.jurisdiction), eq(statutoryRuleSets.effectiveFrom, d.effectiveFrom)))
        .limit(1);
      if (existing) continue;
      const v = validateRuleParameters(d.kind, d.parameters);
      if (!v.ok) throw new Error(`Default ${d.kind}/${d.jurisdiction} parameters are invalid: ${v.issues.join("; ")}`);
      const inserted = await tx
        .insert(statutoryRuleSets)
        .values({
          tenantId: ctx.tenantId,
          kind: d.kind,
          jurisdiction: d.jurisdiction,
          name: d.name,
          effectiveFrom: d.effectiveFrom,
          version: 1,
          parameters: d.parameters,
          sourceReference: d.sourceReference,
          notes: d.notes,
          createdBy: ctx.userId,
        })
        .onConflictDoNothing()
        .returning({ id: statutoryRuleSets.id });
      created += inserted.length;
    }
    await audit(tx, ctx, { action: "payroll.rule_sets_seeded", entityType: "statutory_rule_set", metadata: { created, offered: DEFAULT_RULE_SETS.length } });
    return { created, skipped: DEFAULT_RULE_SETS.length - created };
  });
}

/**
 * Saves parameters as a NEW version. Rule sets are never edited in place, so
 * a run that used a version keeps exactly what it was calculated with.
 */
export async function createRuleSetVersion(ctx: RequestContext, input: z.output<typeof ruleSetVersionSchema>) {
  authorize(ctx, "payroll.config", "all");
  let parameters: unknown;
  try {
    parameters = JSON.parse(input.parametersJson);
  } catch {
    throw new AppError("VALIDATION", "Parameters must be valid JSON.", { fieldErrors: { parametersJson: ["Not valid JSON"] } });
  }
  const v = validateRuleParameters(input.kind, parameters);
  if (!v.ok) throw new AppError("VALIDATION", "Some parameters are invalid.", { fieldErrors: { parametersJson: v.issues } });
  return ctx.db(async (tx) => {
    if (input.baseId) {
      const [base] = await tx.select({ id: statutoryRuleSets.id }).from(statutoryRuleSets).where(eq(statutoryRuleSets.id, input.baseId));
      if (!base) throw notFound("Rule set");
    }
    // Serialize version numbering for this key.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ruleset:${ctx.tenantId}:${input.kind}:${input.jurisdiction}:${input.effectiveFrom}`}))`);
    const [{ max }] = await tx
      .select({ max: sql<number>`coalesce(max(${statutoryRuleSets.version}), 0)`.mapWith(Number) })
      .from(statutoryRuleSets)
      .where(and(eq(statutoryRuleSets.kind, input.kind), eq(statutoryRuleSets.jurisdiction, input.jurisdiction), eq(statutoryRuleSets.effectiveFrom, input.effectiveFrom)));
    const [row] = await tx
      .insert(statutoryRuleSets)
      .values({
        tenantId: ctx.tenantId,
        kind: input.kind,
        jurisdiction: input.jurisdiction,
        name: input.name,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        version: max + 1,
        parameters: parameters as Record<string, unknown>,
        sourceReference: input.sourceReference,
        notes: input.notes,
        createdBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, {
      action: "payroll.rule_set_versioned",
      entityType: "statutory_rule_set",
      entityId: row.id,
      metadata: { kind: row.kind, jurisdiction: row.jurisdiction, effectiveFrom: row.effectiveFrom, version: row.version, basedOn: input.baseId ?? null },
    });
    return row;
  });
}

export async function markRuleSetVerified(ctx: RequestContext, input: z.output<typeof markVerifiedSchema>) {
  authorize(ctx, "payroll.config", "all");
  return ctx.db(async (tx) => {
    const [row] = await tx.select().from(statutoryRuleSets).where(eq(statutoryRuleSets.id, input.id)).for("update");
    if (!row) throw notFound("Rule set");
    if (row.verifiedAt) throw invalidState("This rule set version is already verified.");
    const v = validateRuleParameters(row.kind, row.parameters);
    if (!v.ok) throw invalidState(`These parameters are invalid and cannot be verified: ${v.issues.join("; ")}`);
    const now = new Date();
    await tx.update(statutoryRuleSets).set({ verifiedBy: ctx.userId, verifiedAt: now }).where(eq(statutoryRuleSets.id, row.id));
    await audit(tx, ctx, {
      action: "payroll.rule_set_verified",
      entityType: "statutory_rule_set",
      entityId: row.id,
      metadata: { kind: row.kind, jurisdiction: row.jurisdiction, version: row.version, attested: true },
    });
    return { verifiedAt: now.toISOString() };
  });
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

export type ResolvedRule<K extends RuleKind = RuleKind> = {
  row: RuleSetRow;
  params: RuleParamsByKind[K] | null;
  error: string | null;
};

/**
 * Picks, per (kind, jurisdiction), the rule set effective on `date`
 * (effectiveFrom ≤ date < effectiveTo), latest effective date first, then the
 * highest version.
 */
export async function resolveRuleSets(tx: Tx, date: string, keys: { kind: RuleKind; jurisdiction: string }[]) {
  const out = new Map<string, ResolvedRule>();
  if (!keys.length) return out;
  const kinds = [...new Set(keys.map((k) => k.kind))];
  const jurisdictions = [...new Set(keys.map((k) => k.jurisdiction))];
  const rows = await tx
    .select()
    .from(statutoryRuleSets)
    .where(
      and(
        inArray(statutoryRuleSets.kind, kinds),
        inArray(statutoryRuleSets.jurisdiction, jurisdictions),
        lte(statutoryRuleSets.effectiveFrom, date),
        or(isNull(statutoryRuleSets.effectiveTo), gt(statutoryRuleSets.effectiveTo, date)),
      ),
    )
    .orderBy(desc(statutoryRuleSets.effectiveFrom), desc(statutoryRuleSets.version));
  for (const k of keys) {
    const key = `${k.kind}|${k.jurisdiction}`;
    if (out.has(key)) continue;
    const row = rows.find((r) => r.kind === k.kind && r.jurisdiction === k.jurisdiction);
    if (!row) continue;
    try {
      out.set(key, { row, params: parseRuleParameters(k.kind, row.parameters), error: null });
    } catch (err) {
      out.set(key, { row, params: null, error: err instanceof Error ? err.message : "Invalid parameters" });
    }
  }
  return out;
}

/** Unverified rule sets effective today or later (for warning banners). */
export async function unverifiedRuleSetCount(ctx: RequestContext) {
  authorizePayrollRead(ctx);
  return ctx.db(async (tx) => {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(statutoryRuleSets)
      .where(isNull(statutoryRuleSets.verifiedAt));
    return n;
  });
}
