import { describe, expect, it } from "vitest";
import {
  accrualAmount,
  accrualPeriod,
  canAfford,
  capCredit,
  carryForward,
  countLeaveDays,
  eachDate,
  employedFraction,
  expiredLots,
  requestsOverlap,
  roundHalf,
  validateSessions,
  weekdayOf,
  type CountInput,
} from "@/lib/leave-math";

// Calendar used below (verified): 2026-10-12 is a Monday; 17 Sat, 18 Sun, 19 Mon.
const base: Omit<CountInput, "startDate" | "endDate"> = {
  startSession: "full",
  endSession: "full",
  weeklyOffs: [0, 6],
  holidays: [],
  sandwich: false,
};

describe("dates", () => {
  it("knows weekdays and iterates inclusively", () => {
    expect(weekdayOf("2026-10-12")).toBe(1);
    expect(weekdayOf("2026-10-18")).toBe(0);
    expect(eachDate("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
});

describe("countLeaveDays", () => {
  it("counts weekdays and skips weekly offs", () => {
    expect(countLeaveDays({ ...base, startDate: "2026-10-12", endDate: "2026-10-16" }).days).toBe(5);
    // Fri + Mon, weekend between is not leave without the sandwich rule.
    expect(countLeaveDays({ ...base, startDate: "2026-10-16", endDate: "2026-10-19" }).days).toBe(2);
  });

  it("skips holidays", () => {
    const r = countLeaveDays({ ...base, startDate: "2026-10-12", endDate: "2026-10-16", holidays: ["2026-10-14"] });
    expect(r.days).toBe(4);
    expect(r.breakdown.find((d) => d.date === "2026-10-14")?.kind).toBe("holiday");
  });

  it("applies the sandwich rule only between leave days", () => {
    // Fri, Sat, Sun, Mon = 4 with sandwich.
    expect(countLeaveDays({ ...base, sandwich: true, startDate: "2026-10-16", endDate: "2026-10-19" }).days).toBe(4);
    // Holiday mid-week inside the leave counts as leave.
    expect(countLeaveDays({ ...base, sandwich: true, startDate: "2026-10-12", endDate: "2026-10-16", holidays: ["2026-10-14"] }).days).toBe(5);
    // Off days at the edges never count: Sat–Mon = only Monday.
    expect(countLeaveDays({ ...base, sandwich: true, startDate: "2026-10-17", endDate: "2026-10-19" }).days).toBe(1);
    // Weekend only = 0 even with sandwich.
    expect(countLeaveDays({ ...base, sandwich: true, startDate: "2026-10-17", endDate: "2026-10-18" }).days).toBe(0);
  });

  it("handles half-day sessions", () => {
    expect(countLeaveDays({ ...base, startDate: "2026-10-12", endDate: "2026-10-12", startSession: "first_half", endSession: "first_half" }).days).toBe(0.5);
    // Mon 2nd half + Tue + Wed 1st half = 0.5 + 1 + 0.5
    expect(countLeaveDays({ ...base, startDate: "2026-10-12", endDate: "2026-10-14", startSession: "second_half", endSession: "first_half" }).days).toBe(2);
    // Fri 2nd half to Mon full with sandwich = 0.5 + 1 + 1 + 1
    expect(
      countLeaveDays({ ...base, sandwich: true, startDate: "2026-10-16", endDate: "2026-10-19", startSession: "second_half" }).days,
    ).toBe(3.5);
  });

  it("validates sessions", () => {
    expect(validateSessions("2026-10-12", "2026-10-12", "first_half", "first_half").ok).toBe(true);
    expect(validateSessions("2026-10-12", "2026-10-12", "first_half", "second_half").ok).toBe(false);
    expect(validateSessions("2026-10-12", "2026-10-13", "first_half", "full").ok).toBe(false);
    expect(validateSessions("2026-10-12", "2026-10-13", "full", "second_half").ok).toBe(false);
    expect(validateSessions("2026-10-13", "2026-10-12", "full", "full").ok).toBe(false);
  });
});

describe("requestsOverlap", () => {
  const day = (startDate: string, endDate: string, startSession: "full" | "first_half" | "second_half" = "full", endSession = startSession) => ({
    startDate,
    endDate,
    startSession,
    endSession,
  });
  it("allows complementary half days", () => {
    expect(requestsOverlap(day("2026-10-12", "2026-10-12", "first_half"), day("2026-10-12", "2026-10-12", "second_half"))).toBe(false);
    expect(requestsOverlap(day("2026-10-12", "2026-10-14", "full", "first_half"), day("2026-10-14", "2026-10-14", "second_half"))).toBe(false);
  });
  it("detects real overlaps", () => {
    expect(requestsOverlap(day("2026-10-12", "2026-10-12", "first_half"), day("2026-10-12", "2026-10-12"))).toBe(true);
    expect(requestsOverlap(day("2026-10-12", "2026-10-16"), day("2026-10-14", "2026-10-20"))).toBe(true);
    expect(requestsOverlap(day("2026-10-12", "2026-10-13"), day("2026-10-14", "2026-10-15"))).toBe(false);
  });
});

describe("accrual", () => {
  const yr = "2026-01-01";
  it("rounds to half days", () => {
    expect(roundHalf(1.24)).toBe(1);
    expect(roundHalf(1.25)).toBe(1.5);
    expect(roundHalf(1.74)).toBe(1.5);
    expect(roundHalf(1.75)).toBe(2);
  });

  it("credits monthly without drifting over the year", () => {
    const m = (periodDate: string, daysPerYear = 18) =>
      accrualAmount({ method: "monthly", daysPerYear, prorateOnJoining: true, leaveYearStart: yr, periodDate, joiningDate: "2020-01-01" });
    expect(m("2026-10-01")).toBe(1.5);
    // 15/year: cumulative 1.25 → 1.5, 2.5 → 2.5, 3.75 → 4
    expect(m("2026-01-01", 15)).toBe(1.5);
    expect(m("2026-02-01", 15)).toBe(1);
    expect(m("2026-03-01", 15)).toBe(1.5);
    const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}-01`);
    expect(months.reduce((s, d) => s + m(d, 15), 0)).toBe(15);
  });

  it("prorates the joining month", () => {
    const j = (joiningDate: string, periodDate: string, prorateOnJoining = true) =>
      accrualAmount({ method: "monthly", daysPerYear: 12, prorateOnJoining, leaveYearStart: yr, periodDate, joiningDate });
    // Joined 16 Oct: 16 of 31 days = 0.516 → 0.5
    expect(j("2026-10-16", "2026-10-01")).toBe(0.5);
    // November: cumulative 1.516 → 1.5, minus 0.5 already credited
    expect(j("2026-10-16", "2026-11-01")).toBe(1);
    // Joined 28 Oct: 4/31 = 0.13 → 0
    expect(j("2026-10-28", "2026-10-01")).toBe(0);
    // Without proration the joining month is credited in full; months before joining earn nothing.
    expect(j("2026-10-16", "2026-10-01", false)).toBe(1);
    expect(j("2026-10-16", "2026-09-01")).toBe(0);
  });

  it("handles annual upfront and quarterly", () => {
    // Joined 1 Jul: 184 of 365 days × 12 = 6.05 → 6
    expect(accrualAmount({ method: "annual_upfront", daysPerYear: 12, prorateOnJoining: true, leaveYearStart: yr, periodDate: "2026-07-01", joiningDate: "2026-07-01" })).toBe(6);
    expect(accrualAmount({ method: "annual_upfront", daysPerYear: 12, prorateOnJoining: false, leaveYearStart: yr, periodDate: "2026-07-01", joiningDate: "2026-07-01" })).toBe(12);
    expect(accrualPeriod("quarterly", yr, "2026-11-05")).toEqual({ key: "2026-10", start: "2026-10-01", end: "2026-12-31" });
    expect(accrualPeriod("quarterly", "2026-04-01", "2026-05-10")?.key).toBe("2026-04");
    // Joined 1 Nov: 61 of 92 days × 3 = 1.99 → 2
    expect(accrualAmount({ method: "quarterly", daysPerYear: 12, prorateOnJoining: true, leaveYearStart: yr, periodDate: "2026-11-05", joiningDate: "2026-11-01" })).toBe(2);
    expect(accrualAmount({ method: "none", daysPerYear: 12, prorateOnJoining: true, leaveYearStart: yr, periodDate: "2026-11-05", joiningDate: "2020-01-01" })).toBe(0);
  });

  it("computes employed share and caps credits at the max balance", () => {
    expect(employedFraction("2026-10-01", "2026-10-31", "2026-10-16")).toBeCloseTo(16 / 31);
    expect(employedFraction("2026-10-01", "2026-10-31", "2026-11-01")).toBe(0);
    expect(capCredit(1.5, 44, 45)).toBe(1);
    expect(capCredit(1.5, 45, 45)).toBe(0);
    expect(capCredit(1.5, 10, null)).toBe(1.5);
  });
});

describe("carry forward and expiry", () => {
  it("splits the closing balance", () => {
    expect(carryForward(20, { enabled: true, maxDays: 10, expiresAfterMonths: 3 }, "2026-01-01")).toEqual({ carry: 10, lapse: 10, expiresOn: "2026-03-31" });
    expect(carryForward(6, { enabled: true, maxDays: 10, expiresAfterMonths: null }, "2026-01-01")).toEqual({ carry: 6, lapse: 0, expiresOn: null });
    expect(carryForward(20, { enabled: false, maxDays: 10, expiresAfterMonths: null }, "2026-01-01")).toEqual({ carry: 0, lapse: 20, expiresOn: null });
    expect(carryForward(-2, { enabled: false, maxDays: 0, expiresAfterMonths: null }, "2026-01-01").carry).toBe(-2);
  });

  it("finds unused expired lots, soonest expiry consumed first", () => {
    const entries = [
      { id: "g1", kind: "grant", days: 2, effectiveOn: "2026-07-01", expiresOn: "2026-09-30", sourceKey: "grant:1" },
      { id: "d1", kind: "deduction", days: -1, effectiveOn: "2026-08-10", expiresOn: null, sourceKey: "leave:a" },
    ];
    expect(expiredLots(entries, "2026-10-01")).toEqual([{ lotId: "g1", remaining: 1, expiresOn: "2026-09-30" }]);
    // Not yet expired.
    expect(expiredLots(entries, "2026-09-30")).toEqual([]);
    // Once posted, it is not returned again.
    const posted = [...entries, { id: "x", kind: "expiry", days: -1, effectiveOn: "2026-10-01", expiresOn: null, sourceKey: "expiry:g1" }];
    expect(expiredLots(posted, "2026-10-02")).toEqual([]);
    // Two lots: the debit uses the one expiring first.
    const two = [
      { id: "a", kind: "grant", days: 1, effectiveOn: "2026-07-01", expiresOn: "2026-12-31", sourceKey: "grant:a" },
      { id: "b", kind: "grant", days: 1, effectiveOn: "2026-07-02", expiresOn: "2026-09-30", sourceKey: "grant:b" },
      { id: "d", kind: "deduction", days: -1, effectiveOn: "2026-08-01", expiresOn: null, sourceKey: "leave:x" },
    ];
    expect(expiredLots(two, "2026-10-01")).toEqual([]);
  });

  it("checks affordability with negative balances", () => {
    expect(canAfford(2, 3, 1, false, 0)).toBe(true);
    expect(canAfford(2.5, 3, 1, false, 0)).toBe(false);
    expect(canAfford(4, 3, 1, true, 2)).toBe(true);
    expect(canAfford(4.5, 3, 1, true, 2)).toBe(false);
  });
});
