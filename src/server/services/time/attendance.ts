import { and, asc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { authorize, authorizeEmployee, can, getTeamEmployeeIds, scopeOf, type RequestContext } from "../../auth/context";
import { attendanceDays, attendanceEvents, departments, employees, leaveRequests, leaveTypes, locations } from "../../db/schema";
import type { Geofence } from "../../db/schema/people";
import { audit } from "../../lib/audit";
import { AppError, forbidden, invalidState, validation } from "../../lib/errors";
import { todayIn } from "@/lib/format";
import { toCsv } from "@/lib/csv";
import { addDaysIso, countLeaveDays, eachDate, monthEnd, monthStart, type Session } from "@/lib/leave-math";
import { MAX_RECOMPUTE_DAYS, type DeviceEventInput } from "@/lib/validation/time";
import { withSystem } from "../../db/tx";
import { attendanceWindow, computeDayOutcome, shiftBounds, type DayOutcome, type LeavePortion } from "./attendance-math";
import { resolveAttendancePolicy } from "./attendance-policies";
import { publicHolidaysFor } from "./holidays";
import { loadLeaveSetup, pickLeavePolicy, rulesFor } from "./leave-types";
import { emitDomainEvent } from "../events";
import { ensureTimeDefaults, shiftResolver, type Shift } from "./shifts";
import { employeeBasics, employeesActiveBetween, enqueueTenantJob, istDate, istTime, type EmployeeBasics } from "./shared";

export type AttendanceDay = typeof attendanceDays.$inferSelect;

/* ------------------------------------------------------------------ */
/* Leave portions per date                                             */
/* ------------------------------------------------------------------ */

/**
 * Approved leave of an employee, expanded to the fraction counted on each
 * date (weekly offs and holidays inside a leave count only under the
 * sandwich rule of the policy that applied to the request).
 */
async function approvedLeavePortions(tx: Tx, emp: EmployeeBasics, from: string, to: string, shiftOn: (d: string) => Shift) {
  const rows = await tx
    .select({ r: leaveRequests, isPaid: leaveTypes.isPaid })
    .from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(
      and(
        eq(leaveRequests.tenantId, emp.tenantId),
        eq(leaveRequests.employeeId, emp.id),
        eq(leaveRequests.status, "approved"),
        lte(leaveRequests.startDate, to),
        gte(leaveRequests.endDate, from),
      ),
    );
  const map = new Map<string, LeavePortion[]>();
  if (!rows.length) return map;
  const { policies } = await loadLeaveSetup(tx, emp.tenantId);
  for (const { r, isPaid } of rows) {
    const rules = rulesFor(pickLeavePolicy(policies, emp, r.leaveTypeId, r.startDate));
    const hol = await publicHolidaysFor(tx, emp.tenantId, emp.locationId, r.startDate, r.endDate);
    const { breakdown } = countLeaveDays({
      startDate: r.startDate,
      endDate: r.endDate,
      startSession: r.startSession as Session,
      endSession: r.endSession as Session,
      weeklyOffs: shiftOn(r.startDate).weeklyOffs,
      holidays: [...hol],
      sandwich: rules.sandwich,
    });
    for (const d of breakdown) {
      if (d.days <= 0 || d.date < from || d.date > to) continue;
      const list = map.get(d.date) ?? [];
      list.push({ requestId: r.id, fraction: d.days, isPaid });
      map.set(d.date, list);
    }
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Daily computation                                                   */
/* ------------------------------------------------------------------ */

export type ComputeResult = { computed: number; removed: number; locked: number; exceptions: { date: string; status: string }[] };

/**
 * Recompute attendance_days for an employee over [from, to] (inclusive).
 * Days locked by a payroll run are never changed. Days that have nothing to
 * record yet (future working days, today before the first punch) are
 * removed so a cancelled leave does not leave a stale row behind.
 */
export async function computeAttendanceRange(tx: Tx, tenantId: string, employeeId: string, from: string, to: string, opts: { today?: string } = {}): Promise<ComputeResult> {
  const today = opts.today ?? todayIn();
  const result: ComputeResult = { computed: 0, removed: 0, locked: 0, exceptions: [] };
  let emp: EmployeeBasics;
  try {
    emp = await employeeBasics(tx, tenantId, employeeId);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") return result;
    throw err;
  }
  const { rules } = await resolveAttendancePolicy(tx, tenantId, emp);
  const resolver = await shiftResolver(tx, tenantId, emp.id, from, to, rules.defaultShiftId ?? null);
  const holidaysSet = await publicHolidaysFor(tx, tenantId, emp.locationId, from, to);
  const leaveMap = await approvedLeavePortions(tx, emp, from, to, resolver.shiftOn);

  const windowFrom = attendanceWindow(from, resolver.shiftOn(from)).from;
  const windowTo = attendanceWindow(to, resolver.shiftOn(to)).to;
  const events = await tx
    .select({ occurredAt: attendanceEvents.occurredAt, kind: attendanceEvents.kind, verification: attendanceEvents.verification })
    .from(attendanceEvents)
    .where(
      and(
        eq(attendanceEvents.tenantId, tenantId),
        eq(attendanceEvents.employeeId, emp.id),
        gte(attendanceEvents.occurredAt, windowFrom),
        lt(attendanceEvents.occurredAt, windowTo),
      ),
    )
    .orderBy(asc(attendanceEvents.occurredAt));
  const existing = await tx
    .select()
    .from(attendanceDays)
    .where(and(eq(attendanceDays.tenantId, tenantId), eq(attendanceDays.employeeId, emp.id), gte(attendanceDays.date, from), lte(attendanceDays.date, to)));
  const existingByDate = new Map(existing.map((d) => [d.date, d]));

  // Late marks earlier in the first month, for "every N late marks deduct half a day".
  let lateMarks = 0;
  if (rules.lateMarksPerHalfDay) {
    const [row] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from attendance_days
      where tenant_id = ${tenantId} and employee_id = ${emp.id} and date >= ${monthStart(from)} and date < ${from}
        and late_minutes > 0 and status in ('present','half_day')`);
    lateMarks = row?.n ?? 0;
  }

  for (const date of eachDate(from, to)) {
    if (date.endsWith("-01") && date !== from) lateMarks = 0;
    const prev = existingByDate.get(date);
    if (prev?.lockedByRunId) {
      result.locked++;
      if (prev.lateMinutes > 0 && (prev.status === "present" || prev.status === "half_day")) lateMarks++;
      continue;
    }
    const shift = resolver.shiftOn(date);
    const win = attendanceWindow(date, shift);
    const punches = events.filter((e) => e.occurredAt >= win.from && e.occurredAt < win.to);
    const outcome = computeDayOutcome({
      date,
      today,
      joiningDate: emp.joiningDate,
      lastDate: emp.lastDate,
      shift,
      isHoliday: holidaysSet.has(date),
      leaves: leaveMap.get(date) ?? [],
      punches,
      rules,
      lateMarksBefore: lateMarks,
    });
    if (!outcome) {
      if (prev) {
        await tx.delete(attendanceDays).where(and(eq(attendanceDays.id, prev.id), isNull(attendanceDays.lockedByRunId)));
        result.removed++;
      }
      continue;
    }
    if (outcome.lateMinutes > 0 && (outcome.status === "present" || outcome.status === "half_day")) lateMarks++;
    await upsertDay(tx, tenantId, emp.id, date, shift.id, outcome);
    result.computed++;
    if (outcome.status === "missing_punch" && date < today) result.exceptions.push({ date, status: outcome.status });
  }
  return result;
}

const BUILTIN_SHIFT_ID = "00000000-0000-0000-0000-000000000000";

async function upsertDay(tx: Tx, tenantId: string, employeeId: string, date: string, shiftId: string, o: DayOutcome) {
  const values = {
    shiftId: shiftId === BUILTIN_SHIFT_ID ? null : shiftId,
    firstIn: o.firstIn,
    lastOut: o.lastOut,
    workedMinutes: o.workedMinutes,
    lateMinutes: o.lateMinutes,
    earlyLeaveMinutes: o.earlyLeaveMinutes,
    overtimeMinutes: o.overtimeMinutes,
    status: o.status,
    payableFraction: o.payableFraction,
    leaveRequestId: o.leaveRequestId,
    isRegularized: o.isRegularized,
    computedAt: new Date(),
  };
  await tx
    .insert(attendanceDays)
    .values({ tenantId, employeeId, date, ...values })
    .onConflictDoUpdate({
      target: [attendanceDays.employeeId, attendanceDays.date],
      set: values,
      setWhere: sql`${attendanceDays.lockedByRunId} is null`,
    });
}

export async function computeAttendanceDay(tx: Tx, tenantId: string, employeeId: string, date: string, opts: { today?: string } = {}) {
  return computeAttendanceRange(tx, tenantId, employeeId, date, date, opts);
}

/* ------------------------------------------------------------------ */
/* Punches                                                             */
/* ------------------------------------------------------------------ */

/** Great-circle distance in metres. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Browser punches are self-reported. They are location-verified only when the
 * employee's location has a geofence and the browser reported coordinates
 * inside it with usable accuracy. Device verification is never claimed here.
 */
export function browserVerification(fence: Geofence | null | undefined, coords: { latitude?: number | null; longitude?: number | null; accuracyMeters?: number | null }) {
  if (!fence || coords.latitude == null || coords.longitude == null) return { verification: "self_reported" as const, distance: null as number | null };
  const distance = distanceMeters({ lat: fence.lat, lng: fence.lng }, { lat: coords.latitude, lng: coords.longitude });
  const accurate = coords.accuracyMeters == null || coords.accuracyMeters <= Math.max(fence.radiusMeters, 100);
  return { verification: distance <= fence.radiusMeters && accurate ? ("location_verified" as const) : ("self_reported" as const), distance };
}

export type PunchInput = {
  kind: "in" | "out";
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  note?: string | null;
};

/** Web check-in / check-out for the signed-in employee. */
export async function punch(ctx: RequestContext, input: PunchInput, meta: { ip?: string | null; now?: Date } = {}) {
  if (!ctx.employeeId) throw forbidden("Your login is not linked to an employee record.");
  const employeeId = ctx.employeeId;
  const now = meta.now ?? new Date();
  return ctx.db(async (tx) => {
    await ensureTimeDefaults(tx, ctx.tenantId, ctx.userId);
    const emp = await employeeBasics(tx, ctx.tenantId, employeeId);
    if (emp.status !== "active" && emp.status !== "on_notice") throw invalidState("Only active employees can check in.");
    const { rules } = await resolveAttendancePolicy(tx, ctx.tenantId, emp);
    if (!rules.allowWebCheckIn) throw forbidden("Web check-in is turned off by your attendance policy. Use the attendance device or ask HR.");
    let fence: Geofence | null = null;
    let locationName: string | null = null;
    if (emp.locationId) {
      const [loc] = await tx.select({ geofence: locations.geofence, name: locations.name }).from(locations).where(and(eq(locations.tenantId, ctx.tenantId), eq(locations.id, emp.locationId)));
      fence = loc?.geofence ?? null;
      locationName = loc?.name ?? null;
    }
    const { verification, distance } = browserVerification(fence, input);
    if (rules.requireGeofence) {
      if (!fence) throw invalidState("Your attendance policy requires a geofence, but your location has none configured. Ask HR.");
      if (input.latitude == null) throw validation("Allow location access in your browser to check in.");
      if (verification !== "location_verified") {
        throw validation(`You appear to be ${Math.round(distance ?? 0)} m from ${locationName ?? "your office"}. Check in within ${fence.radiusMeters} m.`);
      }
    }
    // Ignore accidental double clicks.
    const [last] = await tx
      .select({ kind: attendanceEvents.kind, occurredAt: attendanceEvents.occurredAt })
      .from(attendanceEvents)
      .where(and(eq(attendanceEvents.tenantId, ctx.tenantId), eq(attendanceEvents.employeeId, employeeId)))
      .orderBy(sql`${attendanceEvents.occurredAt} desc`)
      .limit(1);
    if (last && last.kind === input.kind && now.getTime() - last.occurredAt.getTime() < 60_000) {
      throw invalidState(`Already checked ${input.kind} a moment ago.`);
    }
    const [event] = await tx
      .insert(attendanceEvents)
      .values({
        tenantId: ctx.tenantId,
        employeeId,
        occurredAt: now,
        kind: input.kind,
        source: "web",
        verification,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        accuracyMeters: input.accuracyMeters ?? null,
        ip: meta.ip ?? null,
        note: input.note ?? null,
        createdBy: ctx.userId,
      })
      .returning();
    const date = istDate(now);
    // A punch shortly after midnight can belong to the previous day's (night) shift.
    await computeAttendanceRange(tx, ctx.tenantId, employeeId, addDaysIso(date, -1), date);
    await audit(tx, ctx, {
      action: input.kind === "in" ? "attendance.checked_in" : "attendance.checked_out",
      entityType: "attendance_event",
      entityId: event.id,
      metadata: { verification, source: "web" },
      ip: meta.ip ?? null,
    });
    return { id: event.id, kind: event.kind, occurredAt: event.occurredAt.toISOString(), verification };
  });
}

/* ------------------------------------------------------------------ */
/* Device / biometric ingestion                                        */
/* ------------------------------------------------------------------ */

export type IngestResult = { received: number; inserted: number; duplicates: number; unknownEmployees: string[]; recomputedDays: number };

/**
 * Ingest punches from an attendance device or export. Idempotent on
 * (tenant, source, externalId): re-sending the same events inserts nothing.
 * Events are marked `device_verified` because they come from the device, not
 * a browser. Affected days are recomputed in the same transaction.
 */
export async function ingestDeviceEventsTx(tx: Tx, tenantId: string, events: DeviceEventInput[], actor: { userId: string | null }): Promise<IngestResult> {
  const result: IngestResult = { received: events.length, inserted: 0, duplicates: 0, unknownEmployees: [], recomputedDays: 0 };
  if (!events.length) return result;
  const codes = [...new Set(events.map((e) => e.employeeCode))];
  const emps = await tx
    .select({ id: employees.id, code: employees.employeeCode })
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), inArray(employees.employeeCode, codes), isNull(employees.deletedAt)));
  const byCode = new Map(emps.map((e) => [e.code, e.id]));
  result.unknownEmployees = codes.filter((c) => !byCode.has(c));
  const touched = new Map<string, Set<string>>();
  for (const e of events) {
    const employeeId = byCode.get(e.employeeCode);
    if (!employeeId) continue;
    const occurredAt = new Date(e.occurredAt);
    const inserted = await tx
      .insert(attendanceEvents)
      .values({
        tenantId,
        employeeId,
        occurredAt,
        kind: e.kind,
        source: e.source,
        verification: "device_verified",
        deviceId: e.deviceId ?? null,
        externalId: e.externalId,
        createdBy: actor.userId,
      })
      .onConflictDoNothing()
      .returning({ id: attendanceEvents.id });
    if (!inserted.length) {
      result.duplicates++;
      continue;
    }
    result.inserted++;
    const set = touched.get(employeeId) ?? new Set<string>();
    const d = istDate(occurredAt);
    set.add(d);
    set.add(addDaysIso(d, -1));
    touched.set(employeeId, set);
  }
  for (const [employeeId, dates] of touched) {
    const sorted = [...dates].sort();
    const r = await computeAttendanceRange(tx, tenantId, employeeId, sorted[0], sorted[sorted.length - 1]);
    result.recomputedDays += r.computed;
  }
  await audit(tx, { tenantId, userId: actor.userId, actorType: actor.userId ? "user" : "integration" }, {
    action: "attendance.device_events_ingested",
    entityType: "attendance_event",
    metadata: { received: result.received, inserted: result.inserted, duplicates: result.duplicates, unknown: result.unknownEmployees.length },
  });
  return result;
}

/** Adapter entry point for device integrations (system context, explicit tenant). */
export async function ingestDeviceEvents(tenantId: string, events: DeviceEventInput[]) {
  return withSystem((tx) => ingestDeviceEventsTx(tx, tenantId, events, { userId: null }), tenantId);
}

/** HR upload of a device export (CSV: employee_code, occurred_at ISO-8601, kind in|out, external_id, device_id). */
export async function importDeviceEvents(ctx: RequestContext, events: DeviceEventInput[]) {
  authorize(ctx, "attendance.manage", "all");
  return ctx.db((tx) => ingestDeviceEventsTx(tx, ctx.tenantId, events, { userId: ctx.userId }));
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export type TodayCard = {
  date: string;
  employeeId: string;
  shift: { name: string; start: string; end: string; isFlexible: boolean } | null;
  events: { kind: "in" | "out"; at: string; time: string; verification: string; source: string }[];
  day: { status: string; workedMinutes: number; lateMinutes: number; payableFraction: number } | null;
  nextKind: "in" | "out";
  allowWebCheckIn: boolean;
  requireGeofence: boolean;
  geofence: { locationName: string; radiusMeters: number } | null;
  regularizationWindowDays: number;
  maxRegularizationsPerMonth: number | null;
};

export async function todayCard(ctx: RequestContext, now = new Date()): Promise<TodayCard | null> {
  if (!ctx.employeeId) return null;
  const employeeId = ctx.employeeId;
  return ctx.db(async (tx) => {
    const emp = await employeeBasics(tx, ctx.tenantId, employeeId);
    const date = istDate(now);
    const { rules } = await resolveAttendancePolicy(tx, ctx.tenantId, emp);
    const resolver = await shiftResolver(tx, ctx.tenantId, emp.id, date, date, rules.defaultShiftId ?? null);
    const shift = resolver.shiftOn(date);
    const win = attendanceWindow(date, shift);
    const events = await tx
      .select()
      .from(attendanceEvents)
      .where(and(eq(attendanceEvents.tenantId, ctx.tenantId), eq(attendanceEvents.employeeId, emp.id), gte(attendanceEvents.occurredAt, win.from), lt(attendanceEvents.occurredAt, win.to)))
      .orderBy(asc(attendanceEvents.occurredAt));
    const [day] = await tx.select().from(attendanceDays).where(and(eq(attendanceDays.tenantId, ctx.tenantId), eq(attendanceDays.employeeId, emp.id), eq(attendanceDays.date, date)));
    let geofence: TodayCard["geofence"] = null;
    if (emp.locationId) {
      const [loc] = await tx.select({ name: locations.name, geofence: locations.geofence }).from(locations).where(and(eq(locations.tenantId, ctx.tenantId), eq(locations.id, emp.locationId)));
      if (loc?.geofence) geofence = { locationName: loc.name, radiusMeters: loc.geofence.radiusMeters };
    }
    const b = shiftBounds(date, shift);
    return {
      date,
      employeeId: emp.id,
      shift: { name: shift.name, start: istTime(b.start), end: istTime(b.end), isFlexible: shift.isFlexible },
      events: events.map((e) => ({ kind: e.kind, at: e.occurredAt.toISOString(), time: istTime(e.occurredAt), verification: e.verification, source: e.source })),
      day: day ? { status: day.status, workedMinutes: day.workedMinutes, lateMinutes: day.lateMinutes, payableFraction: day.payableFraction } : null,
      nextKind: events.length && events[events.length - 1].kind === "in" ? "out" : "in",
      allowWebCheckIn: rules.allowWebCheckIn,
      requireGeofence: rules.requireGeofence,
      geofence,
      regularizationWindowDays: rules.regularizationWindowDays,
      maxRegularizationsPerMonth: rules.maxRegularizationsPerMonth,
    };
  });
}

export type AttendanceSummary = {
  from: string;
  to: string;
  totalDays: number;
  present: number;
  halfDays: number;
  absent: number;
  onLeave: number;
  holidays: number;
  weeklyOffs: number;
  missingPunch: number;
  notJoined: number;
  lateMarks: number;
  lateMinutes: number;
  overtimeMinutes: number;
  workedMinutes: number;
  payableDays: number;
  /** Σ(1 − payableFraction) over employed days that have been computed. */
  lopDays: number;
  /** Past days with no computed row yet (nightly processing pending). */
  pendingDays: number;
};

export function summarize(days: Pick<AttendanceDay, "date" | "status" | "payableFraction" | "lateMinutes" | "overtimeMinutes" | "workedMinutes">[], from: string, to: string, today: string): AttendanceSummary {
  const s: AttendanceSummary = {
    from,
    to,
    totalDays: eachDate(from, to).length,
    present: 0,
    halfDays: 0,
    absent: 0,
    onLeave: 0,
    holidays: 0,
    weeklyOffs: 0,
    missingPunch: 0,
    notJoined: 0,
    lateMarks: 0,
    lateMinutes: 0,
    overtimeMinutes: 0,
    workedMinutes: 0,
    payableDays: 0,
    lopDays: 0,
    pendingDays: 0,
  };
  const seen = new Set<string>();
  for (const d of days) {
    seen.add(d.date);
    if (d.status === "present") s.present++;
    else if (d.status === "half_day") s.halfDays++;
    else if (d.status === "absent") s.absent++;
    else if (d.status === "on_leave") s.onLeave++;
    else if (d.status === "holiday") s.holidays++;
    else if (d.status === "weekly_off") s.weeklyOffs++;
    else if (d.status === "missing_punch") s.missingPunch++;
    else if (d.status === "not_joined") s.notJoined++;
    if (d.lateMinutes > 0 && (d.status === "present" || d.status === "half_day")) s.lateMarks++;
    s.lateMinutes += d.lateMinutes;
    s.overtimeMinutes += d.overtimeMinutes;
    s.workedMinutes += d.workedMinutes;
    s.payableDays += d.payableFraction;
    if (d.status !== "not_joined") s.lopDays += 1 - d.payableFraction;
  }
  const lastPast = to < today ? to : addDaysIso(today, -1);
  if (lastPast >= from) s.pendingDays = eachDate(from, lastPast).filter((d) => !seen.has(d)).length;
  s.payableDays = Math.round(s.payableDays * 100) / 100;
  s.lopDays = Math.round(s.lopDays * 100) / 100;
  return s;
}

/** Monthly (or any range) attendance summary for one employee. */
export async function attendanceSummary(ctx: RequestContext, employeeId: string, from: string, to: string): Promise<AttendanceSummary> {
  await authorizeEmployee(ctx, "attendance.view", employeeId);
  const days = await ctx.db((tx) =>
    tx
      .select()
      .from(attendanceDays)
      .where(and(eq(attendanceDays.tenantId, ctx.tenantId), eq(attendanceDays.employeeId, employeeId), gte(attendanceDays.date, from), lte(attendanceDays.date, to))),
  );
  return summarize(days, from, to, todayIn());
}

/** Calendar month for one employee: computed days, holidays and leave requests. */
export async function attendanceMonth(ctx: RequestContext, employeeId: string, month: string) {
  await authorizeEmployee(ctx, "attendance.view", employeeId);
  const from = `${month}-01`;
  const to = monthEnd(from);
  const today = todayIn();
  return ctx.db(async (tx) => {
    const emp = await employeeBasics(tx, ctx.tenantId, employeeId);
    const days = await tx
      .select()
      .from(attendanceDays)
      .where(and(eq(attendanceDays.tenantId, ctx.tenantId), eq(attendanceDays.employeeId, employeeId), gte(attendanceDays.date, from), lte(attendanceDays.date, to)))
      .orderBy(asc(attendanceDays.date));
    const { rules } = await resolveAttendancePolicy(tx, ctx.tenantId, emp);
    const resolver = await shiftResolver(tx, ctx.tenantId, emp.id, from, to, rules.defaultShiftId ?? null);
    const hol = await publicHolidaysFor(tx, ctx.tenantId, emp.locationId, from, to);
    const pendingLeave = await tx
      .select({ startDate: leaveRequests.startDate, endDate: leaveRequests.endDate })
      .from(leaveRequests)
      .where(and(eq(leaveRequests.tenantId, ctx.tenantId), eq(leaveRequests.employeeId, employeeId), eq(leaveRequests.status, "pending"), lte(leaveRequests.startDate, to), gte(leaveRequests.endDate, from)));
    return {
      employee: { id: emp.id, name: emp.displayName, joiningDate: emp.joiningDate },
      month,
      today,
      days: days.map((d) => ({
        date: d.date,
        status: d.status,
        payableFraction: d.payableFraction,
        firstIn: d.firstIn ? istTime(d.firstIn) : null,
        lastOut: d.lastOut ? istTime(d.lastOut) : null,
        workedMinutes: d.workedMinutes,
        lateMinutes: d.lateMinutes,
        overtimeMinutes: d.overtimeMinutes,
        isRegularized: d.isRegularized,
        locked: !!d.lockedByRunId,
      })),
      weeklyOffDates: eachDate(from, to).filter((d) => resolver.shiftOn(d).weeklyOffs.includes(new Date(`${d}T00:00:00Z`).getUTCDay())),
      holidayDates: [...hol],
      pendingLeaveDates: pendingLeave.flatMap((p) => eachDate(p.startDate > from ? p.startDate : from, p.endDate < to ? p.endDate : to)),
      summary: summarize(days, from, to, today),
    };
  });
}

/** Employees the user may see under attendance.view at team or all scope (excluding self for team). */
async function scopedEmployeeIds(ctx: RequestContext): Promise<string[] | "all"> {
  const scope = scopeOf(ctx, "attendance.view");
  if (scope === "all") return "all";
  if (scope === "team") return getTeamEmployeeIds(ctx);
  throw forbidden();
}

/** Today's status for the user's team (or everyone with all scope), plus recent exceptions. */
export async function teamToday(ctx: RequestContext) {
  const ids = await scopedEmployeeIds(ctx);
  const today = todayIn();
  return ctx.db(async (tx) => {
    const emps = await employeesActiveBetween(tx, ctx.tenantId, today, today, ids === "all" ? undefined : ids);
    const empIds = emps.map((e) => e.id);
    if (!empIds.length) return { today, rows: [], exceptions: [] };
    const days = await tx
      .select()
      .from(attendanceDays)
      .where(and(eq(attendanceDays.tenantId, ctx.tenantId), inArray(attendanceDays.employeeId, empIds), eq(attendanceDays.date, today)));
    const leaves = await tx
      .select({ employeeId: leaveRequests.employeeId, typeName: leaveTypes.name, status: leaveRequests.status })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(
        and(
          eq(leaveRequests.tenantId, ctx.tenantId),
          inArray(leaveRequests.employeeId, empIds),
          inArray(leaveRequests.status, ["approved", "pending"]),
          lte(leaveRequests.startDate, today),
          gte(leaveRequests.endDate, today),
        ),
      );
    const weekAgo = addDaysIso(today, -7);
    const exceptions = await tx
      .select({ d: attendanceDays, name: employees.displayName, code: employees.employeeCode })
      .from(attendanceDays)
      .innerJoin(employees, eq(employees.id, attendanceDays.employeeId))
      .where(
        and(
          eq(attendanceDays.tenantId, ctx.tenantId),
          inArray(attendanceDays.employeeId, empIds),
          gte(attendanceDays.date, weekAgo),
          lt(attendanceDays.date, today),
          sql`(${attendanceDays.status} in ('missing_punch','absent') or ${attendanceDays.lateMinutes} > 0)`,
        ),
      )
      .orderBy(sql`${attendanceDays.date} desc`)
      .limit(200);
    return {
      today,
      rows: emps
        .map((e) => {
          const d = days.find((x) => x.employeeId === e.id);
          const l = leaves.find((x) => x.employeeId === e.id);
          return {
            employeeId: e.id,
            name: e.displayName,
            code: e.employeeCode,
            status: d?.status ?? (l?.status === "approved" ? "on_leave" : null),
            firstIn: d?.firstIn ? istTime(d.firstIn) : null,
            lastOut: d?.lastOut ? istTime(d.lastOut) : null,
            lateMinutes: d?.lateMinutes ?? 0,
            leave: l ? { type: l.typeName, status: l.status } : null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      exceptions: exceptions.map((x) => ({
        employeeId: x.d.employeeId,
        name: x.name,
        code: x.code,
        date: x.d.date,
        status: x.d.status,
        lateMinutes: x.d.lateMinutes,
        firstIn: x.d.firstIn ? istTime(x.d.firstIn) : null,
        lastOut: x.d.lastOut ? istTime(x.d.lastOut) : null,
      })),
    };
  });
}

/** Organization-wide view for a date (attendance.view:all): status counts and exceptions. */
export async function attendanceForDate(ctx: RequestContext, date: string) {
  authorize(ctx, "attendance.view", "all");
  return ctx.db(async (tx) => {
    const active = await employeesActiveBetween(tx, ctx.tenantId, date, date);
    const rows = await tx
      .select({ d: attendanceDays, name: employees.displayName, code: employees.employeeCode, department: departments.name })
      .from(attendanceDays)
      .innerJoin(employees, eq(employees.id, attendanceDays.employeeId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(and(eq(attendanceDays.tenantId, ctx.tenantId), eq(attendanceDays.date, date)))
      .orderBy(asc(employees.displayName));
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.d.status] = (counts[r.d.status] ?? 0) + 1;
    return {
      date,
      activeEmployees: active.length,
      notComputed: Math.max(0, active.length - rows.filter((r) => r.d.status !== "not_joined").length),
      counts,
      exceptions: rows
        .filter((r) => r.d.status === "missing_punch" || r.d.status === "absent" || r.d.status === "half_day" || r.d.lateMinutes > 0)
        .map((r) => ({
          employeeId: r.d.employeeId,
          name: r.name,
          code: r.code,
          department: r.department,
          status: r.d.status,
          firstIn: r.d.firstIn ? istTime(r.d.firstIn) : null,
          lastOut: r.d.lastOut ? istTime(r.d.lastOut) : null,
          workedMinutes: r.d.workedMinutes,
          lateMinutes: r.d.lateMinutes,
          isRegularized: r.d.isRegularized,
        })),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Recompute and payroll-ready data                                    */
/* ------------------------------------------------------------------ */

const INLINE_RECOMPUTE_EMPLOYEES = 100;

/** HR "Recompute period": inline for small sets, queued in chunks otherwise. */
export async function recomputePeriod(ctx: RequestContext, input: { from: string; to: string; employeeId: string | null }) {
  authorize(ctx, "attendance.manage", "all");
  if (eachDate(input.from, input.to).length > MAX_RECOMPUTE_DAYS) throw validation(`Recompute at most ${MAX_RECOMPUTE_DAYS} days at a time.`);
  return ctx.db(async (tx) => {
    await ensureTimeDefaults(tx, ctx.tenantId, ctx.userId);
    const emps = await employeesActiveBetween(tx, ctx.tenantId, input.from, input.to, input.employeeId ? [input.employeeId] : undefined);
    let computed = 0;
    let queued = 0;
    if (emps.length <= INLINE_RECOMPUTE_EMPLOYEES) {
      for (const e of emps) computed += (await computeAttendanceRange(tx, ctx.tenantId, e.id, input.from, input.to)).computed;
    } else {
      for (let i = 0; i < emps.length; i += 50) {
        const chunk = emps.slice(i, i + 50).map((e) => e.id);
        await enqueueTenantJob(tx, ctx.tenantId, "time.attendance_recompute", { from: input.from, to: input.to, employeeIds: chunk });
        queued += chunk.length;
      }
    }
    await audit(tx, ctx, { action: "attendance.recomputed", entityType: "attendance_day", metadata: { ...input, employees: emps.length, computed, queued } });
    return { employees: emps.length, computed, queued };
  });
}

/** Compute any past days in [from, to] that have no row yet (e.g. before the nightly job ran). */
export async function ensureAttendanceComputed(tx: Tx, tenantId: string, from: string, to: string, employeeIds?: string[]) {
  const today = todayIn();
  const lastPast = to < today ? to : addDaysIso(today, -1);
  if (lastPast < from) return 0;
  const emps = await employeesActiveBetween(tx, tenantId, from, lastPast, employeeIds);
  if (!emps.length) return 0;
  const counts = await tx
    .select({ employeeId: attendanceDays.employeeId, n: sql<number>`count(*)::int` })
    .from(attendanceDays)
    .where(and(eq(attendanceDays.tenantId, tenantId), inArray(attendanceDays.employeeId, emps.map((e) => e.id)), gte(attendanceDays.date, from), lte(attendanceDays.date, lastPast)))
    .groupBy(attendanceDays.employeeId);
  const expected = eachDate(from, lastPast).length;
  let n = 0;
  for (const e of emps) {
    if ((counts.find((c) => c.employeeId === e.id)?.n ?? 0) >= expected) continue;
    await computeAttendanceRange(tx, tenantId, e.id, from, lastPast, { today });
    n++;
  }
  return n;
}

export type PayrollAttendanceRow = { employeeId: string; employeeCode: string; name: string; department: string | null } & AttendanceSummary;

/**
 * Payroll-ready per-employee summary for a period. Payroll's contract is the
 * per-day attendance_days.payableFraction; this aggregates it (LOP days =
 * Σ(1 − payableFraction) over employed days).
 */
export async function payrollAttendance(tx: Tx, tenantId: string, from: string, to: string): Promise<PayrollAttendanceRow[]> {
  await ensureAttendanceComputed(tx, tenantId, from, to);
  const emps = await employeesActiveBetween(tx, tenantId, from, to);
  if (!emps.length) return [];
  const ids = emps.map((e) => e.id);
  const [days, depts] = await Promise.all([
    tx.select().from(attendanceDays).where(and(eq(attendanceDays.tenantId, tenantId), inArray(attendanceDays.employeeId, ids), gte(attendanceDays.date, from), lte(attendanceDays.date, to))),
    tx.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.tenantId, tenantId)),
  ]);
  const today = todayIn();
  return emps
    .map((e) => ({
      employeeId: e.id,
      employeeCode: e.employeeCode,
      name: e.displayName,
      department: depts.find((d) => d.id === e.departmentId)?.name ?? null,
      ...summarize(days.filter((d) => d.employeeId === e.id), from, to, today),
    }))
    .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
}

/** CSV of the monthly summary (reports.export or attendance.manage). Audited. */
export async function exportMonthlySummaryCsv(ctx: RequestContext, month: string) {
  if (!can(ctx, "reports.export", "all") && !can(ctx, "attendance.manage", "all")) throw forbidden();
  const from = `${month}-01`;
  const to = monthEnd(from);
  return ctx.db(async (tx) => {
    const rows = await payrollAttendance(tx, ctx.tenantId, from, to);
    await audit(tx, ctx, { action: "attendance.exported", entityType: "attendance_day", metadata: { month, rows: rows.length } });
    const header = [
      "Employee code",
      "Name",
      "Department",
      "Days in period",
      "Present",
      "Half days",
      "Absent",
      "On leave",
      "Holidays",
      "Weekly offs",
      "Missing punch",
      "Not employed",
      "Late marks",
      "Overtime hours",
      "Payable days",
      "LOP days",
      "Days not yet processed",
    ];
    return toCsv([
      header,
      ...rows.map((r) => [
        r.employeeCode,
        r.name,
        r.department,
        r.totalDays,
        r.present,
        r.halfDays,
        r.absent,
        r.onLeave,
        r.holidays,
        r.weeklyOffs,
        r.missingPunch,
        r.notJoined,
        r.lateMarks,
        (r.overtimeMinutes / 60).toFixed(2),
        r.payableDays,
        r.lopDays,
        r.pendingDays,
      ]),
    ]);
  });
}

/* ------------------------------------------------------------------ */
/* Nightly processing (system context)                                 */
/* ------------------------------------------------------------------ */

/**
 * Compute `date` for every employee employed on it and raise one
 * attendance.exception event per missing punch (deduplicated per employee
 * and day).
 */
export async function processAttendanceDay(tx: Tx, tenantId: string, date: string) {
  await ensureTimeDefaults(tx, tenantId);
  const emps = await employeesActiveBetween(tx, tenantId, date, date);
  let exceptions = 0;
  for (const e of emps) {
    const r = await computeAttendanceRange(tx, tenantId, e.id, date, date);
    for (const x of r.exceptions) {
      exceptions++;
      await emitDomainEvent(tx, tenantId, "attendance.exception", { employeeId: e.id, date: x.date, kind: x.status }, { dedupeKey: `attendance.exception:${e.id}:${x.date}` });
    }
  }
  return { employees: emps.length, exceptions };
}
