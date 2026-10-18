/**
 * Deterministic payroll engine for one employee and one period. Pure: no
 * database, clock or I/O. Same input → same output, byte for byte.
 *
 * Invalid input (negative CTC, over-allocated structure, missing statutory
 * parameters, bad one-off amounts) throws PayrollValidationError with explicit
 * messages; the engine never silently produces zero pay.
 */
import { daysLabel, inr, prorate, sum } from "./money";
import { ageOn, fyStartYearOf } from "./dates";
import { PayrollValidationError, resolveStructure, type ResolvedStructure } from "./structure";
import { calculateEsi, calculateLwf, calculatePf, calculatePt } from "./statutory";
import { computeMonthlyTds } from "./tax";
import {
  DEDUCTION_INPUT_KINDS,
  type ComponentDef,
  type ComponentKind,
  type EngineInput,
  type EngineResult,
  type Message,
  type PayLine,
  type StatutoryBreakdown,
} from "./types";

export { PayrollValidationError };

const PAID = new Set<ComponentKind>(["earning", "reimbursement"]);
const DEDUCTING = new Set<ComponentKind>(["deduction", "statutory_deduction"]);

const DEFAULTS: Record<string, { name: string; kind: ComponentKind; sortOrder: number }> = {
  PF_EE: { name: "Provident fund (employee)", kind: "statutory_deduction", sortOrder: 200 },
  ESI_EE: { name: "ESI (employee)", kind: "statutory_deduction", sortOrder: 210 },
  PT: { name: "Professional tax", kind: "statutory_deduction", sortOrder: 220 },
  LWF_EE: { name: "Labour welfare fund (employee)", kind: "statutory_deduction", sortOrder: 230 },
  TDS: { name: "Income tax (TDS)", kind: "statutory_deduction", sortOrder: 240 },
  LOAN: { name: "Loan / advance recovery", kind: "deduction", sortOrder: 260 },
  LOP: { name: "Loss of pay", kind: "deduction", sortOrder: 199 },
  PF_ER: { name: "Provident fund (employer)", kind: "employer_contribution", sortOrder: 300 },
  ESI_ER: { name: "ESI (employer)", kind: "employer_contribution", sortOrder: 310 },
  LWF_ER: { name: "Labour welfare fund (employer)", kind: "employer_contribution", sortOrder: 330 },
};

function validateInput(input: EngineInput, comps: Map<string, ComponentDef>) {
  const issues: string[] = [];
  const d = input.days;
  if (!Number.isInteger(input.annualCtc) || input.annualCtc < 0) issues.push(`Annual CTC must be a non-negative whole number of paise (got ${input.annualCtc}).`);
  if (!input.skipSalary && input.annualCtc <= 0) issues.push("Annual CTC must be positive.");
  if (!(d.calendarDays > 0)) issues.push("The period has no calendar days.");
  if (d.employedDays < 0 || d.employedDays > d.calendarDays) issues.push("Employed days must be between 0 and the calendar days in the period.");
  if (d.payableDays < 0 || d.payableDays > d.employedDays) issues.push(`Payable days (${d.payableDays}) must be between 0 and the employed days (${d.employedDays}).`);
  if (d.lopDays < 0) issues.push("Loss-of-pay days cannot be negative.");
  if (!input.skipSalary && !input.structure) issues.push("No salary structure is assigned.");
  if (input.profile.pfApplicable && !input.statutory.pf) issues.push("No PF rule set is effective for this period.");
  if (!input.statutory.esi) issues.push("No ESI rule set is effective for this period.");
  if (!input.statutory.incomeTax) issues.push("No income tax rule set is effective for this period.");
  for (const o of input.oneOffs) {
    const c = comps.get(o.componentCode);
    if (!Number.isInteger(o.amount) || o.amount <= 0) issues.push(`One-off ${o.kind} for ${o.componentCode} must be a positive amount (got ${o.amount}).`);
    if (!c) issues.push(`One-off input uses unknown component ${o.componentCode}.`);
    else if (DEDUCTION_INPUT_KINDS.includes(o.kind) ? !DEDUCTING.has(c.kind) : !PAID.has(c.kind)) {
      issues.push(`One-off ${o.kind} cannot be posted to ${c.code}, a ${c.kind.replace(/_/g, " ")} component.`);
    }
  }
  for (const l of input.loans) {
    if (!Number.isInteger(l.installment) || l.installment <= 0) issues.push(`Loan installment must be positive (loan ${l.loanId}).`);
    if (l.outstanding < 0) issues.push(`Loan outstanding cannot be negative (loan ${l.loanId}).`);
  }
  if (issues.length) throw new PayrollValidationError(issues);
}

export function calculateEmployeePay(input: EngineInput): EngineResult {
  const comps = new Map(input.components.map((c) => [c.code, c]));
  validateInput(input, comps);
  const { days, period, profile } = input;
  const messages: Message[] = [];
  const lines: PayLine[] = [];
  const statutory: StatutoryBreakdown = {};
  const ageAtPeriodEnd = input.employee.dateOfBirth ? ageOn(input.employee.dateOfBirth, period.endDate) : null;

  const push = (code: string, amount: number, explanation: string, opts: { kind?: ComponentKind; isTaxable?: boolean; name?: string } = {}) => {
    const c = comps.get(code);
    const d = DEFAULTS[code];
    lines.push({
      componentCode: code,
      componentName: opts.name ?? c?.payslipLabel ?? c?.name ?? d?.name ?? code,
      kind: opts.kind ?? c?.kind ?? d?.kind ?? "earning",
      amount,
      isTaxable: opts.isTaxable ?? c?.isTaxable ?? true,
      explanation,
      sortOrder: c?.sortOrder ?? d?.sortOrder ?? 500,
    });
  };

  /* -------------------- Salary from the structure -------------------- */
  let structure: ResolvedStructure | null = null;
  let regularTaxable = 0;
  let oneOffTaxable = 0;
  if (!input.skipSalary && input.structure) {
    structure = resolveStructure(input.annualCtc, input.structure.lines, input.components, {
      pf: input.statutory.pf,
      pfApplicable: profile.pfApplicable,
      pfWageBasis: profile.pfWageBasis,
      epsEligible: profile.epsEligible,
      ageYears: ageAtPeriodEnd,
    });
    for (const m of structure.messages) messages.push({ severity: "warning", code: "structure", message: m });
    const full = days.payableDays === days.calendarDays;
    for (const r of [...structure.earnings, ...structure.employerLines]) {
      if (r.monthly === 0) continue;
      const earned = r.component.prorate ? prorate(r.monthly, days.payableDays, days.calendarDays) : days.employedDays > 0 ? r.monthly : 0;
      const how = r.component.prorate
        ? full
          ? " (full month)"
          : ` × ${daysLabel(days.payableDays)}/${days.calendarDays} payable days = ${inr(earned)}`
        : " (not prorated)";
      push(r.code, earned, `${r.name} = ${r.basis} = ${inr(r.monthly)}${how}`, { kind: r.component.kind, isTaxable: r.component.isTaxable, name: r.name });
      if (PAID.has(r.component.kind) && r.component.isTaxable) regularTaxable += earned;
    }
    if (days.lopDays > 0) {
      const lopValue = sum(
        structure.earnings.filter((r) => r.component.prorate).map((r) => prorate(r.monthly, days.employedDays, days.calendarDays) - prorate(r.monthly, days.payableDays, days.calendarDays)),
      );
      push("LOP", 0, `Loss of pay: ${daysLabel(days.lopDays)} day${days.lopDays === 1 ? "" : "s"} (${days.source === "attendance" ? "from attendance" : "from approved unpaid leave"}); earnings above are already reduced by ${inr(lopValue)}`, { kind: "deduction", isTaxable: false });
    }
    if (days.payableDays === 0) messages.push({ severity: "warning", code: "no_payable_days", message: "No payable days in this period." });
  }

  /* -------------------- One-off earnings -------------------- */
  for (const o of input.oneOffs.filter((x) => !DEDUCTION_INPUT_KINDS.includes(x.kind))) {
    const c = comps.get(o.componentCode)!;
    push(c.code, o.amount, o.explanation ?? `${c.payslipLabel || c.name} (one-off ${o.kind.replace(/_/g, " ")}${o.note ? `: ${o.note}` : ""}) = ${inr(o.amount)}`, { kind: c.kind, isTaxable: o.isTaxable });
    if (o.isTaxable) oneOffTaxable += o.amount;
  }

  const paidLines = () => lines.filter((l) => PAID.has(l.kind));
  const wageOf = (flag: "pfWage" | "esiWage" | "ptWage") => sum(paidLines().filter((l) => comps.get(l.componentCode)?.[flag]).map((l) => l.amount));
  const grossEarnings = sum(paidLines().map((l) => l.amount));

  /* -------------------- PF -------------------- */
  let pfEmployee = 0;
  let fullMonthPfEmployee = 0;
  const pfWage = wageOf("pfWage");
  if (!profile.pfApplicable) messages.push({ severity: "info", code: "pf_not_applicable", message: "PF is not applicable to this employee." });
  else if (input.statutory.pf && pfWage > 0) {
    const pf = calculatePf(input.statutory.pf, { pfWage, wageBasis: profile.pfWageBasis, epsEligible: profile.epsEligible, ageYears: ageAtPeriodEnd });
    pfEmployee = pf.employee;
    if (pf.employee) push("PF_EE", pf.employee, pf.explanationEmployee, { kind: "statutory_deduction", isTaxable: false });
    if (pf.employer) push("PF_ER", pf.employer, pf.explanationEmployer, { kind: "employer_contribution", isTaxable: false });
    statutory.pf = { wage: pf.wage, employeeWage: pf.employeeWage, employerWage: pf.employerWage, epsWage: pf.epsWage, employee: pf.employee, eps: pf.eps, epf: pf.epf };
  }
  if (profile.pfApplicable && input.statutory.pf && structure) {
    const fullPfWage = sum(structure.earnings.filter((r) => r.component.pfWage).map((r) => r.monthly));
    fullMonthPfEmployee = fullPfWage > 0 ? calculatePf(input.statutory.pf, { pfWage: fullPfWage, wageBasis: profile.pfWageBasis, epsEligible: profile.epsEligible, ageYears: ageAtPeriodEnd }).employee : 0;
  }

  /* -------------------- ESI -------------------- */
  if (input.statutory.esi) {
    const rateOfWages = structure ? sum(structure.earnings.filter((r) => r.component.esiWage).map((r) => r.monthly)) : 0;
    const earned = wageOf("esiWage");
    const esi = calculateEsi(input.statutory.esi, { rateOfWages, earnedWages: earned, continuing: profile.esiContinuing });
    statutory.esi = { covered: esi.covered, rateOfWages, wages: earned, employee: esi.employee, employer: esi.employer };
    if (esi.employee) push("ESI_EE", esi.employee, esi.explanationEmployee, { kind: "statutory_deduction", isTaxable: false });
    if (esi.employer) push("ESI_ER", esi.employer, esi.explanationEmployer, { kind: "employer_contribution", isTaxable: false });
    if (!esi.covered && rateOfWages > 0) messages.push({ severity: "info", code: "esi_not_covered", message: `ESI not applicable: ${esi.reason}.` });
  }

  /* -------------------- Professional tax -------------------- */
  let professionalTax = 0;
  if (!profile.ptState) {
    messages.push({ severity: "warning", code: "pt_state_unknown", message: "Work state is unknown (no location or legal entity state); professional tax not deducted." });
  } else if (!input.statutory.pt) {
    messages.push({ severity: "info", code: "pt_not_configured", message: `No professional tax rule set for ${profile.ptState}; PT not deducted.` });
  } else {
    const ptWage = wageOf("ptWage");
    if (ptWage > 0) {
      const pt = calculatePt(input.statutory.pt, { ptWage, month: period.month, gender: input.employee.gender, state: profile.ptState });
      professionalTax = pt.amount;
      statutory.pt = { state: profile.ptState, wage: ptWage, amount: pt.amount };
      if (pt.amount) push("PT", pt.amount, pt.explanation, { kind: "statutory_deduction", isTaxable: false });
    }
  }

  /* -------------------- LWF -------------------- */
  if (profile.lwfState && input.statutory.lwf && grossEarnings > 0) {
    const lwf = calculateLwf(input.statutory.lwf, { wage: grossEarnings, month: period.month, state: profile.lwfState });
    if (lwf.employee) push("LWF_EE", lwf.employee, lwf.explanation, { kind: "statutory_deduction", isTaxable: false });
    if (lwf.employer) push("LWF_ER", lwf.employer, lwf.explanation, { kind: "employer_contribution", isTaxable: false });
    if (lwf.employee || lwf.employer) statutory.lwf = { state: profile.lwfState, employee: lwf.employee, employer: lwf.employer };
  }

  /* -------------------- Income tax (TDS) -------------------- */
  if (input.statutory.incomeTax) {
    const it = input.statutory.incomeTax;
    const fy = fyStartYearOf(period.year, period.month);
    if (it.fyStartYear !== fy) {
      messages.push({
        severity: "warning",
        code: "tax_rules_other_fy",
        message: `The income tax rule set is for FY ${it.fyStartYear}-${String((it.fyStartYear + 1) % 100).padStart(2, "0")}, but this period is in FY ${fy}-${String((fy + 1) % 100).padStart(2, "0")}. Load and verify the current year's slabs.`,
      });
    }
    const lineAmount = (code: string) => sum(lines.filter((l) => l.componentCode === code).map((l) => l.amount));
    const monthlyOf = (code: string) => structure?.earnings.find((r) => r.code === code)?.monthly ?? 0;
    const taxAge = input.employee.dateOfBirth ? ageOn(input.employee.dateOfBirth, `${fy + 1}-03-31`) : null;
    const tds = computeMonthlyTds(it, {
      regime: profile.taxRegime,
      ageYears: taxAge,
      month: period.month,
      lastMonth: !!days.exitedInPeriod || !!input.skipSalary,
      ytd: input.ytd,
      current: {
        regularTaxable,
        oneOffTaxable,
        pfEmployee,
        professionalTax,
        hra: lineAmount("HRA"),
        basic: lineAmount("BASIC"),
        fullMonthRegularTaxable: structure ? sum(structure.earnings.filter((r) => r.component.isTaxable).map((r) => r.monthly)) : 0,
        fullMonthPfEmployee,
        fullMonthHra: monthlyOf("HRA"),
        fullMonthBasic: monthlyOf("BASIC"),
      },
      previousEmployer: { income: profile.previousEmployerIncome, tds: profile.previousEmployerTds },
      declarations: profile.declarations,
    });
    statutory.tds = {
      regime: profile.taxRegime,
      projectedIncome: tds.projectedIncome,
      taxableIncome: tds.annualRegular.taxableIncome,
      annualTax: tds.annualWithOneOffs.total,
      alreadyDeducted: tds.alreadyDeducted,
      remainingMonths: tds.remainingMonths,
      amount: tds.amount,
    };
    if (tds.amount > 0) push("TDS", tds.amount, tds.explanation, { kind: "statutory_deduction", isTaxable: false });
    if (!profile.hasPan && tds.annualRegular.taxableIncome > 0) {
      messages.push({
        severity: "warning",
        code: "pan_missing",
        message: "PAN is missing: section 206AA may require TDS at a higher rate. Not applied automatically; collect the PAN or review manually.",
      });
    }
  }

  /* -------------------- Loans and one-off deductions -------------------- */
  for (const loan of input.loans) {
    const amount = Math.min(loan.installment, loan.outstanding);
    if (amount <= 0) continue;
    push("LOAN", amount, `${loan.kind === "loan" ? "Loan" : "Salary advance"} installment ${inr(amount)}; outstanding ${inr(loan.outstanding)} before, ${inr(loan.outstanding - amount)} after`, { kind: "deduction", isTaxable: false });
  }
  for (const o of input.oneOffs.filter((x) => DEDUCTION_INPUT_KINDS.includes(x.kind))) {
    const c = comps.get(o.componentCode)!;
    push(c.code, o.amount, o.explanation ?? `${c.payslipLabel || c.name} (${o.kind}${o.note ? `: ${o.note}` : ""}) = ${inr(o.amount)}`, { kind: c.kind, isTaxable: false });
  }

  /* -------------------- Totals -------------------- */
  lines.sort((a, b) => a.sortOrder - b.sortOrder || a.componentCode.localeCompare(b.componentCode) || a.explanation.localeCompare(b.explanation));
  const gross = sum(lines.filter((l) => PAID.has(l.kind)).map((l) => l.amount));
  const deductions = sum(lines.filter((l) => DEDUCTING.has(l.kind)).map((l) => l.amount));
  const employerContributions = sum(lines.filter((l) => l.kind === "employer_contribution").map((l) => l.amount));
  const net = gross - deductions;
  if (net < 0) {
    messages.push({ severity: "error", code: "negative_net", message: `Deductions (${inr(deductions)}) exceed earnings (${inr(gross)}). Reduce recoveries or loan installments, or hold this employee.` });
  }
  return {
    lines,
    gross,
    deductions,
    employerContributions,
    net,
    payableDays: days.payableDays,
    lopDays: days.lopDays,
    fullMonthGross: structure?.grossMonthly ?? 0,
    messages,
    statutory,
    explanation: `Gross ${inr(gross)} − deductions ${inr(deductions)} = net ${inr(net)}; ${daysLabel(days.payableDays)} of ${days.calendarDays} days payable${days.lopDays ? ` (${daysLabel(days.lopDays)} LOP)` : ""}.`,
  };
}
