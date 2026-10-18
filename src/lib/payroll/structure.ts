/**
 * Salary structure resolution: turns annual CTC + structure lines into
 * full-month component amounts.
 *
 * Order: fixed and %-of-CTC lines, then %-of-basic, then the employer share
 * of PF that is part of CTC (estimated at full attendance), then %-of-gross,
 * then the single balancing line. Monthly gross = (CTC − employer costs
 * inside CTC) ÷ 12. The balancing line receives monthly gross minus the other
 * monthly earning amounts, so a full month always adds up exactly.
 *
 * Employer ESI is always treated as a cost outside CTC (avoids a circular
 * dependency between coverage and gross); see docs/PAYROLL.md.
 */
import { divRound, inr, pctLabel, percentOf, sum } from "./money";
import type { PfParams } from "./params";
import type { ComponentDef, StructureLine } from "./types";
import { calculatePf } from "./statutory";

export class PayrollValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(issues.join(" "));
    this.name = "PayrollValidationError";
    this.issues = issues;
  }
}

export type ResolvedLine = {
  code: string;
  name: string;
  component: ComponentDef;
  calculation: StructureLine["calculation"];
  value: number | null;
  annual: number;
  monthly: number;
  /** How the full-month amount was derived. */
  basis: string;
};

export type ResolvedStructure = {
  lines: ResolvedLine[];
  /** Earning and reimbursement lines (paid to the employee). */
  earnings: ResolvedLine[];
  /** Employer-contribution lines from the structure (inside CTC). */
  employerLines: ResolvedLine[];
  annualCtc: number;
  grossAnnual: number;
  grossMonthly: number;
  employerPfInCtcMonthly: number;
  messages: string[];
};

const PAID_KINDS = new Set(["earning", "reimbursement"]);

export function validateStructureLines(lines: StructureLine[], components: Map<string, ComponentDef>): string[] {
  const issues: string[] = [];
  if (!lines.length) issues.push("The salary structure has no lines.");
  const seen = new Set<string>();
  let balancing = 0;
  for (const l of lines) {
    const c = components.get(l.componentCode);
    if (!c) {
      issues.push(`Component ${l.componentCode} does not exist or is inactive.`);
      continue;
    }
    if (seen.has(l.componentCode)) issues.push(`Component ${l.componentCode} appears more than once.`);
    seen.add(l.componentCode);
    if (!PAID_KINDS.has(c.kind) && c.kind !== "employer_contribution") {
      issues.push(`${c.code} is a ${c.kind.replace(/_/g, " ")} component; structures contain earnings, reimbursements and employer contributions only.`);
    }
    if (l.calculation === "balancing") {
      balancing++;
      if (!PAID_KINDS.has(c.kind)) issues.push(`The balancing line (${c.code}) must be an earning.`);
      if (l.value != null && l.value !== 0) issues.push(`The balancing line (${c.code}) takes no value.`);
    } else {
      if (l.value == null || !Number.isFinite(l.value)) issues.push(`${c.code}: enter a value.`);
      else if (l.value < 0) issues.push(`${c.code}: the value cannot be negative.`);
      else if (l.calculation !== "fixed" && l.value > 100) issues.push(`${c.code}: a percentage cannot exceed 100.`);
      else if (l.calculation === "fixed" && !Number.isInteger(l.value)) issues.push(`${c.code}: fixed amounts are whole paise.`);
    }
    if ((l.calculation === "percent_of_gross" || l.calculation === "balancing") && c.pfWage) {
      issues.push(`${c.code} counts toward PF wages, so it cannot be ${l.calculation === "balancing" ? "the balancing line" : "a percentage of gross"} (PF inside CTC depends on it).`);
    }
    if (l.calculation === "percent_of_gross" && c.kind === "employer_contribution") {
      issues.push(`${c.code}: employer contributions cannot be a percentage of gross.`);
    }
    if (l.calculation === "percent_of_basic" && l.componentCode === "BASIC") issues.push("BASIC cannot be a percentage of itself.");
  }
  if (balancing > 1) issues.push("Only one balancing line is allowed.");
  if (lines.some((l) => l.calculation === "percent_of_basic") && !lines.some((l) => l.componentCode === "BASIC" && l.calculation !== "percent_of_basic")) {
    issues.push("Lines that are a percentage of basic need a BASIC line.");
  }
  return issues;
}

export function resolveStructure(
  annualCtc: number,
  lines: StructureLine[],
  components: ComponentDef[],
  opts: { pf: PfParams | null; pfApplicable: boolean; pfWageBasis: "capped" | "actual"; epsEligible: boolean; ageYears: number | null },
): ResolvedStructure {
  if (!Number.isInteger(annualCtc)) throw new PayrollValidationError(["Annual CTC must be whole paise."]);
  if (annualCtc <= 0) throw new PayrollValidationError([`Annual CTC must be positive (got ${inr(annualCtc)}).`]);
  const byCode = new Map(components.map((c) => [c.code, c]));
  const issues = validateStructureLines(lines, byCode);
  if (issues.length) throw new PayrollValidationError(issues);

  const resolved = new Map<string, ResolvedLine>();
  const make = (l: StructureLine, annual: number, basis: string): ResolvedLine => {
    const c = byCode.get(l.componentCode)!;
    return { code: c.code, name: c.payslipLabel || c.name, component: c, calculation: l.calculation, value: l.value, annual, monthly: divRound(BigInt(annual), BigInt(12)), basis };
  };

  for (const l of lines) {
    if (l.calculation === "fixed") resolved.set(l.componentCode, make(l, l.value!, `fixed ${inr(l.value!)} a year ÷ 12`));
    if (l.calculation === "percent_of_ctc") {
      const annual = percentOf(annualCtc, l.value!);
      resolved.set(l.componentCode, make(l, annual, `${pctLabel(l.value!)} of CTC ${inr(annualCtc)} ÷ 12`));
    }
  }
  const basic = resolved.get("BASIC");
  for (const l of lines) {
    if (l.calculation !== "percent_of_basic") continue;
    if (!basic) throw new PayrollValidationError(["BASIC must be fixed or a percentage of CTC when other lines are a percentage of basic."]);
    const annual = percentOf(basic.annual, l.value!);
    resolved.set(l.componentCode, make(l, annual, `${pctLabel(l.value!)} of basic ${inr(basic.annual)} a year ÷ 12`));
  }

  // Employer PF inside CTC, estimated at full attendance on full-month PF wages.
  const messages: string[] = [];
  let employerPfInCtcMonthly = 0;
  const pfEr = byCode.get("PF_ER");
  if (pfEr?.isPartOfCtc && opts.pfApplicable) {
    if (!opts.pf) throw new PayrollValidationError(["Employer PF is part of CTC but no PF rule set applies to this period."]);
    const pfWage = sum([...resolved.values()].filter((r) => r.component.pfWage && PAID_KINDS.has(r.component.kind)).map((r) => r.monthly));
    employerPfInCtcMonthly = calculatePf(opts.pf, { pfWage, wageBasis: opts.pfWageBasis, epsEligible: opts.epsEligible, ageYears: opts.ageYears }).employer;
  }
  const esiEr = byCode.get("ESI_ER");
  if (esiEr?.isPartOfCtc) messages.push("ESI_ER is marked as part of CTC, but employer ESI is always treated as a cost over and above CTC.");

  const employerFromLines = sum([...resolved.values()].filter((r) => r.component.kind === "employer_contribution").map((r) => r.annual));
  const grossAnnual = annualCtc - employerPfInCtcMonthly * 12 - employerFromLines;
  if (grossAnnual < 0) {
    throw new PayrollValidationError([`Employer contributions inside CTC (${inr(employerPfInCtcMonthly * 12 + employerFromLines)} a year) exceed the CTC of ${inr(annualCtc)}.`]);
  }
  for (const l of lines) {
    if (l.calculation !== "percent_of_gross") continue;
    const annual = percentOf(grossAnnual, l.value!);
    resolved.set(l.componentCode, make(l, annual, `${pctLabel(l.value!)} of gross ${inr(grossAnnual)} a year ÷ 12`));
  }

  const grossMonthly = divRound(BigInt(grossAnnual), BigInt(12));
  const paidSoFar = [...resolved.values()].filter((r) => PAID_KINDS.has(r.component.kind));
  const allocatedAnnual = sum(paidSoFar.map((r) => r.annual));
  const allocatedMonthly = sum(paidSoFar.map((r) => r.monthly));
  if (allocatedAnnual > grossAnnual) {
    throw new PayrollValidationError([
      `The structure allocates ${inr(allocatedAnnual)} a year, which exceeds the gross available of ${inr(grossAnnual)} (CTC ${inr(annualCtc)} less employer costs inside CTC) by ${inr(allocatedAnnual - grossAnnual)}.`,
    ]);
  }
  const balancingLine = lines.find((l) => l.calculation === "balancing");
  if (balancingLine) {
    const monthly = Math.max(0, grossMonthly - allocatedMonthly);
    const c = byCode.get(balancingLine.componentCode)!;
    resolved.set(c.code, {
      code: c.code,
      name: c.payslipLabel || c.name,
      component: c,
      calculation: "balancing",
      value: null,
      annual: grossAnnual - allocatedAnnual,
      monthly,
      basis: `balance of monthly gross ${inr(grossMonthly)} after other components`,
    });
  } else if (allocatedAnnual < grossAnnual) {
    messages.push(`The structure has no balancing line; ${inr(grossAnnual - allocatedAnnual)} a year of CTC is not allocated to any component.`);
  }

  const ordered = lines.map((l) => resolved.get(l.componentCode)!).sort((a, b) => a.component.sortOrder - b.component.sortOrder);
  return {
    lines: ordered,
    earnings: ordered.filter((r) => PAID_KINDS.has(r.component.kind)),
    employerLines: ordered.filter((r) => r.component.kind === "employer_contribution"),
    annualCtc,
    grossAnnual,
    grossMonthly,
    employerPfInCtcMonthly,
    messages,
  };
}
