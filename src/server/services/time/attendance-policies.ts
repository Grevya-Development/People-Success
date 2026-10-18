import { and, asc, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { Tx } from "../../db/client";
import { authorize, type RequestContext } from "../../auth/context";
import { attendancePolicies, shifts } from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { notFound } from "../../lib/errors";
import type { attendancePolicySchema } from "@/lib/validation/time";
import { compactConditions, matchesConditions, type EmployeeBasics } from "./shared";
import { DEFAULT_ATTENDANCE_RULES, ensureTimeDefaults, rulesOf, type AttendancePolicy, type AttendanceRulesExt } from "./shifts";

/** Highest-priority active policy whose conditions match the employee. */
export async function resolveAttendancePolicy(tx: Tx, tenantId: string, employee: EmployeeBasics): Promise<{ policy: AttendancePolicy | null; rules: AttendanceRulesExt }> {
  const rows = await tx
    .select()
    .from(attendancePolicies)
    .where(and(eq(attendancePolicies.tenantId, tenantId), eq(attendancePolicies.isActive, true)))
    .orderBy(desc(attendancePolicies.priority), asc(attendancePolicies.createdAt));
  const policy = rows.find((p) => matchesConditions(p.conditions, employee)) ?? null;
  return { policy, rules: policy ? { ...DEFAULT_ATTENDANCE_RULES, ...rulesOf(policy) } : { ...DEFAULT_ATTENDANCE_RULES } };
}

export async function listAttendancePolicies(ctx: RequestContext) {
  authorize(ctx, "attendance.manage", "all");
  return ctx.db(async (tx) => {
    await ensureTimeDefaults(tx, ctx.tenantId, ctx.userId);
    return tx
      .select()
      .from(attendancePolicies)
      .where(eq(attendancePolicies.tenantId, ctx.tenantId))
      .orderBy(desc(attendancePolicies.isActive), desc(attendancePolicies.priority), asc(attendancePolicies.createdAt));
  });
}

export async function saveAttendancePolicy(ctx: RequestContext, input: z.output<typeof attendancePolicySchema>) {
  authorize(ctx, "attendance.manage", "all");
  return ctx.db(async (tx) => {
    if (input.defaultShiftId) {
      const [s] = await tx.select({ id: shifts.id }).from(shifts).where(and(eq(shifts.tenantId, ctx.tenantId), eq(shifts.id, input.defaultShiftId)));
      if (!s) throw notFound("Shift");
    }
    const rules: AttendanceRulesExt = {
      allowWebCheckIn: input.allowWebCheckIn,
      requireGeofence: input.requireGeofence,
      lateMarksPerHalfDay: input.lateMarksPerHalfDay,
      overtimeEnabled: input.overtimeEnabled,
      overtimeMinMinutes: input.overtimeMinMinutes,
      regularizationWindowDays: input.regularizationWindowDays,
      maxRegularizationsPerMonth: input.maxRegularizationsPerMonth,
      autoMarkAbsentWithoutPunch: input.autoMarkAbsentWithoutPunch,
      defaultShiftId: input.defaultShiftId,
    };
    const conditions = compactConditions(input.conditions);
    if (input.id) {
      const [before] = await tx
        .select()
        .from(attendancePolicies)
        .where(and(eq(attendancePolicies.tenantId, ctx.tenantId), eq(attendancePolicies.id, input.id)))
        .for("update");
      if (!before) throw notFound("Attendance policy");
      const [row] = await tx
        .update(attendancePolicies)
        .set({ name: input.name, priority: input.priority, conditions, rules, isActive: input.isActive, version: before.version + 1 })
        .where(eq(attendancePolicies.id, before.id))
        .returning();
      await audit(tx, ctx, { action: "attendance_policy.updated", entityType: "attendance_policy", entityId: row.id, changes: diff(before, row) });
      return row;
    }
    const [row] = await tx
      .insert(attendancePolicies)
      .values({ tenantId: ctx.tenantId, name: input.name, priority: input.priority, conditions, rules, isActive: input.isActive })
      .returning();
    await audit(tx, ctx, { action: "attendance_policy.created", entityType: "attendance_policy", entityId: row.id, metadata: { name: row.name } });
    return row;
  });
}
