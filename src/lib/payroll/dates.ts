/** Pure ISO date helpers ("yyyy-MM-dd", interpreted as calendar dates in UTC). */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(d: string, label = "date") {
  if (!ISO.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw new Error(`Invalid ${label}: ${d}`);
}

const toUtc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Inclusive day count between two ISO dates (0 if end < start). */
export function daysInclusive(start: string, end: string) {
  if (end < start) return 0;
  return Math.round((toUtc(end) - toUtc(start)) / 86_400_000) + 1;
}

export const addDays = (d: string, n: number) => fromUtc(toUtc(d) + n * 86_400_000);
export const maxDate = (...ds: (string | null | undefined)[]) => ds.filter(Boolean).sort().at(-1) as string;
export const minDate = (...ds: (string | null | undefined)[]) => ds.filter(Boolean).sort()[0] as string;

export function monthBounds(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = fromUtc(Date.UTC(year, month, 0));
  return { start, end, days: daysInclusive(start, end) };
}

/** Financial year (April–March) start year for a date or month. */
export const fyStartYearOf = (year: number, month: number) => (month >= 4 ? year : year - 1);

/** 1 for April … 12 for March. */
export const fyMonthIndex = (month: number) => ((month - 4 + 12) % 12) + 1;

/** Age in completed years on a date. */
export function ageOn(dateOfBirth: string, on: string) {
  const [by, bm, bd] = dateOfBirth.split("-").map(Number);
  const [y, m, d] = on.split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}

/** Completed years, months and days between two dates (from inclusive, to inclusive). */
export function serviceDuration(from: string, to: string) {
  const end = addDays(to, 1); // service through `to` inclusive
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = end.split("-").map(Number);
  let years = ty - fy;
  let months = tm - fm;
  let days = td - fd;
  if (days < 0) {
    months -= 1;
    // days in the month preceding `end`
    days += new Date(Date.UTC(ty, tm - 1, 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years: Math.max(0, years), months: Math.max(0, months), days: Math.max(0, days) };
}
