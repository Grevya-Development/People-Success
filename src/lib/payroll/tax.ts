/**
 * Income tax on salary (TDS under section 192), old and new regimes.
 * All slab values, the standard deduction, rebate, surcharge and cess rates
 * come from the income_tax rule set.
 *
 * Documented simplifications:
 *  - Surcharge is computed with marginal relief at each threshold; the
 *    different surcharge caps for special-rate income are not modelled
 *    (salary income only).
 *  - Old regime: deductions are taken from the employee's declaration keys
 *    and capped by `deductionLimits`; keys without a limit (e.g. 80E) are
 *    allowed in full. Employee PF counts toward 80C. HRA exemption uses
 *    s.10(13A) with projected HRA and basic.
 *  - Annual taxable income and annual tax are rounded with `annualRounding`
 *    (default nearest ₹10, ss. 288A/288B); monthly TDS with `monthlyRounding`.
 */
import { divRound, inr, pctNum, PCT_DEN, percentOf, roundTo } from "./money";
import { fyMonthIndex } from "./dates";
import type { IncomeTaxParams, RegimeParams, TaxSlab } from "./params";

export const DECLARATION_FIELDS = [
  { key: "80C", label: "Section 80C investments (PPF, ELSS, LIC, tuition fees…)" },
  { key: "80CCD1B", label: "Section 80CCD(1B) additional NPS" },
  { key: "80D", label: "Section 80D health insurance premium" },
  { key: "24b", label: "Section 24(b) home loan interest (self-occupied)" },
  { key: "80E", label: "Section 80E education loan interest" },
  { key: "80TTA", label: "Section 80TTA savings interest" },
  { key: "rentPaid", label: "Annual rent paid (for HRA exemption)" },
] as const;

export type Regime = "new" | "old";

export function slabTax(slabs: TaxSlab[], income: number) {
  let lower = 0;
  let acc = BigInt(0);
  for (const s of slabs) {
    const upper = s.upTo ?? Number.MAX_SAFE_INTEGER;
    if (income > lower) acc += BigInt(Math.min(income, upper) - lower) * pctNum(s.rate);
    if (s.upTo === null || income <= upper) break;
    lower = upper;
  }
  return divRound(acc, PCT_DEN, "half_up_paise");
}

function slabsFor(r: RegimeParams, ageYears: number | null) {
  if (ageYears != null && ageYears >= 80 && r.superSeniorSlabs?.length) return { slabs: r.superSeniorSlabs, band: "super senior citizen" };
  if (ageYears != null && ageYears >= 60 && r.seniorSlabs?.length) return { slabs: r.seniorSlabs, band: "senior citizen" };
  return { slabs: r.slabs, band: null as string | null };
}

export type AnnualTaxInput = {
  regime: Regime;
  /** Annual taxable salary (projected) including previous-employer salary. */
  grossIncome: number;
  ageYears: number | null;
  professionalTax: number;
  employeePf: number;
  declarations: Record<string, number>;
  hra?: { received: number; basic: number; metro: boolean };
};

export type AnnualTaxResult = {
  regime: Regime;
  grossIncome: number;
  standardDeduction: number;
  hraExemption: number;
  deductions: { key: string; amount: number }[];
  taxableIncome: number;
  slabTax: number;
  rebate: number;
  surcharge: number;
  cess: number;
  total: number;
  ageBand: string | null;
};

export function computeAnnualTax(p: IncomeTaxParams, input: AnnualTaxInput): AnnualTaxResult {
  if (input.grossIncome < 0) throw new Error("Projected income cannot be negative");
  const r = p.regimes[input.regime];
  const standardDeduction = Math.min(r.standardDeduction, input.grossIncome);
  let hraExemption = 0;
  if (r.allowsHraExemption && input.hra && (input.declarations.rentPaid ?? 0) > 0) {
    const rentOverTenPct = Math.max(0, input.declarations.rentPaid - percentOf(input.hra.basic, 10));
    const pctOfBasic = percentOf(input.hra.basic, input.hra.metro ? 50 : 40);
    hraExemption = Math.max(0, Math.min(input.hra.received, rentOverTenPct, pctOfBasic));
  }
  const deductions: { key: string; amount: number }[] = [];
  if (r.allowsProfessionalTax && input.professionalTax > 0) deductions.push({ key: "16(iii) professional tax", amount: input.professionalTax });
  if (r.deductionLimits) {
    const limits = r.deductionLimits;
    for (const [key, raw] of Object.entries(input.declarations)) {
      if (key === "rentPaid" || key === "metro" || !(raw > 0)) continue;
      const declared = key === "80C" ? raw + input.employeePf : raw;
      const amount = limits[key] != null ? Math.min(declared, limits[key]) : declared;
      if (amount > 0) deductions.push({ key, amount });
    }
    if (!(input.declarations["80C"] > 0) && input.employeePf > 0) {
      const amount = limits["80C"] != null ? Math.min(input.employeePf, limits["80C"]) : input.employeePf;
      deductions.push({ key: "80C", amount });
    }
  }
  const totalDeductions = deductions.reduce((a, d) => a + d.amount, 0);
  const taxableIncome = roundTo(Math.max(0, input.grossIncome - standardDeduction - hraExemption - totalDeductions), p.annualRounding);
  const { slabs, band } = slabsFor(r, input.ageYears);
  const base = slabTax(slabs, taxableIncome);
  let rebate = 0;
  if (taxableIncome <= r.rebate.incomeUpTo) rebate = Math.min(base, r.rebate.maxRebate);
  else if (r.rebate.marginalRelief) {
    const excess = taxableIncome - r.rebate.incomeUpTo;
    if (base > excess) rebate = base - excess;
  }
  const tax = base - rebate;
  let surcharge = 0;
  const applicable = [...r.surcharge].sort((a, b) => a.above - b.above).filter((s) => taxableIncome > s.above);
  if (applicable.length) {
    const top = applicable.at(-1)!;
    const prevRate = applicable.length > 1 ? applicable.at(-2)!.rate : 0;
    surcharge = percentOf(tax, top.rate);
    // Marginal relief: tax + surcharge may not exceed tax (incl. surcharge at the
    // previous rate) at the threshold plus the income above the threshold.
    const atThreshold = slabTax(slabs, top.above);
    const limit = atThreshold + percentOf(atThreshold, prevRate) + (taxableIncome - top.above);
    if (tax + surcharge > limit) surcharge = Math.max(0, limit - tax);
  }
  const cess = percentOf(tax + surcharge, r.cessRate);
  const total = roundTo(tax + surcharge + cess, p.annualRounding);
  return { regime: input.regime, grossIncome: input.grossIncome, standardDeduction, hraExemption, deductions, taxableIncome, slabTax: base, rebate, surcharge, cess, total, ageBand: band };
}

export type MonthlyTdsInput = {
  regime: Regime;
  ageYears: number | null;
  month: number;
  /** No salary months after this one (exit in this period). */
  lastMonth: boolean;
  ytd: { taxableEarnings: number; tds: number; pfEmployee: number; professionalTax: number; hra: number; basic: number };
  current: {
    regularTaxable: number;
    oneOffTaxable: number;
    pfEmployee: number;
    professionalTax: number;
    hra: number;
    basic: number;
    /** Full-month (unprorated) recurring taxable pay used to project future months. */
    fullMonthRegularTaxable: number;
    fullMonthPfEmployee: number;
    fullMonthHra: number;
    fullMonthBasic: number;
  };
  previousEmployer: { income: number; tds: number };
  declarations: Record<string, number>;
};

export type MonthlyTdsResult = {
  amount: number;
  remainingMonths: number;
  projectedIncome: number;
  annualRegular: AnnualTaxResult;
  annualWithOneOffs: AnnualTaxResult;
  alreadyDeducted: number;
  explanation: string;
};

/**
 * Projects annual salary (YTD + this month + remaining months at the current
 * full-month rate + previous employer), computes annual tax, subtracts tax
 * already deducted and spreads the balance evenly over the remaining months
 * of the financial year including this one. Tax attributable to one-off
 * taxable pay this month is deducted in full this month.
 */
export function computeMonthlyTds(p: IncomeTaxParams, input: MonthlyTdsInput): MonthlyTdsResult {
  const remainingMonths = 12 - fyMonthIndex(input.month) + 1;
  const future = input.lastMonth ? 0 : remainingMonths - 1;
  const c = input.current;
  const projectedIncome = input.ytd.taxableEarnings + c.regularTaxable + future * c.fullMonthRegularTaxable + input.previousEmployer.income;
  const shared = {
    regime: input.regime,
    ageYears: input.ageYears,
    professionalTax: input.ytd.professionalTax + c.professionalTax * (1 + future),
    employeePf: input.ytd.pfEmployee + c.pfEmployee + future * c.fullMonthPfEmployee,
    declarations: input.declarations,
    hra: {
      received: input.ytd.hra + c.hra + future * c.fullMonthHra,
      basic: input.ytd.basic + c.basic + future * c.fullMonthBasic,
      metro: (input.declarations.metro ?? 0) > 0,
    },
  };
  const annualRegular = computeAnnualTax(p, { ...shared, grossIncome: projectedIncome });
  const annualWithOneOffs = c.oneOffTaxable > 0 ? computeAnnualTax(p, { ...shared, grossIncome: projectedIncome + c.oneOffTaxable }) : annualRegular;
  const alreadyDeducted = input.ytd.tds + input.previousEmployer.tds;
  const remainingRegular = Math.max(0, annualRegular.total - alreadyDeducted);
  const remainingWith = Math.max(0, annualWithOneOffs.total - alreadyDeducted);
  const regularPart = divRound(BigInt(remainingRegular), BigInt(remainingMonths), p.monthlyRounding);
  const oneOffPart = roundTo(remainingWith - remainingRegular, p.monthlyRounding);
  const amount = regularPart + oneOffPart;
  const ded = annualRegular.standardDeduction + annualRegular.hraExemption + annualRegular.deductions.reduce((a, d) => a + d.amount, 0);
  const explanation =
    `TDS (${input.regime} regime${annualRegular.ageBand ? `, ${annualRegular.ageBand}` : ""}): projected taxable salary ${inr(projectedIncome)}` +
    ` − deductions ${inr(ded)} = taxable income ${inr(annualRegular.taxableIncome)}; annual tax ${inr(annualRegular.total)}` +
    (annualRegular.rebate ? ` after rebate ${inr(annualRegular.rebate)}` : "") +
    ` incl. cess; already deducted ${inr(alreadyDeducted)}; ${inr(remainingRegular)} ÷ ${remainingMonths} remaining month${remainingMonths === 1 ? "" : "s"} = ${inr(regularPart)}` +
    (oneOffPart ? `; plus ${inr(oneOffPart)} on one-off taxable pay of ${inr(c.oneOffTaxable)}` : "");
  return { amount, remainingMonths, projectedIncome, annualRegular, annualWithOneOffs, alreadyDeducted, explanation };
}
