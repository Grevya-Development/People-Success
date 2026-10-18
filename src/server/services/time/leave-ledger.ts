import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Tx } from "../../db/client";
import { authorize, authorizeEmployee, can, type RequestContext } from "../../auth/context";
import { departments, employees, leaveBalances, leaveTransactions, leaveTypes } from "../../db/schema";
import { audit } from "../../lib/audit";
import { forbidden, invalidState, notFound, validation } from "../../lib/errors";
import type { leaveAdjustSchema } from "@/lib/validation/time";
import { todayIn } from "@/lib/format";
import { addDaysIso } from "@/lib/leave-math";
import { employeeBasics } from "./shared";
import { loadLeaveSetup, pickLeavePolicy, rulesFor, tracksBalance } from "./leave-types";

export type LeaveTxnKind = (typeof leaveTransactions.$inferInsert)["kind"];

export type Posting = {
  employeeId: string;
  leaveTypeId: string;
  kind: LeaveTxnKind;
  days: number;
  effectiveOn: string;
  expiresOn?: string | null;
  sourceKey: string;
  leaveRequestId?: string | null;
  note?: string | null;
  createdBy?: string | null;
};

/** Make sure the materialized balance row exists, then lock it for this transaction. */
export async function lockBalance(tx: Tx, tenantId: string, employeeId: string, leaveTypeId: string) {
  await tx.insert(leaveBalances).values({ tenantId, employeeId, leaveTypeId }).onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(leaveBalances)
    .where(and(eq(leaveBalances.tenantId, tenantId), eq(leaveBalances.employeeId, employeeId), eq(leaveBalances.leaveTypeId, leaveTypeId)))
    .for("update");
  return row;
}

/**
 * Append one ledger row and update the materialized balance in the same
 * transaction. Idempotent: a repeated sourceKey for the same employee and
 * type inserts nothing and returns null. The ledger is append-only (a DB
 * trigger forbids update/delete); corrections are reversal postings.
 */
export async function postLeaveTxn(tx: Tx, tenantId: string, p: Posting) {
  if (p.days === 0) return null;
  const [row] = await tx
    .insert(leaveTransactions)
    .values({
      tenantId,
      employeeId: p.employeeId,
      leaveTypeId: p.leaveTypeId,
      kind: p.kind,
      days: p.days,
      effectiveOn: p.effectiveOn,
      expiresOn: p.expiresOn ?? null,
      sourceKey: p.sourceKey,
      leaveRequestId: p.leaveRequestId ?? null,
      note: p.note ?? null,
      createdBy: p.createdBy ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return null;
  await tx
    .insert(leaveBalances)
    .values({ tenantId, employeeId: p.employeeId, leaveTypeId: p.leaveTypeId, balance: p.days })
    .onConflictDoUpdate({
      target: [leaveBalances.employeeId, leaveBalances.leaveTypeId],
      set: { balance: sql`${leaveBalances.balance} + ${p.days}`, updatedAt: new Date() },
    });
  return row;
}

/** Add `delta` to the pending (requested, not yet approved) days. Never below zero. */
export async function adjustPending(tx: Tx, tenantId: string, employeeId: string, leaveTypeId: string, delta: number) {
  if (delta === 0) return;
  await tx
    .insert(leaveBalances)
    .values({ tenantId, employeeId, leaveTypeId, pending: Math.max(0, delta) })
    .onConflictDoUpdate({
      target: [leaveBalances.employeeId, leaveBalances.leaveTypeId],
      set: { pending: sql`greatest(0, ${leaveBalances.pending} + ${delta})`, updatedAt: new Date() },
    });
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export type BalanceCard = {
  leaveTypeId: string;
  code: string;
  name: string;
  category: string;
  color: string;
  isPaid: boolean;
  tracksBalance: boolean;
  allowHalfDay: boolean;
  balance: number;
  pending: number;
  available: number;
  policy: { name: string; version: number; accrual: string; daysPerYear: number } | null;
};

/** Balance per active leave type for an employee (leave.view, record-level). */
export async function balancesFor(ctx: RequestContext, employeeId: string): Promise<BalanceCard[]> {
  await authorizeEmployee(ctx, "leave.view", employeeId);
  return ctx.db(async (tx) => {
    const emp = await employeeBasics(tx, ctx.tenantId, employeeId);
    const { types, policies } = await loadLeaveSetup(tx, ctx.tenantId);
    const balances = await tx.select().from(leaveBalances).where(and(eq(leaveBalances.tenantId, ctx.tenantId), eq(leaveBalances.employeeId, employeeId)));
    const today = todayIn();
    return types
      .filter((t) => t.isActive)
      .map((t) => {
        const b = balances.find((x) => x.leaveTypeId === t.id);
        const p = pickLeavePolicy(policies, emp, t.id, today);
        const rules = rulesFor(p);
        const balance = b?.balance ?? 0;
        const pending = b?.pending ?? 0;
        return {
          leaveTypeId: t.id,
          code: t.code,
          name: t.name,
          category: t.category,
          color: t.color,
          isPaid: t.isPaid,
          tracksBalance: tracksBalance(t),
          allowHalfDay: t.allowHalfDay,
          balance,
          pending,
          available: Math.round((balance - pending) * 100) / 100,
          policy: p ? { name: p.name, version: p.version, accrual: rules.accrual.method, daysPerYear: rules.accrual.daysPerYear } : null,
        };
      });
  });
}

export async function ledgerFor(ctx: RequestContext, employeeId: string, leaveTypeId?: string) {
  await authorizeEmployee(ctx, "leave.view", employeeId);
  return ctx.db((tx) =>
    tx
      .select({ t: leaveTransactions, typeName: leaveTypes.name, typeCode: leaveTypes.code })
      .from(leaveTransactions)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveTransactions.leaveTypeId))
      .where(
        and(
          eq(leaveTransactions.tenantId, ctx.tenantId),
          eq(leaveTransactions.employeeId, employeeId),
          leaveTypeId ? eq(leaveTransactions.leaveTypeId, leaveTypeId) : undefined,
        ),
      )
      .orderBy(desc(leaveTransactions.effectiveOn), desc(leaveTransactions.createdAt))
      .limit(500)
      .then((rows) => rows.map((r) => ({ ...r.t, typeName: r.typeName, typeCode: r.typeCode }))),
  );
}

/** Balance matrix for HR (leave.view:all or leave.manage). */
export async function balancesTable(ctx: RequestContext, opts: { q?: string; page?: number } = {}) {
  if (!can(ctx, "leave.view", "all") && !can(ctx, "leave.manage", "all")) throw forbidden();
  const pageSize = 50;
  const page = opts.page ?? 1;
  return ctx.db(async (tx) => {
    const types = await tx
      .select()
      .from(leaveTypes)
      .where(and(eq(leaveTypes.tenantId, ctx.tenantId), eq(leaveTypes.isActive, true), eq(leaveTypes.isPaid, true)))
      .orderBy(asc(leaveTypes.sortOrder), asc(leaveTypes.name));
    const q = opts.q?.trim();
    const where = and(
      eq(employees.tenantId, ctx.tenantId),
      isNull(employees.deletedAt),
      inArray(employees.status, ["active", "on_notice"]),
      q ? or(ilike(employees.displayName, `%${q}%`), ilike(employees.employeeCode, `%${q}%`)) : undefined,
    );
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(employees).where(where);
    const emps = await tx
      .select({ id: employees.id, name: employees.displayName, code: employees.employeeCode, department: departments.name })
      .from(employees)
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(where)
      .orderBy(asc(employees.displayName))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const balances = emps.length
      ? await tx.select().from(leaveBalances).where(and(eq(leaveBalances.tenantId, ctx.tenantId), inArray(leaveBalances.employeeId, emps.map((e) => e.id))))
      : [];
    return {
      types: types.map((t) => ({ id: t.id, code: t.code, name: t.name, color: t.color })),
      rows: emps.map((e) => ({
        ...e,
        balances: Object.fromEntries(
          types.map((t) => {
            const b = balances.find((x) => x.employeeId === e.id && x.leaveTypeId === t.id);
            return [t.id, { balance: b?.balance ?? 0, pending: b?.pending ?? 0 }];
          }),
        ) as Record<string, { balance: number; pending: number }>,
      })),
      page,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      total,
    };
  });
}

/* ------------------------------------------------------------------ */
/* HR adjustments                                                      */
/* ------------------------------------------------------------------ */

/**
 * Grant (e.g. comp off, maternity) or adjust a balance with a reason.
 * Each call is a new ledger row; nothing is ever edited.
 */
export async function adjustLeaveBalance(ctx: RequestContext, input: z.output<typeof leaveAdjustSchema>) {
  authorize(ctx, "leave.manage", "all");
  if (input.kind === "grant" && input.days <= 0) throw validation("A grant adds days. Use an adjustment to reduce a balance.", { days: ["Must be positive"] });
  if (input.expiresOn && input.expiresOn <= input.effectiveOn) throw validation("Expiry must be after the effective date.", { expiresOn: ["Too early"] });
  return ctx.db(async (tx) => {
    const emp = await employeeBasics(tx, ctx.tenantId, input.employeeId);
    const [type] = await tx.select().from(leaveTypes).where(and(eq(leaveTypes.tenantId, ctx.tenantId), eq(leaveTypes.id, input.leaveTypeId)));
    if (!type) throw notFound("Leave type");
    if (!tracksBalance(type)) throw invalidState(`${type.name} is unpaid and has no balance to adjust.`);
    const bal = await lockBalance(tx, ctx.tenantId, emp.id, type.id);
    const floor = type.allowNegative ? -type.maxNegativeDays : 0;
    if (input.days < 0 && bal.balance + input.days < floor) {
      throw validation(`This would take the balance below zero (current ${bal.balance}).`, { days: ["Exceeds the balance"] });
    }
    const expiresOn = input.expiresOn ?? (type.category === "comp_off" && input.kind === "grant" ? addDaysIso(input.effectiveOn, 90) : null);
    const row = await postLeaveTxn(tx, ctx.tenantId, {
      employeeId: emp.id,
      leaveTypeId: type.id,
      kind: input.kind,
      days: input.days,
      effectiveOn: input.effectiveOn,
      expiresOn,
      sourceKey: `${input.kind}:${randomUUID()}`,
      note: input.reason,
      createdBy: ctx.userId,
    });
    await audit(tx, ctx, {
      action: input.kind === "grant" ? "leave.granted" : "leave.adjusted",
      entityType: "employee",
      entityId: emp.id,
      metadata: { leaveType: type.code, days: input.days, effectiveOn: input.effectiveOn, expiresOn, reason: input.reason, txnId: row?.id },
    });
    return { id: row?.id ?? null, expiresOn };
  });
}

/** Name and code for ledger headers (leave.view, record-level). */
export async function leaveEmployeeHeader(ctx: RequestContext, employeeId: string) {
  await authorizeEmployee(ctx, "leave.view", employeeId);
  return ctx.db(async (tx) => {
    const e = await employeeBasics(tx, ctx.tenantId, employeeId);
    return { id: e.id, name: e.displayName, code: e.employeeCode };
  });
}
