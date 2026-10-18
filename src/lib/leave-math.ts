/**
 * Pure leave arithmetic shared by the leave service, the apply form preview
 * and unit tests. No I/O, no clock: every input is explicit.
 *
 * Dates are ISO `yyyy-MM-dd` strings and are handled in UTC so that day
 * arithmetic never shifts across time zones.
 */

export type Session = "full" | "first_half" | "second_half";

const DAY_MS = 86_400_000;

export const toUtc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
export const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDaysIso = (d: string, n: number) => fromUtc(toUtc(d) + n * DAY_MS);
export const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
/** 0 = Sunday ... 6 = Saturday */
export const weekdayOf = (d: string) => new Date(toUtc(d)).getUTCDay();

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = toUtc(from), end = toUtc(to); t <= end; t += DAY_MS) out.push(fromUtc(t));
  return out;
}

export const daysInMonth = (year: number, month1: number) => new Date(Date.UTC(year, month1, 0)).getUTCDate();
export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
export const monthEnd = (d: string) => `${d.slice(0, 7)}-${String(daysInMonth(Number(d.slice(0, 4)), Number(d.slice(5, 7)))).padStart(2, "0")}`;

/** Round to the nearest half day (ties round up): 1.24 → 1, 1.25 → 1.5, 1.74 → 1.5, 1.75 → 2. */
export const roundHalf = (x: number) => Math.round(x * 2 + 1e-9) / 2;

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export type SessionCheck = { ok: true } | { ok: false; message: string };

/**
 * A single-day request uses one session (start and end must agree). A
 * multi-day request may start in the second half and end in the first half;
 * starting with the first half only or ending with the second half only
 * would leave a gap in the middle of the leave, so it is rejected.
 */
export function validateSessions(start: string, end: string, startSession: Session, endSession: Session): SessionCheck {
  if (end < start) return { ok: false, message: "End date must be on or after the start date." };
  if (start === end) {
    if (startSession !== endSession) return { ok: false, message: "For a single day, choose one session." };
    return { ok: true };
  }
  if (startSession === "first_half") return { ok: false, message: "A multi-day leave can start with the full day or the second half." };
  if (endSession === "second_half") return { ok: false, message: "A multi-day leave can end with the full day or the first half." };
  return { ok: true };
}

/** Session covered on `date` by a request (null when the date is outside it). */
export function sessionOn(
  req: { startDate: string; endDate: string; startSession: Session; endSession: Session },
  date: string,
): Session | null {
  if (date < req.startDate || date > req.endDate) return null;
  if (req.startDate === req.endDate) return req.startSession;
  if (date === req.startDate) return req.startSession;
  if (date === req.endDate) return req.endSession;
  return "full";
}

export const sessionsOverlap = (a: Session, b: Session) => a === "full" || b === "full" || a === b;
export const sessionFraction = (s: Session) => (s === "full" ? 1 : 0.5);

/** True when two requests claim the same session on any calendar day. */
export function requestsOverlap(
  a: { startDate: string; endDate: string; startSession: Session; endSession: Session },
  b: { startDate: string; endDate: string; startSession: Session; endSession: Session },
) {
  const from = a.startDate > b.startDate ? a.startDate : b.startDate;
  const to = a.endDate < b.endDate ? a.endDate : b.endDate;
  if (from > to) return false;
  for (const d of eachDate(from, to)) {
    const sa = sessionOn(a, d);
    const sb = sessionOn(b, d);
    if (sa && sb && sessionsOverlap(sa, sb)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Day counting                                                        */
/* ------------------------------------------------------------------ */

export type LeaveDayKind = "leave" | "weekly_off" | "holiday" | "sandwich";

export type LeaveDay = { date: string; kind: LeaveDayKind; session: Session; days: number };

export type CountInput = {
  startDate: string;
  endDate: string;
  startSession: Session;
  endSession: Session;
  /** Weekdays that are off (0 = Sunday ... 6 = Saturday). */
  weeklyOffs: readonly number[];
  /** Holiday dates (yyyy-MM-dd) that are off for the employee. */
  holidays: readonly string[];
  /** Count weekly offs and holidays that fall between leave days as leave. */
  sandwich: boolean;
};

/**
 * Leave days between two dates, inclusive.
 *
 * - Working days count 1, or 0.5 on a half-day session.
 * - Weekly offs and holidays count 0, unless the sandwich rule is on and the
 *   off day lies strictly between two leave days of the same request: then
 *   it counts as a full leave day. Off days at the edges never count.
 */
export function countLeaveDays(input: CountInput): { days: number; breakdown: LeaveDay[] } {
  const holidays = new Set(input.holidays);
  const offs = new Set(input.weeklyOffs);
  const dates = eachDate(input.startDate, input.endDate);
  const req = input;
  const offKind = (d: string): LeaveDayKind | null => (holidays.has(d) ? "holiday" : offs.has(weekdayOf(d)) ? "weekly_off" : null);
  const firstWorking = dates.findIndex((d) => !offKind(d));
  let lastWorking = -1;
  for (let i = dates.length - 1; i >= 0; i--) if (!offKind(dates[i])) {
    lastWorking = i;
    break;
  }
  const breakdown: LeaveDay[] = dates.map((date, i) => {
    const session = sessionOn(req, date) ?? "full";
    const off = offKind(date);
    if (!off) return { date, kind: "leave", session, days: sessionFraction(session) };
    if (input.sandwich && firstWorking !== -1 && i > firstWorking && i < lastWorking) return { date, kind: "sandwich", session: "full", days: 1 };
    return { date, kind: off, session, days: 0 };
  });
  return { days: breakdown.reduce((s, d) => s + d.days, 0), breakdown };
}

/* ------------------------------------------------------------------ */
/* Accrual                                                             */
/* ------------------------------------------------------------------ */

export type AccrualMethod = "none" | "monthly" | "quarterly" | "annual_upfront";

/** Fraction of [from, to] during which the employee was employed (joined on or before, not exited before). */
export function employedFraction(from: string, to: string, joiningDate: string, exitDate: string | null = null) {
  const start = joiningDate > from ? joiningDate : from;
  const end = exitDate && exitDate < to ? exitDate : to;
  if (end < start) return 0;
  return (daysBetween(start, end) + 1) / (daysBetween(from, to) + 1);
}

export type AccrualInput = {
  method: AccrualMethod;
  daysPerYear: number;
  prorateOnJoining: boolean;
  /** First day of the leave year, e.g. "2026-01-01". */
  leaveYearStart: string;
  /** Any date inside the period being credited. */
  periodDate: string;
  joiningDate: string;
};

export type AccrualPeriod = { key: string; start: string; end: string };

/** The accrual period containing `date`: a month, a quarter of the leave year, or the whole year. */
export function accrualPeriod(method: AccrualMethod, leaveYearStart: string, date: string): AccrualPeriod | null {
  const y = Number(leaveYearStart.slice(0, 4));
  const startMonth = Number(leaveYearStart.slice(5, 7));
  const monthIdx = (Number(date.slice(0, 4)) - y) * 12 + Number(date.slice(5, 7)) - startMonth; // 0..11
  const monthAt = (idx: number) => {
    const total = y * 12 + startMonth - 1 + idx;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
  };
  switch (method) {
    case "none":
      return null;
    case "monthly": {
      const m = date.slice(0, 7);
      return { key: m, start: `${m}-01`, end: monthEnd(`${m}-01`) };
    }
    case "quarterly": {
      const q = Math.floor(monthIdx / 3);
      const first = monthAt(q * 3);
      const last = monthAt(q * 3 + 2);
      return { key: first, start: `${first}-01`, end: monthEnd(`${last}-01`) };
    }
    case "annual_upfront": {
      const last = monthAt(11);
      return { key: leaveYearStart.slice(0, 4), start: leaveYearStart, end: monthEnd(`${last}-01`) };
    }
  }
}

/**
 * Days to credit for the period containing `periodDate`.
 *
 * Rounding: entitlements are rounded to the nearest 0.5 day **cumulatively**
 * across the leave year (credit = round(cumulative through this period) −
 * round(cumulative through the previous period)). Each posting is a multiple
 * of 0.5 and the yearly total equals round(daysPerYear × employed share), so
 * e.g. 15 days/year accrues 1.5, 1, 1.5, 1, ... and never drifts to 18.
 *
 * Proration: when `prorateOnJoining` is on, a period in which the employee
 * joined is credited for the share of its calendar days from the joining
 * date; periods before joining earn nothing. Without proration the joining
 * period is credited in full.
 */
export function accrualAmount(input: AccrualInput): number {
  const period = accrualPeriod(input.method, input.leaveYearStart, input.periodDate);
  if (!period || input.daysPerYear <= 0) return 0;
  if (input.joiningDate > period.end) return 0;
  const share = (p: AccrualPeriod) => {
    if (input.joiningDate > p.end) return 0;
    return input.prorateOnJoining ? employedFraction(p.start, p.end, input.joiningDate) : 1;
  };
  if (input.method === "annual_upfront") return roundHalf(input.daysPerYear * share(period));

  const perPeriod = input.method === "monthly" ? input.daysPerYear / 12 : input.daysPerYear / 4;
  // Cumulative entitlement from the leave-year start through this period.
  let before = 0;
  let cursor = accrualPeriod(input.method, input.leaveYearStart, input.leaveYearStart)!;
  while (cursor.start < period.start) {
    before += perPeriod * share(cursor);
    cursor = accrualPeriod(input.method, input.leaveYearStart, addDaysIso(cursor.end, 1))!;
  }
  const through = before + perPeriod * share(period);
  return roundHalf(through) - roundHalf(before);
}

/** Cap a credit so the balance does not exceed `maxBalance` (null = no cap). Never negative. */
export function capCredit(amount: number, balance: number, maxBalance: number | null) {
  if (maxBalance == null) return amount;
  return Math.max(0, Math.min(amount, roundHalf(maxBalance - balance)));
}

/* ------------------------------------------------------------------ */
/* Year end: carry forward and lapse                                   */
/* ------------------------------------------------------------------ */

export type CarryForwardRules = { enabled: boolean; maxDays: number; expiresAfterMonths: number | null };

/**
 * Split the closing balance of a leave year into the part carried into the
 * next year and the part that lapses. A negative closing balance (advance
 * leave) is carried in full so it is recovered from future credits.
 */
export function carryForward(closingBalance: number, rules: CarryForwardRules, newYearStart: string) {
  const expiresOn = (carry: number) => {
    if (!rules.expiresAfterMonths || carry <= 0) return null;
    const y = Number(newYearStart.slice(0, 4));
    const m = Number(newYearStart.slice(5, 7)) - 1 + rules.expiresAfterMonths;
    // Expires at the end of the last month: the lot is usable through that day.
    return addDaysIso(`${y + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-01`, -1);
  };
  if (closingBalance <= 0) return { carry: closingBalance, lapse: 0, expiresOn: null as string | null };
  const carry = rules.enabled ? Math.min(closingBalance, Math.max(0, rules.maxDays)) : 0;
  return { carry, lapse: closingBalance - carry, expiresOn: expiresOn(carry) };
}

/* ------------------------------------------------------------------ */
/* Expiring lots (carry forward, comp off)                             */
/* ------------------------------------------------------------------ */

export type LedgerEntry = {
  id: string;
  kind: string;
  days: number;
  effectiveOn: string;
  expiresOn: string | null;
  sourceKey: string;
};

/**
 * Lots (credits with an expiry date) that have expired by `asOf` and still
 * hold unused days. Debits consume the soonest-expiring lot first (credits
 * without an expiry are used last), which is the most favourable order for
 * the employee. Lots already expired by an `expiry:<lotId>` posting are
 * skipped, so the result is safe to post repeatedly.
 */
export function expiredLots(entries: readonly LedgerEntry[], asOf: string): { lotId: string; remaining: number; expiresOn: string }[] {
  type Lot = { id: string; remaining: number; expiresOn: string | null; effectiveOn: string };
  const sorted = [...entries].sort((a, b) => (a.effectiveOn === b.effectiveOn ? (a.days > b.days ? -1 : 1) : a.effectiveOn < b.effectiveOn ? -1 : 1));
  const lots: Lot[] = [];
  const expiredExplicitly = new Set<string>();
  for (const e of sorted) {
    if (e.kind === "expiry" && e.sourceKey.startsWith("expiry:")) {
      const lotId = e.sourceKey.slice("expiry:".length);
      const lot = lots.find((l) => l.id === lotId);
      if (lot) lot.remaining = Math.max(0, lot.remaining + e.days);
      expiredExplicitly.add(lotId);
      continue;
    }
    if (e.days > 0) {
      lots.push({ id: e.id, remaining: e.days, expiresOn: e.expiresOn, effectiveOn: e.effectiveOn });
      continue;
    }
    // Debit: consume lots that are still valid on the debit date, soonest expiry first.
    let need = -e.days;
    const usable = lots
      .filter((l) => l.remaining > 0 && (!l.expiresOn || l.expiresOn >= e.effectiveOn))
      .sort((a, b) => (a.expiresOn ?? "9999-12-31").localeCompare(b.expiresOn ?? "9999-12-31"));
    for (const l of usable) {
      if (need <= 0) break;
      const take = Math.min(l.remaining, need);
      l.remaining -= take;
      need -= take;
    }
  }
  return lots
    .filter((l) => l.expiresOn && l.expiresOn < asOf && l.remaining > 0 && !expiredExplicitly.has(l.id))
    .map((l) => ({ lotId: l.id, remaining: l.remaining, expiresOn: l.expiresOn! }));
}

/* ------------------------------------------------------------------ */
/* Balance check                                                       */
/* ------------------------------------------------------------------ */

/** Whether `days` can be taken from `balance - pending`, honouring negative-balance settings. */
export function canAfford(days: number, balance: number, pending: number, allowNegative: boolean, maxNegativeDays: number) {
  const after = balance - pending - days;
  if (after >= 0) return true;
  return allowNegative && after >= -Math.max(0, maxNegativeDays);
}
