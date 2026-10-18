import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Tx } from "../../db/client";
import { authorize, type RequestContext } from "../../auth/context";
import { leavePolicies, leaveTypes, type LeavePolicyRules } from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { invalidState, notFound, validation } from "../../lib/errors";
import type { leavePolicySchema, leaveTypeSchema } from "@/lib/validation/time";
import { todayIn } from "@/lib/format";
import { advisoryLock, compactConditions, matchesConditions, type EmployeeBasics } from "./shared";

export type LeaveType = typeof leaveTypes.$inferSelect;
export type LeavePolicy = typeof leavePolicies.$inferSelect;

/**
 * Leave year: January to December (calendar year). Accruals, carry forward
 * and lapse are computed per calendar year regardless of the tenant's
 * financial year, which is how most Indian leave policies are written.
 */
export const leaveYearStart = (date: string) => `${date.slice(0, 4)}-01-01`;

/** Paid leave types are tracked in the ledger; unpaid (loss of pay) leave has no balance. */
export const tracksBalance = (t: Pick<LeaveType, "isPaid">) => t.isPaid;

export const BASE_RULES: LeavePolicyRules = {
  accrual: { method: "none", daysPerYear: 0, prorateOnJoining: true },
  waitingPeriodDays: 0,
  carryForward: { enabled: false, maxDays: 0, expiresAfterMonths: null },
  encashment: { enabled: false, maxDaysPerYear: 0 },
  maxBalance: null,
  minNoticeDays: 0,
  maxConsecutiveDays: null,
  sandwich: false,
  blackouts: [],
};

export const rulesFor = (p: Pick<LeavePolicy, "rules"> | null | undefined): LeavePolicyRules => ({ ...BASE_RULES, ...(p?.rules ?? {}) });

/** Highest-priority active policy version effective on `date` whose conditions match. */
export function pickLeavePolicy(policies: LeavePolicy[], employee: EmployeeBasics, leaveTypeId: string, date: string): LeavePolicy | null {
  return (
    policies
      .filter((p) => p.isActive && p.leaveTypeId === leaveTypeId && p.effectiveFrom <= date && matchesConditions(p.conditions, employee))
      .sort((a, b) => b.priority - a.priority || b.effectiveFrom.localeCompare(a.effectiveFrom) || b.version - a.version)[0] ?? null
  );
}

export async function loadLeaveSetup(tx: Tx, tenantId: string) {
  const [types, policies] = await Promise.all([
    tx.select().from(leaveTypes).where(eq(leaveTypes.tenantId, tenantId)).orderBy(asc(leaveTypes.sortOrder), asc(leaveTypes.name)),
    tx.select().from(leavePolicies).where(eq(leavePolicies.tenantId, tenantId)),
  ]);
  return { types, policies };
}

/* ------------------------------------------------------------------ */
/* Standard leave types (explicit action, idempotent)                  */
/* ------------------------------------------------------------------ */

type StandardType = {
  code: string;
  name: string;
  category: LeaveType["category"];
  isPaid: boolean;
  allowHalfDay: boolean;
  requiresDocumentAfterDays: number | null;
  color: string;
  rules: Partial<LeavePolicyRules>;
  note: string;
};

/**
 * Starting points only. The numbers are common defaults for Indian private
 * employers, to be reviewed by HR: they are not a statement of statutory
 * compliance (Shops & Establishments Acts and the Factories Act vary by
 * state and establishment type).
 */
export const STANDARD_LEAVE_TYPES: StandardType[] = [
  {
    code: "EL",
    name: "Earned leave",
    category: "earned",
    isPaid: true,
    allowHalfDay: true,
    requiresDocumentAfterDays: null,
    color: "info",
    rules: {
      accrual: { method: "monthly", daysPerYear: 18, prorateOnJoining: true },
      carryForward: { enabled: true, maxDays: 30, expiresAfterMonths: null },
      encashment: { enabled: true, maxDaysPerYear: 15 },
      maxBalance: 45,
      minNoticeDays: 7,
      sandwich: true,
    },
    note: "Also called privilege leave. 1.5 days a month, carry forward up to 30.",
  },
  {
    code: "CL",
    name: "Casual leave",
    category: "casual",
    isPaid: true,
    allowHalfDay: true,
    requiresDocumentAfterDays: null,
    color: "success",
    rules: { accrual: { method: "monthly", daysPerYear: 12, prorateOnJoining: true }, minNoticeDays: 1, maxConsecutiveDays: 3 },
    note: "1 day a month, lapses at year end, up to 3 days at a time.",
  },
  {
    code: "SL",
    name: "Sick leave",
    category: "sick",
    isPaid: true,
    allowHalfDay: true,
    requiresDocumentAfterDays: 2,
    color: "warning",
    rules: { accrual: { method: "annual_upfront", daysPerYear: 12, prorateOnJoining: true } },
    note: "12 days credited at the start of the year. A medical certificate is needed beyond 2 days.",
  },
  {
    code: "CO",
    name: "Comp off",
    category: "comp_off",
    isPaid: true,
    allowHalfDay: true,
    requiresDocumentAfterDays: null,
    color: "brand",
    rules: {},
    note: "Granted by HR for work on an off day; each grant expires on its own date.",
  },
  {
    code: "LOP",
    name: "Loss of pay",
    category: "unpaid",
    isPaid: false,
    allowHalfDay: true,
    requiresDocumentAfterDays: null,
    color: "danger",
    rules: {},
    note: "Unpaid leave. No balance; payroll deducts the days.",
  },
  {
    code: "ML",
    name: "Maternity leave",
    category: "maternity",
    isPaid: true,
    allowHalfDay: false,
    requiresDocumentAfterDays: 0,
    color: "brand",
    rules: { waitingPeriodDays: 80 },
    note: "Granted by HR when eligible (up to 26 weeks under the Maternity Benefit Act — review your eligibility rules).",
  },
  {
    code: "PTL",
    name: "Paternity leave",
    category: "paternity",
    isPaid: true,
    allowHalfDay: false,
    requiresDocumentAfterDays: null,
    color: "brand",
    rules: { accrual: { method: "annual_upfront", daysPerYear: 5, prorateOnJoining: false } },
    note: "5 days a year, no carry forward.",
  },
  {
    code: "BRV",
    name: "Bereavement leave",
    category: "bereavement",
    isPaid: true,
    allowHalfDay: false,
    requiresDocumentAfterDays: null,
    color: "neutral",
    rules: { accrual: { method: "annual_upfront", daysPerYear: 3, prorateOnJoining: false } },
    note: "3 days a year for the loss of a family member.",
  },
];

export async function addStandardLeaveTypes(ctx: RequestContext) {
  authorize(ctx, "leave.manage", "all");
  return ctx.db(async (tx) => {
    await advisoryLock(tx, `leave-standard:${ctx.tenantId}`);
    const existing = await tx.select({ code: leaveTypes.code }).from(leaveTypes).where(eq(leaveTypes.tenantId, ctx.tenantId));
    const have = new Set(existing.map((e) => e.code));
    const effectiveFrom = leaveYearStart(todayIn());
    const created: string[] = [];
    for (const [i, t] of STANDARD_LEAVE_TYPES.entries()) {
      if (have.has(t.code)) continue;
      const [type] = await tx
        .insert(leaveTypes)
        .values({
          tenantId: ctx.tenantId,
          code: t.code,
          name: t.name,
          category: t.category,
          isPaid: t.isPaid,
          allowHalfDay: t.allowHalfDay,
          requiresDocumentAfterDays: t.requiresDocumentAfterDays,
          color: t.color,
          sortOrder: (i + 1) * 10,
        })
        .onConflictDoNothing()
        .returning();
      if (!type) continue;
      await tx.insert(leavePolicies).values({
        tenantId: ctx.tenantId,
        leaveTypeId: type.id,
        name: `${t.name} — default (review)`,
        conditions: {},
        rules: { ...BASE_RULES, ...t.rules },
        effectiveFrom,
      });
      created.push(t.code);
    }
    await audit(tx, ctx, { action: "leave_type.standard_added", entityType: "leave_type", metadata: { created } });
    return { created: created.length, codes: created };
  });
}

/* ------------------------------------------------------------------ */
/* Leave types CRUD                                                    */
/* ------------------------------------------------------------------ */

export async function listLeaveTypes(ctx: RequestContext, opts: { includeInactive?: boolean } = {}) {
  return ctx.db((tx) =>
    tx
      .select()
      .from(leaveTypes)
      .where(and(eq(leaveTypes.tenantId, ctx.tenantId), opts.includeInactive ? undefined : eq(leaveTypes.isActive, true)))
      .orderBy(asc(leaveTypes.sortOrder), asc(leaveTypes.name)),
  );
}

export async function saveLeaveType(ctx: RequestContext, input: z.output<typeof leaveTypeSchema>) {
  authorize(ctx, "leave.manage", "all");
  return ctx.db(async (tx) => {
    const values = {
      code: input.code,
      name: input.name,
      category: input.category,
      isPaid: input.isPaid,
      allowHalfDay: input.allowHalfDay,
      allowNegative: input.allowNegative,
      maxNegativeDays: input.allowNegative ? input.maxNegativeDays : 0,
      requiresDocumentAfterDays: input.requiresDocumentAfterDays,
      color: input.color,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
    };
    if (input.id) {
      const [before] = await tx.select().from(leaveTypes).where(and(eq(leaveTypes.tenantId, ctx.tenantId), eq(leaveTypes.id, input.id))).for("update");
      if (!before) throw notFound("Leave type");
      if (before.isPaid !== input.isPaid) {
        const [{ n }] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from leave_requests where tenant_id = ${ctx.tenantId} and leave_type_id = ${before.id}`);
        if (n > 0) throw validation("Paid or unpaid cannot change once leave has been requested. Create a new type instead.", { isPaid: ["Locked after first use"] });
      }
      const [row] = await tx.update(leaveTypes).set(values).where(eq(leaveTypes.id, before.id)).returning();
      await audit(tx, ctx, { action: "leave_type.updated", entityType: "leave_type", entityId: row.id, changes: diff(before, row) });
      return row;
    }
    const [row] = await tx.insert(leaveTypes).values({ tenantId: ctx.tenantId, ...values }).returning();
    await audit(tx, ctx, { action: "leave_type.created", entityType: "leave_type", entityId: row.id, metadata: { code: row.code } });
    return row;
  });
}

/* ------------------------------------------------------------------ */
/* Policies (versioned)                                                */
/* ------------------------------------------------------------------ */

export function rulesFromInput(input: z.output<typeof leavePolicySchema>): LeavePolicyRules {
  return {
    accrual: { method: input.accrualMethod, daysPerYear: input.accrualMethod === "none" ? 0 : input.daysPerYear, prorateOnJoining: input.prorateOnJoining },
    waitingPeriodDays: input.waitingPeriodDays,
    carryForward: {
      enabled: input.carryForwardEnabled,
      maxDays: input.carryForwardEnabled ? input.carryForwardMaxDays : 0,
      expiresAfterMonths: input.carryForwardEnabled ? input.carryForwardExpiresAfterMonths : null,
    },
    encashment: { enabled: input.encashmentEnabled, maxDaysPerYear: input.encashmentEnabled ? input.encashmentMaxDaysPerYear : 0 },
    maxBalance: input.maxBalance,
    minNoticeDays: input.minNoticeDays,
    maxConsecutiveDays: input.maxConsecutiveDays,
    sandwich: input.sandwich,
    blackouts: input.blackouts,
  };
}

/** Latest version of every policy (one row per leave type + name). */
export async function listLeavePolicies(ctx: RequestContext) {
  authorize(ctx, "leave.manage", "all");
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ p: leavePolicies, typeName: leaveTypes.name, typeCode: leaveTypes.code, typeIsPaid: leaveTypes.isPaid, typeCategory: leaveTypes.category })
      .from(leavePolicies)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leavePolicies.leaveTypeId))
      .where(eq(leavePolicies.tenantId, ctx.tenantId))
      .orderBy(asc(leaveTypes.sortOrder), asc(leavePolicies.name), desc(leavePolicies.version));
    const latest = new Map<string, (typeof rows)[number] & { versions: number }>();
    for (const r of rows) {
      const key = `${r.p.leaveTypeId}:${r.p.name}`;
      const cur = latest.get(key);
      if (!cur) latest.set(key, { ...r, versions: 1 });
      else cur.versions++;
    }
    return [...latest.values()].map((r) => ({ ...r.p, typeName: r.typeName, typeCode: r.typeCode, typeIsPaid: r.typeIsPaid, typeCategory: r.typeCategory, versions: r.versions }));
  });
}

/**
 * Create a policy, or publish a new version of one. A new version keeps the
 * name and leave type, increments `version` and applies from its
 * `effectiveFrom` onwards; earlier dates keep resolving to the old version.
 */
export async function saveLeavePolicy(ctx: RequestContext, input: z.output<typeof leavePolicySchema>) {
  authorize(ctx, "leave.manage", "all");
  return ctx.db(async (tx) => {
    const [type] = await tx.select().from(leaveTypes).where(and(eq(leaveTypes.tenantId, ctx.tenantId), eq(leaveTypes.id, input.leaveTypeId)));
    if (!type) throw notFound("Leave type");
    const rules = rulesFromInput(input);
    const conditions = compactConditions(input.conditions);
    if (input.id) {
      const [prev] = await tx.select().from(leavePolicies).where(and(eq(leavePolicies.tenantId, ctx.tenantId), eq(leavePolicies.id, input.id)));
      if (!prev) throw notFound("Leave policy");
      if (prev.leaveTypeId !== input.leaveTypeId) throw invalidState("A policy cannot move to another leave type. Create a new policy instead.");
      await advisoryLock(tx, `leave-policy:${prev.leaveTypeId}:${prev.name}`);
      const family = await tx
        .select()
        .from(leavePolicies)
        .where(and(eq(leavePolicies.tenantId, ctx.tenantId), eq(leavePolicies.leaveTypeId, prev.leaveTypeId), eq(leavePolicies.name, prev.name)))
        .orderBy(desc(leavePolicies.version));
      const latest = family[0];
      if (input.effectiveFrom < latest.effectiveFrom) {
        throw validation(`New versions apply prospectively: choose ${latest.effectiveFrom} or later.`, { effectiveFrom: ["Before the current version"] });
      }
      const [row] = await tx
        .insert(leavePolicies)
        .values({
          tenantId: ctx.tenantId,
          leaveTypeId: prev.leaveTypeId,
          name: prev.name,
          conditions,
          rules,
          priority: input.priority,
          version: latest.version + 1,
          effectiveFrom: input.effectiveFrom,
          isActive: true,
        })
        .returning();
      await audit(tx, ctx, {
        action: "leave_policy.versioned",
        entityType: "leave_policy",
        entityId: row.id,
        changes: diff({ ...latest.rules, conditions: latest.conditions, priority: latest.priority } as Record<string, unknown>, { ...rules, conditions, priority: input.priority } as Record<string, unknown>),
        metadata: { version: row.version, effectiveFrom: row.effectiveFrom, previousId: latest.id },
      });
      return row;
    }
    const [dupe] = await tx
      .select({ id: leavePolicies.id })
      .from(leavePolicies)
      .where(and(eq(leavePolicies.tenantId, ctx.tenantId), eq(leavePolicies.leaveTypeId, type.id), eq(leavePolicies.name, input.name)))
      .limit(1);
    if (dupe) throw validation("A policy with this name already exists for the leave type.", { name: ["Already used"] });
    const [row] = await tx
      .insert(leavePolicies)
      .values({ tenantId: ctx.tenantId, leaveTypeId: type.id, name: input.name, conditions, rules, priority: input.priority, effectiveFrom: input.effectiveFrom })
      .returning();
    await audit(tx, ctx, { action: "leave_policy.created", entityType: "leave_policy", entityId: row.id, metadata: { name: row.name, type: type.code } });
    return row;
  });
}

/** Activate or deactivate every version of a policy. */
export async function setLeavePolicyActive(ctx: RequestContext, id: string, isActive: boolean) {
  authorize(ctx, "leave.manage", "all");
  return ctx.db(async (tx) => {
    const [p] = await tx.select().from(leavePolicies).where(and(eq(leavePolicies.tenantId, ctx.tenantId), eq(leavePolicies.id, id)));
    if (!p) throw notFound("Leave policy");
    const updated = await tx
      .update(leavePolicies)
      .set({ isActive })
      .where(and(eq(leavePolicies.tenantId, ctx.tenantId), eq(leavePolicies.leaveTypeId, p.leaveTypeId), eq(leavePolicies.name, p.name)))
      .returning({ id: leavePolicies.id });
    await audit(tx, ctx, { action: isActive ? "leave_policy.activated" : "leave_policy.deactivated", entityType: "leave_policy", entityId: id, metadata: { versions: updated.length } });
    return null;
  });
}

export async function policyVersions(ctx: RequestContext, id: string) {
  authorize(ctx, "leave.manage", "all");
  return ctx.db(async (tx) => {
    const [p] = await tx.select().from(leavePolicies).where(and(eq(leavePolicies.tenantId, ctx.tenantId), eq(leavePolicies.id, id)));
    if (!p) throw notFound("Leave policy");
    return tx
      .select()
      .from(leavePolicies)
      .where(and(eq(leavePolicies.tenantId, ctx.tenantId), eq(leavePolicies.leaveTypeId, p.leaveTypeId), eq(leavePolicies.name, p.name)))
      .orderBy(desc(leavePolicies.version));
  });
}

export async function typesByIds(tx: Tx, tenantId: string, ids: string[]) {
  if (!ids.length) return [];
  return tx.select().from(leaveTypes).where(and(eq(leaveTypes.tenantId, tenantId), inArray(leaveTypes.id, ids)));
}
