/**
 * Pure daily attendance computation (no I/O). The service loads punches,
 * shift, holidays and approved leave, then calls `computeDayOutcome` for each
 * date and upserts the result into attendance_days.
 *
 * Contract with payroll: `payableFraction` is 1, 0.5 or 0 and payroll treats
 * Σ(1 − payableFraction) over the pay period as loss-of-pay days.
 */
import type { AttendanceRules } from "../../db/schema/time";

export type DayStatus = "present" | "absent" | "half_day" | "on_leave" | "holiday" | "weekly_off" | "missing_punch" | "not_joined";

export type ShiftTimes = {
  startTime: string; // HH:mm[:ss]
  endTime: string;
  breakMinutes: number;
  graceInMinutes: number;
  graceOutMinutes: number;
  halfDayMinutes: number;
  fullDayMinutes: number;
  weeklyOffs: number[];
  isFlexible: boolean;
  isNight: boolean;
};

export type Punch = { occurredAt: Date; kind: "in" | "out"; verification: string };

/** Leave portion on a date: `fraction` of the day (0.5 or 1) and whether it is paid. */
export type LeavePortion = { requestId: string; fraction: number; isPaid: boolean };

export type DayInput = {
  date: string;
  today: string;
  joiningDate: string;
  lastDate: string | null;
  shift: ShiftTimes;
  isHoliday: boolean;
  /** Approved leave counted on this date (after weekly-off / holiday / sandwich treatment). */
  leaves: LeavePortion[];
  /** Punches inside this date's attendance window. */
  punches: Punch[];
  rules: Pick<AttendanceRules, "overtimeEnabled" | "overtimeMinMinutes" | "autoMarkAbsentWithoutPunch" | "lateMarksPerHalfDay">;
  /** Late marks already counted earlier in the same month (for late-mark deductions). */
  lateMarksBefore: number;
};

export type DayOutcome = {
  status: DayStatus;
  payableFraction: number;
  firstIn: Date | null;
  lastOut: Date | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  isRegularized: boolean;
  leaveRequestId: string | null;
  /** True when this day's late arrival triggered a half-day deduction. */
  lateDeduction: boolean;
};

const DAY_MS = 86_400_000;
const pad = (t: string) => (t.length === 5 ? `${t}:00` : t);
const at = (date: string, time: string) => new Date(`${date}T${pad(time)}+05:30`);

/** Shift start and end instants for a date (night shifts end the next day). */
export function shiftBounds(date: string, shift: Pick<ShiftTimes, "startTime" | "endTime" | "isNight">) {
  const start = at(date, shift.startTime);
  let end = at(date, shift.endTime);
  if (shift.isNight || end <= start) end = new Date(end.getTime() + DAY_MS);
  return { start, end };
}

/**
 * Punches belonging to a date: from 4 hours before the shift start, for 24
 * hours. Covers early arrivals and late check-outs, including night shifts.
 */
export function attendanceWindow(date: string, shift: Pick<ShiftTimes, "startTime" | "endTime" | "isNight">) {
  const { start } = shiftBounds(date, shift);
  const from = new Date(start.getTime() - 4 * 3_600_000);
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000);

/** First check-in and last check-out; approved corrections override raw punches of the same kind. */
export function pickInOut(punches: Punch[]) {
  const corrected = punches.filter((p) => p.verification === "approved_correction");
  const raw = punches.filter((p) => p.verification !== "approved_correction");
  const ins = (corrected.some((p) => p.kind === "in") ? corrected : raw).filter((p) => p.kind === "in").map((p) => p.occurredAt.getTime());
  const outs = (corrected.some((p) => p.kind === "out") ? corrected : raw).filter((p) => p.kind === "out").map((p) => p.occurredAt.getTime());
  const firstIn = ins.length ? new Date(Math.min(...ins)) : null;
  let lastOut = outs.length ? new Date(Math.max(...outs)) : null;
  if (firstIn && lastOut && lastOut <= firstIn) lastOut = null;
  return { firstIn, lastOut, isRegularized: corrected.length > 0 };
}

/**
 * Worked minutes from first in to last out. The break is deducted only when
 * the span is longer than a half day plus the break, so a short half day is
 * not penalised for a lunch break it did not take.
 */
export function workedMinutes(firstIn: Date, lastOut: Date, shift: Pick<ShiftTimes, "breakMinutes" | "halfDayMinutes">) {
  const span = Math.max(0, minutesBetween(firstIn, lastOut));
  return span > shift.halfDayMinutes + shift.breakMinutes ? span - shift.breakMinutes : span;
}

export function computeDayOutcome(input: DayInput): DayOutcome | null {
  const { date, shift } = input;
  const empty = {
    firstIn: null,
    lastOut: null,
    workedMinutes: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    isRegularized: false,
    leaveRequestId: null,
    lateDeduction: false,
  };
  if (date < input.joiningDate || (input.lastDate && date > input.lastDate)) {
    return { ...empty, status: "not_joined", payableFraction: 0 };
  }

  const { firstIn, lastOut, isRegularized } = pickInOut(input.punches);
  let worked = 0;
  let late = 0;
  let early = 0;
  let overtime = 0;
  if (firstIn && lastOut) {
    worked = workedMinutes(firstIn, lastOut, shift);
    if (!shift.isFlexible) {
      const { start, end } = shiftBounds(date, shift);
      const lateRaw = minutesBetween(start, firstIn);
      late = lateRaw > shift.graceInMinutes ? lateRaw : 0;
      const earlyRaw = minutesBetween(lastOut, end);
      early = earlyRaw > shift.graceOutMinutes ? earlyRaw : 0;
    }
    const extra = worked - shift.fullDayMinutes;
    if (input.rules.overtimeEnabled && extra >= input.rules.overtimeMinMinutes) overtime = extra;
  } else if (firstIn && !shift.isFlexible) {
    const lateRaw = minutesBetween(shiftBounds(date, shift).start, firstIn);
    late = lateRaw > shift.graceInMinutes ? lateRaw : 0;
  }
  const times = { firstIn, lastOut, workedMinutes: worked, lateMinutes: late, earlyLeaveMinutes: early, overtimeMinutes: overtime, isRegularized };

  const isFuture = date > input.today;
  const isToday = date === input.today;
  const hasPunches = !!(firstIn || lastOut);
  /** Presence on a working day: 1, 0.5 or 0 (null = not yet known). */
  const presence = (): number | null => {
    if (firstIn && lastOut) return worked >= shift.fullDayMinutes ? 1 : worked >= shift.halfDayMinutes ? 0.5 : 0;
    if (hasPunches) return 0;
    if (isFuture || isToday) return null;
    return input.rules.autoMarkAbsentWithoutPunch ? 0 : 1;
  };

  // Leave (already resolved for weekly offs, holidays and the sandwich rule).
  const leaveFraction = Math.min(1, input.leaves.reduce((s, l) => s + l.fraction, 0));
  if (leaveFraction > 0) {
    const leavePay = Math.min(leaveFraction, input.leaves.reduce((s, l) => s + (l.isPaid ? l.fraction : 0), 0));
    let payable = leavePay;
    if (leaveFraction < 1) {
      // Half-day leave: the other half is paid if the employee worked at least a half day.
      // Future dates are provisional (assumed worked) and are recomputed nightly.
      const p = presence();
      const otherHalf = p === null ? (isFuture ? 0.5 : 0) : p >= 0.5 ? 0.5 : 0;
      payable += otherHalf;
    }
    return { ...empty, ...times, status: "on_leave", payableFraction: payable, leaveRequestId: input.leaves[0].requestId };
  }

  const off = input.isHoliday ? "holiday" : shift.weeklyOffs.includes(new Date(`${date}T00:00:00Z`).getUTCDay()) ? "weekly_off" : null;
  if (off) return { ...empty, ...times, lateMinutes: 0, earlyLeaveMinutes: 0, status: off, payableFraction: 1 };

  if (!hasPunches) {
    if (isFuture || isToday) return null;
    return input.rules.autoMarkAbsentWithoutPunch
      ? { ...empty, status: "absent", payableFraction: 0 }
      : { ...empty, status: "present", payableFraction: 1 };
  }
  if (!firstIn || !lastOut) return { ...empty, ...times, status: "missing_punch", payableFraction: 0 };

  const p = presence() ?? 0;
  const status: DayStatus = p >= 1 ? "present" : p >= 0.5 ? "half_day" : "absent";
  let payable = p;
  let lateDeduction = false;
  const n = input.rules.lateMarksPerHalfDay;
  if (n && late > 0 && payable > 0 && (input.lateMarksBefore + 1) % n === 0) {
    payable = Math.max(0, payable - 0.5);
    lateDeduction = true;
  }
  return { ...empty, ...times, status, payableFraction: payable, lateDeduction };
}
