/**
 * Exact money arithmetic for payroll. All amounts are integer paise; every
 * intermediate product is computed with BigInt rationals and rounded exactly
 * once, at the end of each calculation, using an explicit rounding mode.
 *
 * Rounding rules (see docs/PAYROLL.md):
 *  - Earnings, proration and one-off inputs: half-up to the paise.
 *  - Statutory contributions: the mode is a rule-set parameter. Defaults:
 *    PF half-up to the rupee, ESI up to the next rupee, PT/LWF are whole-rupee
 *    slab amounts, monthly TDS half-up to the rupee, annual income and tax
 *    rounded to the nearest ten rupees (sections 288A / 288B).
 *  - Gratuity: rule-set parameter (default half-up to the rupee).
 * "Half-up" means ties round away from zero (2.5 -> 3, -2.5 -> -3).
 */

export const ROUNDING_MODES = ["half_up_paise", "half_up_rupee", "ceil_rupee", "floor_rupee", "nearest_10_rupees"] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

const UNIT: Record<RoundingMode, bigint> = {
  half_up_paise: BigInt(1),
  half_up_rupee: BigInt(100),
  ceil_rupee: BigInt(100),
  floor_rupee: BigInt(100),
  nearest_10_rupees: BigInt(1000),
};

/** Percent with up to four decimals (12.5, 8.33, 0.75) as an exact ratio numerator over 1_000_000. */
export const PCT_DEN = BigInt(1_000_000);
export function pctNum(percent: number): bigint {
  if (!Number.isFinite(percent)) throw new Error("Percent must be a finite number");
  return BigInt(Math.round(percent * 10_000));
}

/** Days (may be fractional to two decimals) as hundredths. */
export function hundredths(days: number): bigint {
  if (!Number.isFinite(days)) throw new Error("Days must be a finite number");
  return BigInt(Math.round(days * 100));
}

/**
 * Divide num / den and round to a multiple of the mode's unit (in paise).
 * Returns paise as a JS number (safe below 2^53, ~90 trillion rupees).
 */
export function divRound(num: bigint, den: bigint, mode: RoundingMode = "half_up_paise"): number {
  if (den === BigInt(0)) throw new Error("Division by zero in payroll arithmetic");
  if (den < BigInt(0)) {
    num = -num;
    den = -den;
  }
  const neg = num < BigInt(0);
  const abs = neg ? -num : num;
  const unit = UNIT[mode];
  const d = den * unit;
  let q: bigint;
  if (mode === "ceil_rupee") q = neg ? abs / d : (abs + d - BigInt(1)) / d;
  else if (mode === "floor_rupee") q = neg ? (abs + d - BigInt(1)) / d : abs / d;
  else q = (BigInt(2) * abs + d) / (BigInt(2) * d);
  const out = q * unit;
  return Number(neg ? -out : out);
}

/** Round an amount in paise to the mode's unit. */
export const roundTo = (paise: number, mode: RoundingMode) => divRound(BigInt(paise), BigInt(1), mode);

/** amount × percent%, rounded once. */
export const percentOf = (paise: number, percent: number, mode: RoundingMode = "half_up_paise") =>
  divRound(BigInt(paise) * pctNum(percent), PCT_DEN, mode);

/** amount × payable / calendar days (days may be fractional to 0.01), rounded once to the paise. */
export function prorate(paise: number, payableDays: number, calendarDays: number) {
  if (calendarDays <= 0) throw new Error("Calendar days must be positive");
  return divRound(BigInt(paise) * hundredths(payableDays), BigInt(calendarDays) * BigInt(100), "half_up_paise");
}

/** Exact a × b / c with rounding (all integers). */
export const mulDiv = (a: number, b: number, c: number, mode: RoundingMode = "half_up_paise") =>
  divRound(BigInt(a) * BigInt(b), BigInt(c), mode);

export const rupees = (r: number) => Math.round(r * 100);

/** "₹1,23,456.78" in Indian digit grouping. Pure and locale-stable. */
export function inr(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.trunc(paise));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const s = String(whole);
  let grouped = s;
  if (s.length > 3) {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    grouped = `${rest},${last3}`;
  }
  return `${neg ? "-" : ""}₹${grouped}.${frac}`;
}

/** Human-readable percent: 12 -> "12%", 8.33 -> "8.33%". */
export const pctLabel = (p: number) => `${Number(p.toFixed(4))}%`;

/** Human-readable days: 28 -> "28", 27.5 -> "27.5". */
export const daysLabel = (d: number) => `${Number(d.toFixed(2))}`;

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
