/**
 * Attendance contract (see docs/PAYROLL.md):
 *
 *   payable days = calendar days in the employment window
 *                  − Σ (1 − payableFraction) over attendance_days in the window
 *
 * The employment window is [max(period start, joining date), min(period end,
 * last working day)]. When an employee has no attendance_days rows in the
 * window, approved leave of an unpaid leave type is used instead; leave that
 * crosses the window boundary is apportioned by calendar days and rounded to
 * the nearest half day (documented simplification).
 */
import { daysInclusive, maxDate, minDate } from "./dates";
import type { DaysSummary, Message } from "./types";

export type AttendanceRow = { date: string; payableFraction: number };
export type UnpaidLeave = { startDate: string; endDate: string; days: number };

export function computePayableDays(input: {
  periodStart: string;
  periodEnd: string;
  joiningDate: string;
  lastWorkingDate: string | null;
  attendance: AttendanceRow[];
  unpaidLeave: UnpaidLeave[];
}): { days: DaysSummary; messages: Message[] } {
  const calendarDays = daysInclusive(input.periodStart, input.periodEnd);
  const windowStart = maxDate(input.periodStart, input.joiningDate);
  const windowEnd = input.lastWorkingDate ? minDate(input.periodEnd, input.lastWorkingDate) : input.periodEnd;
  const employedDays = daysInclusive(windowStart, windowEnd);
  const messages: Message[] = [];
  const joinedInPeriod = input.joiningDate > input.periodStart && input.joiningDate <= input.periodEnd ? input.joiningDate : null;
  const exitedInPeriod = input.lastWorkingDate && input.lastWorkingDate >= input.periodStart && input.lastWorkingDate < input.periodEnd ? input.lastWorkingDate : null;
  if (joinedInPeriod) messages.push({ severity: "info", code: "joiner", message: `Joined on ${joinedInPeriod}; pay is prorated from that date.` });
  if (exitedInPeriod) messages.push({ severity: "info", code: "exit", message: `Last working day ${exitedInPeriod}; pay is prorated to that date.` });

  let lopHundredths = 0;
  let source: DaysSummary["source"] = "none";
  const inWindow = input.attendance.filter((a) => a.date >= windowStart && a.date <= windowEnd);
  if (employedDays > 0 && inWindow.length) {
    source = "attendance";
    for (const a of inWindow) {
      const f = Math.round(a.payableFraction * 100);
      if (f < 0 || f > 100) throw new Error(`Attendance payable fraction out of range on ${a.date}`);
      lopHundredths += 100 - f;
    }
    if (inWindow.length < employedDays) {
      messages.push({
        severity: "warning",
        code: "attendance_partial",
        message: `Attendance has ${inWindow.length} of ${employedDays} days in the employment window; days without a record are treated as payable.`,
      });
    }
  } else if (employedDays > 0) {
    const overlapping = input.unpaidLeave.filter((l) => l.endDate >= windowStart && l.startDate <= windowEnd);
    source = overlapping.length ? "unpaid_leave" : "none";
    for (const l of overlapping) {
      const total = daysInclusive(l.startDate, l.endDate);
      const overlap = daysInclusive(maxDate(l.startDate, windowStart), minDate(l.endDate, windowEnd));
      const days = overlap === total ? l.days : Math.round(((l.days * overlap) / total) * 2) / 2;
      lopHundredths += Math.round(days * 100);
    }
    messages.push({
      severity: "warning",
      code: "no_attendance",
      message: overlapping.length
        ? `No processed attendance in the period; loss of pay taken from ${overlapping.length} approved unpaid leave request${overlapping.length === 1 ? "" : "s"}.`
        : "No processed attendance in the period and no approved unpaid leave; all days in the employment window are treated as payable.",
    });
  }
  const lopDays = Math.min(lopHundredths, employedDays * 100) / 100;
  const payableDays = Math.max(0, (employedDays * 100 - Math.round(lopDays * 100)) / 100);
  return {
    days: { calendarDays, employedDays, payableDays, lopDays, windowStart, windowEnd, joinedInPeriod, exitedInPeriod, source },
    messages,
  };
}
