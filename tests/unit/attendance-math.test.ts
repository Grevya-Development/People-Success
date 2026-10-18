import { describe, expect, it } from "vitest";
import { attendanceWindow, computeDayOutcome, pickInOut, shiftBounds, type DayInput } from "@/server/services/time/attendance-math";

const shift = {
  startTime: "09:30:00",
  endTime: "18:30:00",
  breakMinutes: 60,
  graceInMinutes: 15,
  graceOutMinutes: 15,
  halfDayMinutes: 240,
  fullDayMinutes: 480,
  weeklyOffs: [0, 6],
  isFlexible: false,
  isNight: false,
};
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);
// 2026-10-14 is a Wednesday, 2026-10-17 a Saturday.
const base = (over: Partial<DayInput> = {}): DayInput => ({
  date: "2026-10-14",
  today: "2026-10-18",
  joiningDate: "2024-01-01",
  lastDate: null,
  shift,
  isHoliday: false,
  leaves: [],
  punches: [],
  rules: { overtimeEnabled: false, overtimeMinMinutes: 30, autoMarkAbsentWithoutPunch: true, lateMarksPerHalfDay: null },
  lateMarksBefore: 0,
  ...over,
});
const punches = (inT: string, outT?: string) => [
  { occurredAt: at("2026-10-14", inT), kind: "in" as const, verification: "self_reported" },
  ...(outT ? [{ occurredAt: at("2026-10-14", outT), kind: "out" as const, verification: "self_reported" }] : []),
];

describe("computeDayOutcome", () => {
  it("full day present with break deducted", () => {
    const o = computeDayOutcome(base({ punches: punches("09:30", "18:30") }))!;
    expect(o.status).toBe("present");
    expect(o.payableFraction).toBe(1);
    expect(o.workedMinutes).toBe(480); // 540 span - 60 break
    expect(o.lateMinutes).toBe(0);
  });

  it("late beyond grace counts from shift start; within grace is not late", () => {
    expect(computeDayOutcome(base({ punches: punches("09:44", "18:45") }))!.lateMinutes).toBe(0);
    expect(computeDayOutcome(base({ punches: punches("10:00", "19:30") }))!.lateMinutes).toBe(30);
    expect(computeDayOutcome(base({ punches: punches("09:30", "17:30") }))!.earlyLeaveMinutes).toBe(60);
  });

  it("half day and absent by worked minutes", () => {
    const half = computeDayOutcome(base({ punches: punches("09:30", "14:00") }))!; // 270 span, no break deduction
    expect([half.status, half.payableFraction, half.workedMinutes]).toEqual(["half_day", 0.5, 270]);
    const absent = computeDayOutcome(base({ punches: punches("09:30", "11:00") }))!;
    expect([absent.status, absent.payableFraction]).toEqual(["absent", 0]);
  });

  it("missing punch and no punch", () => {
    expect(computeDayOutcome(base({ punches: punches("09:30") }))).toMatchObject({ status: "missing_punch", payableFraction: 0 });
    expect(computeDayOutcome(base())).toMatchObject({ status: "absent", payableFraction: 0 });
    expect(computeDayOutcome(base({ rules: { ...base().rules, autoMarkAbsentWithoutPunch: false } }))).toMatchObject({ status: "present", payableFraction: 1 });
    // Today without punches and future working days have nothing to record yet.
    expect(computeDayOutcome(base({ today: "2026-10-14" }))).toBeNull();
    expect(computeDayOutcome(base({ today: "2026-10-10" }))).toBeNull();
  });

  it("weekly offs, holidays and employment boundaries", () => {
    expect(computeDayOutcome(base({ date: "2026-10-17" }))).toMatchObject({ status: "weekly_off", payableFraction: 1 });
    expect(computeDayOutcome(base({ isHoliday: true }))).toMatchObject({ status: "holiday", payableFraction: 1 });
    expect(computeDayOutcome(base({ joiningDate: "2026-10-15" }))).toMatchObject({ status: "not_joined", payableFraction: 0 });
    expect(computeDayOutcome(base({ lastDate: "2026-10-13" }))).toMatchObject({ status: "not_joined", payableFraction: 0 });
  });

  it("paid and unpaid leave, including half days combined with presence", () => {
    expect(computeDayOutcome(base({ leaves: [{ requestId: "a", fraction: 1, isPaid: true }] }))).toMatchObject({ status: "on_leave", payableFraction: 1, leaveRequestId: "a" });
    expect(computeDayOutcome(base({ leaves: [{ requestId: "a", fraction: 1, isPaid: false }] }))).toMatchObject({ status: "on_leave", payableFraction: 0 });
    // Paid half-day leave + worked half day = 1.
    expect(computeDayOutcome(base({ leaves: [{ requestId: "a", fraction: 0.5, isPaid: true }], punches: punches("14:00", "18:30") }))!.payableFraction).toBe(1);
    // Paid half-day leave without presence = 0.5.
    expect(computeDayOutcome(base({ leaves: [{ requestId: "a", fraction: 0.5, isPaid: true }] }))!.payableFraction).toBe(0.5);
    // Unpaid half day + worked half = 0.5; unpaid half without presence = 0.
    expect(computeDayOutcome(base({ leaves: [{ requestId: "a", fraction: 0.5, isPaid: false }], punches: punches("14:00", "18:30") }))!.payableFraction).toBe(0.5);
    expect(computeDayOutcome(base({ leaves: [{ requestId: "a", fraction: 0.5, isPaid: false }] }))!.payableFraction).toBe(0);
    // Future half day is provisional (other half assumed worked).
    expect(computeDayOutcome(base({ today: "2026-10-10", leaves: [{ requestId: "a", fraction: 0.5, isPaid: false }] }))!.payableFraction).toBe(0.5);
  });

  it("overtime and late-mark deductions follow the policy", () => {
    const rules = { ...base().rules, overtimeEnabled: true, overtimeMinMinutes: 30 };
    expect(computeDayOutcome(base({ rules, punches: punches("09:30", "19:30") }))!.overtimeMinutes).toBe(60);
    expect(computeDayOutcome(base({ rules, punches: punches("09:30", "18:50") }))!.overtimeMinutes).toBe(0);
    const late = { ...base().rules, lateMarksPerHalfDay: 3 };
    expect(computeDayOutcome(base({ rules: late, lateMarksBefore: 1, punches: punches("10:00", "19:30") }))!.payableFraction).toBe(1);
    const third = computeDayOutcome(base({ rules: late, lateMarksBefore: 2, punches: punches("10:00", "19:30") }))!;
    expect([third.payableFraction, third.lateDeduction]).toEqual([0.5, true]);
  });

  it("approved corrections override raw punches; night shifts span midnight", () => {
    const p = pickInOut([
      { occurredAt: at("2026-10-14", "11:00"), kind: "in", verification: "self_reported" },
      { occurredAt: at("2026-10-14", "09:30"), kind: "in", verification: "approved_correction" },
      { occurredAt: at("2026-10-14", "18:30"), kind: "out", verification: "self_reported" },
    ]);
    expect(p.firstIn).toEqual(at("2026-10-14", "09:30"));
    expect(p.isRegularized).toBe(true);
    const night = { startTime: "22:00", endTime: "06:00", isNight: true };
    expect(shiftBounds("2026-10-14", night).end).toEqual(at("2026-10-15", "06:00"));
    expect(attendanceWindow("2026-10-14", night).from).toEqual(at("2026-10-14", "18:00"));
  });
});
