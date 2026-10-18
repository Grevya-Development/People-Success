/**
 * Statutory calculators. Every function is pure and takes its parameters from
 * a validated rule set (see params.ts); no statutory value is hardcoded here.
 */
import { daysLabel, divRound, inr, pctLabel, pctNum, PCT_DEN, percentOf, sum } from "./money";
import { serviceDuration } from "./dates";
import type { BonusParams, EsiParams, GratuityParams, LwfParams, PfParams, PtParams, PtSlab } from "./params";

/* ------------------------------------------------------------------ */
/* Provident fund                                                      */
/* ------------------------------------------------------------------ */

export type PfInput = {
  /** PF wages earned this month (sum of PF-wage components after proration). */
  pfWage: number;
  /** "capped": contribute on min(wage, ceiling). "actual": on the full PF wage. */
  wageBasis: "capped" | "actual";
  /** Member of the pension scheme (age below epsMaxAge, EPS-eligible). */
  epsEligible: boolean;
  ageYears: number | null;
};

export type PfResult = {
  wage: number;
  employeeWage: number;
  employerWage: number;
  epsWage: number;
  employee: number;
  employer: number;
  eps: number;
  epf: number;
  explanationEmployee: string;
  explanationEmployer: string;
};

/**
 * Employee share = employeeRate% of the employee contribution wage.
 * Employer share = employerRate% of the employer contribution wage, of which
 * EPS = epsRate% of min(wage, EPS ceiling) (0 above epsMaxAge or if not an
 * EPS member) and EPF (employer) = employer share − EPS.
 */
export function calculatePf(p: PfParams, input: PfInput): PfResult {
  if (input.pfWage < 0) throw new Error("PF wage cannot be negative");
  const capped = Math.min(input.pfWage, p.wageCeiling);
  const employeeWage = input.wageBasis === "actual" ? input.pfWage : capped;
  const employerWage = input.wageBasis === "actual" && !p.employerAlwaysCapped ? input.pfWage : capped;
  const epsMember = input.epsEligible && (input.ageYears == null || input.ageYears < p.epsMaxAge);
  const epsWage = epsMember ? Math.min(employerWage, p.epsWageCeiling) : 0;
  const employee = percentOf(employeeWage, p.employeeRate, p.rounding);
  const employer = percentOf(employerWage, p.employerRate, p.rounding);
  const eps = Math.min(employer, percentOf(epsWage, p.epsRate, p.rounding));
  const epf = employer - eps;
  const wageText = (w: number) =>
    w === input.pfWage ? `PF wages ${inr(w)}` : `PF wages ${inr(input.pfWage)} capped at ${inr(w)}`;
  return {
    wage: input.pfWage,
    employeeWage,
    employerWage,
    epsWage,
    employee,
    employer,
    eps,
    epf,
    explanationEmployee: `Employee PF = ${pctLabel(p.employeeRate)} of ${wageText(employeeWage)} = ${inr(employee)}`,
    explanationEmployer:
      `Employer PF = ${pctLabel(p.employerRate)} of ${wageText(employerWage)} = ${inr(employer)}` +
      ` (EPS ${pctLabel(p.epsRate)} of ${inr(epsWage)} = ${inr(eps)}${epsMember ? "" : ", not an EPS member"}; EPF ${inr(epf)})`,
  };
}

/* ------------------------------------------------------------------ */
/* ESI                                                                 */
/* ------------------------------------------------------------------ */

/** Contribution period (from the rule set) that contains a month. */
export function esiContributionPeriod(p: EsiParams, year: number, month: number) {
  for (const cp of p.contributionPeriods) {
    const wraps = cp.endMonth < cp.startMonth;
    const inside = wraps ? month >= cp.startMonth || month <= cp.endMonth : month >= cp.startMonth && month <= cp.endMonth;
    if (inside) {
      const startYear = wraps && month <= cp.endMonth ? year - 1 : year;
      return { startYear, startMonth: cp.startMonth, endMonth: cp.endMonth, key: `${startYear}-${String(cp.startMonth).padStart(2, "0")}` };
    }
  }
  throw new Error(`No ESI contribution period covers month ${month}`);
}

export type EsiInput = {
  /** Monthly rate of ESI wages at full attendance (coverage test). */
  rateOfWages: number;
  /** ESI wages actually earned this month (contribution base). */
  earnedWages: number;
  /** Covered earlier in the same contribution period (continuation rule). */
  continuing: boolean;
};

export type EsiResult = { covered: boolean; reason: string; employee: number; employer: number; explanationEmployee: string; explanationEmployer: string };

/**
 * Coverage: rate of wages ≤ threshold (inclusive), or already covered in the
 * current contribution period (coverage continues until the period ends).
 * Simplification: coverage is decided from the structure's monthly rate of
 * ESI wages; overtime and one-off pay are contribution wages but do not affect
 * coverage. Contributions use the rule set's rounding (default: next rupee).
 */
export function calculateEsi(p: EsiParams, input: EsiInput): EsiResult {
  const within = input.rateOfWages <= p.wageThreshold;
  const covered = within || input.continuing;
  const reason = within
    ? `rate of ESI wages ${inr(input.rateOfWages)} is within the ${inr(p.wageThreshold)} threshold`
    : input.continuing
      ? `rate of ESI wages ${inr(input.rateOfWages)} exceeds ${inr(p.wageThreshold)} but coverage continues to the end of the contribution period`
      : `rate of ESI wages ${inr(input.rateOfWages)} exceeds the ${inr(p.wageThreshold)} threshold`;
  if (!covered) return { covered, reason, employee: 0, employer: 0, explanationEmployee: "", explanationEmployer: "" };
  const employee = percentOf(input.earnedWages, p.employeeRate, p.rounding);
  const employer = percentOf(input.earnedWages, p.employerRate, p.rounding);
  return {
    covered,
    reason,
    employee,
    employer,
    explanationEmployee: `Employee ESI = ${pctLabel(p.employeeRate)} of ESI wages ${inr(input.earnedWages)} = ${inr(employee)} (${reason})`,
    explanationEmployer: `Employer ESI = ${pctLabel(p.employerRate)} of ESI wages ${inr(input.earnedWages)} = ${inr(employer)}`,
  };
}

/* ------------------------------------------------------------------ */
/* Professional tax                                                    */
/* ------------------------------------------------------------------ */

export function slabFor<T extends { upTo: number | null }>(slabs: T[], wage: number): T {
  const s = slabs.find((x) => x.upTo === null || wage <= x.upTo);
  if (!s) throw new Error("Slab table has no open-ended final slab");
  return s;
}

export type PtInput = { ptWage: number; month: number; gender: string | null; state: string };
export type PtResult = { amount: number; explanation: string; basis: number };

/**
 * Monthly: slab on this month's PT wages, with month-specific amounts (e.g. a
 * February top-up). Half-yearly / annual: deducted only in deductionMonths, on
 * wages projected as this month × 6 or × 12 (documented simplification).
 */
export function calculatePt(p: PtParams, input: PtInput): PtResult {
  const slabs: PtSlab[] = input.gender === "female" && p.slabsByGender?.female ? p.slabsByGender.female : p.slabs;
  const genderNote = slabs !== p.slabs ? " (women's slab table)" : "";
  if (p.periodicity !== "monthly") {
    const months = p.deductionMonths ?? [];
    if (!months.includes(input.month)) {
      return { amount: 0, basis: 0, explanation: `Professional tax (${input.state}) is ${p.periodicity.replace("_", "-")}; not deducted this month` };
    }
    const factor = p.periodicity === "half_yearly" ? 6 : 12;
    const basis = input.ptWage * factor;
    const slab = slabFor(slabs, basis);
    const amount = slab.monthAmounts?.[String(input.month)] ?? slab.amount;
    return {
      amount,
      basis,
      explanation: `Professional tax (${input.state}) = ${inr(amount)} on projected ${p.periodicity.replace("_", "-")} wages ${inr(input.ptWage)} × ${factor} = ${inr(basis)}${genderNote}`,
    };
  }
  const slab = slabFor(slabs, input.ptWage);
  const monthAmount = slab.monthAmounts?.[String(input.month)];
  const amount = monthAmount ?? slab.amount;
  const band = slab.upTo === null ? "top slab" : `slab up to ${inr(slab.upTo)}`;
  return {
    amount,
    basis: input.ptWage,
    explanation: `Professional tax (${input.state}) = ${inr(amount)} for monthly PT wages ${inr(input.ptWage)} (${band}${monthAmount != null ? `, month-specific amount for month ${input.month}` : ""})${genderNote}`,
  };
}

/* ------------------------------------------------------------------ */
/* Labour welfare fund                                                 */
/* ------------------------------------------------------------------ */

export type LwfResult = { employee: number; employer: number; explanation: string };

export function calculateLwf(p: LwfParams, input: { wage: number; month: number; state: string }): LwfResult {
  if (!p.deductionMonths.includes(input.month)) return { employee: 0, employer: 0, explanation: `LWF (${input.state}) not due this month` };
  const slab = slabFor(p.slabs, input.wage);
  return {
    employee: slab.employee,
    employer: slab.employer,
    explanation: `Labour welfare fund (${input.state}) for wages ${inr(input.wage)}: employee ${inr(slab.employee)}, employer ${inr(slab.employer)}`,
  };
}

/* ------------------------------------------------------------------ */
/* Gratuity (Payment of Gratuity Act)                                  */
/* ------------------------------------------------------------------ */

export type GratuityResult = {
  eligible: boolean;
  completedYears: number;
  countedYears: number;
  amount: number;
  explanation: string;
};

/**
 * last drawn (basic + DA) × daysFactor / monthDays × counted years, capped.
 * Counted years = completed years, +1 if the remaining part-year exceeds
 * roundUpMonthsAbove months. Eligibility uses completed (not rounded) years.
 */
export function calculateGratuity(p: GratuityParams, input: { lastDrawnMonthlyWage: number; joiningDate: string; exitDate: string }): GratuityResult {
  if (input.lastDrawnMonthlyWage < 0) throw new Error("Last drawn wage cannot be negative");
  const d = serviceDuration(input.joiningDate, input.exitDate);
  const roundUp = d.months > p.roundUpMonthsAbove || (d.months === p.roundUpMonthsAbove && d.days > 0);
  const countedYears = d.years + (roundUp ? 1 : 0);
  const service = `${d.years}y ${d.months}m ${d.days}d`;
  if (d.years < p.minYears) {
    return { eligible: false, completedYears: d.years, countedYears, amount: 0, explanation: `Not eligible for gratuity: service ${service} is below ${p.minYears} completed years` };
  }
  const raw = divRound(BigInt(input.lastDrawnMonthlyWage) * pctNum(p.daysFactor) * BigInt(countedYears), BigInt(p.monthDays) * BigInt(10_000), p.rounding);
  const amount = Math.min(raw, p.cap);
  return {
    eligible: true,
    completedYears: d.years,
    countedYears,
    amount,
    explanation:
      `Gratuity = ${inr(input.lastDrawnMonthlyWage)} × ${p.daysFactor}/${p.monthDays} × ${countedYears} years (service ${service}) = ${inr(raw)}` +
      (raw > p.cap ? `, capped at ${inr(p.cap)}` : ""),
  };
}

/* ------------------------------------------------------------------ */
/* Statutory bonus (Payment of Bonus Act) — calculator only            */
/* ------------------------------------------------------------------ */

export type BonusResult = { eligible: boolean; amount: number; percent: number; bonusWages: number; explanation: string };

/**
 * Bonus = percent% of Σ min(monthly basic+DA, max(calculation ceiling, minimum wage)).
 * Eligible when every month's salary is within the eligibility ceiling and
 * the employee worked at least minDaysWorked days in the year.
 */
export function calculateStatutoryBonus(
  p: BonusParams,
  input: { monthlyWages: number[]; percent: number; daysWorked: number; minimumMonthlyWage?: number },
): BonusResult {
  if (input.monthlyWages.some((w) => w < 0)) throw new Error("Wages cannot be negative");
  if (input.percent < p.minPercent || input.percent > p.maxPercent) {
    throw new Error(`Bonus percent must be between ${p.minPercent}% and ${p.maxPercent}%`);
  }
  const overCeiling = input.monthlyWages.some((w) => w > p.eligibilityWageCeiling);
  if (overCeiling || input.daysWorked < p.minDaysWorked) {
    return {
      eligible: false,
      amount: 0,
      percent: input.percent,
      bonusWages: 0,
      explanation: overCeiling
        ? `Not eligible: salary exceeded ${inr(p.eligibilityWageCeiling)} a month`
        : `Not eligible: worked ${input.daysWorked} days, minimum ${p.minDaysWorked}`,
    };
  }
  const cap = Math.max(p.calculationWageCeiling, input.minimumMonthlyWage ?? 0);
  const bonusWages = sum(input.monthlyWages.map((w) => Math.min(w, cap)));
  const amount = divRound(BigInt(bonusWages) * pctNum(input.percent), PCT_DEN, p.rounding);
  return {
    eligible: true,
    amount,
    percent: input.percent,
    bonusWages,
    explanation: `Bonus = ${pctLabel(input.percent)} of bonus wages ${inr(bonusWages)} (monthly wages capped at ${inr(cap)}) = ${inr(amount)}`,
  };
}

/* ------------------------------------------------------------------ */
/* Leave encashment and notice pay (F&F)                               */
/* ------------------------------------------------------------------ */

/** monthly wage ÷ divisor × days, half-up to the paise. */
export function perDayAmount(monthlyWage: number, divisor: number, days: number, label: string) {
  if (monthlyWage < 0 || days < 0) throw new Error(`${label}: amounts and days cannot be negative`);
  if (divisor <= 0) throw new Error(`${label}: divisor must be positive`);
  const amount = divRound(BigInt(monthlyWage) * BigInt(Math.round(days * 100)), BigInt(divisor) * BigInt(100), "half_up_paise");
  return { amount, explanation: `${label} = ${inr(monthlyWage)} ÷ ${divisor} × ${daysLabel(days)} days = ${inr(amount)}` };
}

