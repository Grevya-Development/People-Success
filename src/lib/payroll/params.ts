import { z } from "zod";
import { ROUNDING_MODES } from "./money";

/**
 * Statutory rule-set parameter schemas, one per kind. Amounts are integer
 * paise; rates are percentages (12 = 12%). These are configuration, not code:
 * every value the calculators use comes from a validated rule set.
 */

export const RULE_KINDS = ["pf", "esi", "pt", "lwf", "income_tax", "gratuity", "bonus"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const RULE_KIND_LABELS: Record<RuleKind, string> = {
  pf: "Provident fund",
  esi: "Employees' State Insurance",
  pt: "Professional tax",
  lwf: "Labour welfare fund",
  income_tax: "Income tax (TDS on salary)",
  gratuity: "Gratuity",
  bonus: "Statutory bonus",
};

const paise = z.number().int("Amounts are integer paise").nonnegative("Amounts cannot be negative");
const rate = z.number().min(0, "Rates cannot be negative").max(100, "Rates are percentages (0–100)");
const rounding = z.enum(ROUNDING_MODES);
const month = z.number().int().min(1).max(12);

export const pfParamsSchema = z.object({
  employeeRate: rate,
  employerRate: rate,
  /** Part of the employer share that goes to the pension scheme (EPS). */
  epsRate: rate,
  /** Monthly PF wage ceiling (statutory: ₹15,000). */
  wageCeiling: paise,
  /** Monthly EPS wage ceiling. */
  epsWageCeiling: paise,
  /** EPS contributions stop at this age. */
  epsMaxAge: z.number().int().min(1).max(120),
  /** Employer contributes on the capped wage even when the employee chose actual wages. */
  employerAlwaysCapped: z.boolean(),
  rounding,
});
export type PfParams = z.infer<typeof pfParamsSchema>;

export const esiParamsSchema = z.object({
  employeeRate: rate,
  employerRate: rate,
  /** Coverage threshold on monthly rate of ESI wages (inclusive). */
  wageThreshold: paise,
  rounding,
  /** Contribution periods; coverage continues to the end of the period once covered. */
  contributionPeriods: z.array(z.object({ startMonth: month, endMonth: month })).min(1),
});
export type EsiParams = z.infer<typeof esiParamsSchema>;

const ptSlab = z.object({
  /** Inclusive upper bound of the wage band in paise; null = no upper bound. */
  upTo: paise.nullable(),
  amount: paise,
  /** Month-specific amounts, e.g. { "2": 30000 } for a February top-up. */
  monthAmounts: z.record(z.string().regex(/^(1[0-2]|[1-9])$/), paise).optional(),
});
export type PtSlab = z.infer<typeof ptSlab>;

const ascendingSlabs = <T extends { upTo: number | null }>(slabs: T[]) =>
  slabs.every((s, i) => (i === slabs.length - 1 ? s.upTo === null : s.upTo !== null && (i === 0 || s.upTo > (slabs[i - 1].upTo ?? 0))));
const slabMessage = "Slabs must be in ascending order and the last slab must have no upper bound (upTo: null).";

export const ptParamsSchema = z.object({
  /** monthly: every month; half_yearly / annual: deducted in deductionMonths on projected wages. */
  periodicity: z.enum(["monthly", "half_yearly", "annual"]),
  deductionMonths: z.array(month).optional(),
  slabs: z.array(ptSlab).min(1).refine(ascendingSlabs, slabMessage),
  slabsByGender: z.object({ female: z.array(ptSlab).min(1).refine(ascendingSlabs, slabMessage).optional() }).optional(),
});
export type PtParams = z.infer<typeof ptParamsSchema>;

const lwfSlab = z.object({ upTo: paise.nullable(), employee: paise, employer: paise });
export const lwfParamsSchema = z.object({
  deductionMonths: z.array(month).min(1),
  slabs: z.array(lwfSlab).min(1).refine(ascendingSlabs, slabMessage),
});
export type LwfParams = z.infer<typeof lwfParamsSchema>;

const taxSlab = z.object({ upTo: paise.nullable(), rate });
export type TaxSlab = z.infer<typeof taxSlab>;
const regime = z.object({
  standardDeduction: paise,
  slabs: z.array(taxSlab).min(1).refine(ascendingSlabs, slabMessage),
  seniorSlabs: z.array(taxSlab).refine(ascendingSlabs, slabMessage).optional(),
  superSeniorSlabs: z.array(taxSlab).refine(ascendingSlabs, slabMessage).optional(),
  rebate: z.object({ incomeUpTo: paise, maxRebate: paise, marginalRelief: z.boolean() }),
  surcharge: z.array(z.object({ above: paise, rate })),
  cessRate: rate,
  /** Chapter VI-A and other deductions allowed (old regime). Limits in paise per declaration key. */
  deductionLimits: z.record(z.string(), paise).optional(),
  allowsProfessionalTax: z.boolean(),
  allowsHraExemption: z.boolean(),
});
export type RegimeParams = z.infer<typeof regime>;

export const incomeTaxParamsSchema = z.object({
  fyStartYear: z.number().int().min(2000).max(2100),
  regimes: z.object({ new: regime, old: regime }),
  /** Rounding of total income (s.288A) and tax (s.288B). */
  annualRounding: rounding,
  monthlyRounding: rounding,
});
export type IncomeTaxParams = z.infer<typeof incomeTaxParamsSchema>;

export const gratuityParamsSchema = z.object({
  daysFactor: z.number().positive(),
  monthDays: z.number().int().positive(),
  minYears: z.number().int().nonnegative(),
  /** A part-year longer than this many months counts as a full year. */
  roundUpMonthsAbove: z.number().int().min(0).max(11),
  cap: paise,
  rounding,
});
export type GratuityParams = z.infer<typeof gratuityParamsSchema>;

export const bonusParamsSchema = z.object({
  eligibilityWageCeiling: paise,
  calculationWageCeiling: paise,
  minPercent: rate,
  maxPercent: rate,
  minDaysWorked: z.number().int().nonnegative(),
  rounding,
});
export type BonusParams = z.infer<typeof bonusParamsSchema>;

export const RULE_PARAM_SCHEMAS: Record<RuleKind, z.ZodType> = {
  pf: pfParamsSchema,
  esi: esiParamsSchema,
  pt: ptParamsSchema,
  lwf: lwfParamsSchema,
  income_tax: incomeTaxParamsSchema,
  gratuity: gratuityParamsSchema,
  bonus: bonusParamsSchema,
};

export type RuleParamsByKind = {
  pf: PfParams;
  esi: EsiParams;
  pt: PtParams;
  lwf: LwfParams;
  income_tax: IncomeTaxParams;
  gratuity: GratuityParams;
  bonus: BonusParams;
};

/** Validate parameters for a kind; returns readable issues instead of throwing. */
export function validateRuleParameters(kind: string, parameters: unknown): { ok: true } | { ok: false; issues: string[] } {
  if (!(RULE_KINDS as readonly string[]).includes(kind)) return { ok: false, issues: [`Unknown rule kind "${kind}".`] };
  const res = RULE_PARAM_SCHEMAS[kind as RuleKind].safeParse(parameters);
  if (res.success) {
    if (kind === "pf") {
      const p = res.data as PfParams;
      if (p.epsRate > p.employerRate) return { ok: false, issues: ["epsRate cannot exceed employerRate."] };
    }
    if (kind === "bonus") {
      const p = res.data as BonusParams;
      if (p.minPercent > p.maxPercent) return { ok: false, issues: ["minPercent cannot exceed maxPercent."] };
    }
    return { ok: true };
  }
  return { ok: false, issues: res.error.issues.map((i) => `${i.path.join(".") || "parameters"}: ${i.message}`) };
}

/** Parse parameters for a kind or throw with readable issues. */
export function parseRuleParameters<K extends RuleKind>(kind: K, parameters: unknown): RuleParamsByKind[K] {
  const v = validateRuleParameters(kind, parameters);
  if (!v.ok) throw new Error(`Invalid ${RULE_KIND_LABELS[kind]} parameters: ${v.issues.join("; ")}`);
  return RULE_PARAM_SCHEMAS[kind].parse(parameters) as RuleParamsByKind[K];
}
