import { and, asc, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Tx } from "../../db/client";
import { authorize, type RequestContext } from "../../auth/context";
import { attendancePolicies, employees, shiftAssignments, shifts, type AttendanceRules } from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { invalidState, notFound, validation } from "../../lib/errors";
import type { shiftAssignmentSchema, shiftSchema } from "@/lib/validation/time";
import { advisoryLock, systemActor } from "./shared";

export type Shift = typeof shifts.$inferSelect;
export type AttendancePolicy = typeof attendancePolicies.$inferSelect;

/**
 * Attendance rules as stored. `defaultShiftId` extends the schema's rule
 * type: the shift used for employees covered by the policy who have no shift
 * assignment. The tenant default shift is the one on the broadest
 * (unconditioned, lowest priority) policy.
 */
export type AttendanceRulesExt = AttendanceRules & { defaultShiftId?: string | null };

export const rulesOf = (p: Pick<AttendancePolicy, "rules">) => p.rules as AttendanceRulesExt;

export const DEFAULT_ATTENDANCE_RULES: AttendanceRules = {
  allowWebCheckIn: true,
  requireGeofence: false,
  lateMarksPerHalfDay: null,
  overtimeEnabled: false,
  overtimeMinMinutes: 30,
  regularizationWindowDays: 7,
  maxRegularizationsPerMonth: 3,
  autoMarkAbsentWithoutPunch: true,
};

export const DEFAULT_SHIFT = {
  name: "General shift",
  code: "GEN",
  startTime: "09:30",
  endTime: "18:30",
  breakMinutes: 60,
  graceInMinutes: 15,
  graceOutMinutes: 15,
  halfDayMinutes: 240,
  fullDayMinutes: 480,
  weeklyOffs: [0, 6],
};

/**
 * Seed the general shift and the standard attendance policy the first time a
 * tenant uses attendance. Idempotent and safe under concurrency.
 */
export async function ensureTimeDefaults(tx: Tx, tenantId: string, actorUserId: string | null = null) {
  const actor = actorUserId ? { tenantId, userId: actorUserId } : systemActor(tenantId);
  const [anyPolicy] = await tx.select({ id: attendancePolicies.id }).from(attendancePolicies).where(eq(attendancePolicies.tenantId, tenantId)).limit(1);
  const [anyShift] = await tx.select({ id: shifts.id }).from(shifts).where(eq(shifts.tenantId, tenantId)).limit(1);
  if (anyPolicy && anyShift) return;
  await advisoryLock(tx, `time-defaults:${tenantId}`);
  let [shift] = await tx.select().from(shifts).where(eq(shifts.tenantId, tenantId)).orderBy(asc(shifts.createdAt)).limit(1);
  if (!shift) {
    [shift] = await tx
      .insert(shifts)
      .values({ tenantId, ...DEFAULT_SHIFT })
      .onConflictDoNothing()
      .returning();
    if (shift) await audit(tx, actor, { action: "shift.seeded", entityType: "shift", entityId: shift.id, metadata: { code: shift.code } });
    else [shift] = await tx.select().from(shifts).where(and(eq(shifts.tenantId, tenantId), eq(shifts.code, DEFAULT_SHIFT.code)));
  }
  const [policy] = await tx.select({ id: attendancePolicies.id }).from(attendancePolicies).where(eq(attendancePolicies.tenantId, tenantId)).limit(1);
  if (!policy) {
    const rules: AttendanceRulesExt = { ...DEFAULT_ATTENDANCE_RULES, defaultShiftId: shift?.id ?? null };
    const [row] = await tx
      .insert(attendancePolicies)
      .values({ tenantId, name: "Standard attendance", conditions: {}, rules, priority: 0 })
      .returning();
    await audit(tx, actor, { action: "attendance_policy.seeded", entityType: "attendance_policy", entityId: row.id });
  }
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

export type ShiftResolver = {
  shiftOn: (date: string) => Shift;
};

/**
 * Shift for each date of an employee: the effective assignment, else the
 * attendance policy's default shift, else the tenant's first active shift.
 */
export async function shiftResolver(tx: Tx, tenantId: string, employeeId: string, from: string, to: string, policyDefaultShiftId: string | null): Promise<ShiftResolver> {
  const all = await tx.select().from(shifts).where(eq(shifts.tenantId, tenantId)).orderBy(asc(shifts.createdAt));
  const assignments = await tx
    .select()
    .from(shiftAssignments)
    .where(
      and(
        eq(shiftAssignments.tenantId, tenantId),
        eq(shiftAssignments.employeeId, employeeId),
        lte(shiftAssignments.effectiveFrom, to),
        or(isNull(shiftAssignments.effectiveTo), gt(shiftAssignments.effectiveTo, from)),
      ),
    );
  const byId = new Map(all.map((s) => [s.id, s]));
  const fallback =
    (policyDefaultShiftId ? byId.get(policyDefaultShiftId) : undefined) ?? all.find((s) => s.isActive) ?? all[0] ?? builtinShift(tenantId);
  return {
    shiftOn: (date) => {
      const a = assignments.find((x) => x.effectiveFrom <= date && (!x.effectiveTo || x.effectiveTo > date));
      return (a && byId.get(a.shiftId)) || fallback;
    },
  };
}

/** In-memory general shift used only if a tenant has no shifts at all (e.g. a read before seeding). */
function builtinShift(tenantId: string): Shift {
  const now = new Date(0);
  return {
    id: "00000000-0000-0000-0000-000000000000",
    tenantId,
    ...DEFAULT_SHIFT,
    startTime: `${DEFAULT_SHIFT.startTime}:00`,
    endTime: `${DEFAULT_SHIFT.endTime}:00`,
    isFlexible: false,
    isNight: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

/* ------------------------------------------------------------------ */
/* Shifts CRUD                                                         */
/* ------------------------------------------------------------------ */

export async function listShifts(ctx: RequestContext) {
  return ctx.db(async (tx) => {
    await ensureTimeDefaults(tx, ctx.tenantId, ctx.userId);
    const rows = await tx.select().from(shifts).where(eq(shifts.tenantId, ctx.tenantId)).orderBy(desc(shifts.isActive), asc(shifts.name));
    const counts = await tx.execute<{ shift_id: string; n: number }>(sql`
      select shift_id, count(*)::int as n from shift_assignments
      where tenant_id = ${ctx.tenantId} and effective_from <= current_date and (effective_to is null or effective_to > current_date)
      group by shift_id`);
    const [base] = await tx
      .select()
      .from(attendancePolicies)
      .where(and(eq(attendancePolicies.tenantId, ctx.tenantId), eq(attendancePolicies.isActive, true)))
      .orderBy(asc(attendancePolicies.priority), asc(attendancePolicies.createdAt))
      .limit(1);
    const defaultShiftId = base ? (rulesOf(base).defaultShiftId ?? null) : null;
    return rows.map((s) => ({
      ...s,
      isDefault: s.id === defaultShiftId,
      assignedCount: counts.find((c) => c.shift_id === s.id)?.n ?? 0,
    }));
  });
}

const toTime = (t: string) => (t.length === 5 ? `${t}:00` : t);

export async function saveShift(ctx: RequestContext, input: z.output<typeof shiftSchema>) {
  authorize(ctx, "attendance.manage", "all");
  return ctx.db(async (tx) => {
    const values = {
      name: input.name,
      code: input.code,
      startTime: toTime(input.startTime),
      endTime: toTime(input.endTime),
      breakMinutes: input.breakMinutes,
      graceInMinutes: input.graceInMinutes,
      graceOutMinutes: input.graceOutMinutes,
      halfDayMinutes: input.halfDayMinutes,
      fullDayMinutes: input.fullDayMinutes,
      weeklyOffs: [...new Set(input.weeklyOffs)].sort(),
      isFlexible: input.isFlexible,
      isNight: input.isNight,
      isActive: input.isActive,
    };
    if (input.id) {
      const [before] = await tx.select().from(shifts).where(and(eq(shifts.tenantId, ctx.tenantId), eq(shifts.id, input.id))).for("update");
      if (!before) throw notFound("Shift");
      const [row] = await tx.update(shifts).set(values).where(eq(shifts.id, before.id)).returning();
      await audit(tx, ctx, { action: "shift.updated", entityType: "shift", entityId: row.id, changes: diff(before, row) });
      return row;
    }
    const [row] = await tx.insert(shifts).values({ tenantId: ctx.tenantId, ...values }).returning();
    await audit(tx, ctx, { action: "shift.created", entityType: "shift", entityId: row.id, metadata: { code: row.code } });
    return row;
  });
}

/** Make a shift the tenant default (stored on the broadest attendance policy). */
export async function setDefaultShift(ctx: RequestContext, shiftId: string) {
  authorize(ctx, "attendance.manage", "all");
  return ctx.db(async (tx) => {
    await ensureTimeDefaults(tx, ctx.tenantId, ctx.userId);
    const [shift] = await tx.select().from(shifts).where(and(eq(shifts.tenantId, ctx.tenantId), eq(shifts.id, shiftId)));
    if (!shift) throw notFound("Shift");
    if (!shift.isActive) throw invalidState("Activate the shift before making it the default.");
    const [base] = await tx
      .select()
      .from(attendancePolicies)
      .where(and(eq(attendancePolicies.tenantId, ctx.tenantId), eq(attendancePolicies.isActive, true)))
      .orderBy(asc(attendancePolicies.priority), asc(attendancePolicies.createdAt))
      .limit(1)
      .for("update");
    if (!base) throw invalidState("Create an active attendance policy first.");
    const before = rulesOf(base).defaultShiftId ?? null;
    await tx
      .update(attendancePolicies)
      .set({ rules: { ...rulesOf(base), defaultShiftId: shift.id } as AttendanceRulesExt, version: base.version + 1 })
      .where(eq(attendancePolicies.id, base.id));
    await audit(tx, ctx, { action: "shift.default_set", entityType: "shift", entityId: shift.id, changes: { defaultShiftId: { from: before, to: shift.id } } });
    return null;
  });
}

/* ------------------------------------------------------------------ */
/* Assignments (effective-dated, non-overlapping by constraint)        */
/* ------------------------------------------------------------------ */

export async function listShiftAssignments(ctx: RequestContext, opts: { current?: boolean } = {}) {
  authorize(ctx, "attendance.manage", "all");
  return ctx.db((tx) =>
    tx
      .select({
        id: shiftAssignments.id,
        employeeId: shiftAssignments.employeeId,
        employeeName: employees.displayName,
        employeeCode: employees.employeeCode,
        shiftId: shiftAssignments.shiftId,
        shiftName: shifts.name,
        shiftCode: shifts.code,
        effectiveFrom: shiftAssignments.effectiveFrom,
        effectiveTo: shiftAssignments.effectiveTo,
      })
      .from(shiftAssignments)
      .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
      .innerJoin(employees, eq(employees.id, shiftAssignments.employeeId))
      .where(
        and(
          eq(shiftAssignments.tenantId, ctx.tenantId),
          opts.current ? sql`(${shiftAssignments.effectiveTo} is null or ${shiftAssignments.effectiveTo} > current_date)` : undefined,
        ),
      )
      .orderBy(asc(employees.displayName), desc(shiftAssignments.effectiveFrom))
      .limit(500),
  );
}

/**
 * Assign a shift from a date. An open-ended assignment that started earlier
 * is closed the day the new one starts; anything else that overlaps is
 * rejected by the exclusion constraint.
 */
export async function assignShift(ctx: RequestContext, input: z.output<typeof shiftAssignmentSchema>) {
  authorize(ctx, "attendance.manage", "all");
  return ctx.db(async (tx) => {
    const [shift] = await tx.select().from(shifts).where(and(eq(shifts.tenantId, ctx.tenantId), eq(shifts.id, input.shiftId)));
    if (!shift) throw notFound("Shift");
    if (!shift.isActive) throw invalidState("This shift is inactive.");
    const [emp] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.tenantId, ctx.tenantId), eq(employees.id, input.employeeId), isNull(employees.deletedAt)));
    if (!emp) throw notFound("Employee");
    const [open] = await tx
      .select()
      .from(shiftAssignments)
      .where(and(eq(shiftAssignments.tenantId, ctx.tenantId), eq(shiftAssignments.employeeId, emp.id), isNull(shiftAssignments.effectiveTo)))
      .for("update");
    if (open) {
      if (open.effectiveFrom >= input.effectiveFrom) {
        throw validation("The current assignment starts on or after this date. Edit or remove it first.", { effectiveFrom: ["Must be after the current assignment's start"] });
      }
      await tx.update(shiftAssignments).set({ effectiveTo: input.effectiveFrom }).where(eq(shiftAssignments.id, open.id));
    }
    const [row] = await tx
      .insert(shiftAssignments)
      .values({ tenantId: ctx.tenantId, employeeId: emp.id, shiftId: shift.id, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo })
      .returning();
    await audit(tx, ctx, {
      action: "shift.assigned",
      entityType: "employee",
      entityId: emp.id,
      metadata: { shift: shift.code, from: row.effectiveFrom, to: row.effectiveTo, closedPrevious: open?.id ?? null },
    });
    return row;
  });
}

export async function removeShiftAssignment(ctx: RequestContext, id: string) {
  authorize(ctx, "attendance.manage", "all");
  return ctx.db(async (tx) => {
    const [row] = await tx.select().from(shiftAssignments).where(and(eq(shiftAssignments.tenantId, ctx.tenantId), eq(shiftAssignments.id, id)));
    if (!row) throw notFound("Shift assignment");
    await tx.delete(shiftAssignments).where(eq(shiftAssignments.id, id));
    await audit(tx, ctx, { action: "shift.unassigned", entityType: "employee", entityId: row.employeeId, metadata: { shiftId: row.shiftId, from: row.effectiveFrom, to: row.effectiveTo } });
    return { outcome: "deleted" as const };
  });
}
