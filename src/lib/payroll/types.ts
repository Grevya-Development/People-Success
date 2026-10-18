import type { EsiParams, IncomeTaxParams, LwfParams, PfParams, PtParams } from "./params";

export const ENGINE_VERSION = "ps-payroll-engine@1.0.0";

export type ComponentKind = "earning" | "deduction" | "employer_contribution" | "reimbursement" | "statutory_deduction";
export type ComponentCalc = "fixed" | "percent_of_ctc" | "percent_of_basic" | "percent_of_gross" | "balancing" | "statutory" | "input";
export type StructureCalc = "fixed" | "percent_of_ctc" | "percent_of_basic" | "percent_of_gross" | "balancing";

export type ComponentDef = {
  code: string;
  name: string;
  kind: ComponentKind;
  calculation: ComponentCalc;
  isTaxable: boolean;
  isPartOfCtc: boolean;
  pfWage: boolean;
  esiWage: boolean;
  ptWage: boolean;
  prorate: boolean;
  payslipLabel?: string | null;
  sortOrder: number;
};

export type StructureLine = {
  componentCode: string;
  calculation: StructureCalc;
  /** Percent, or annual fixed amount in paise. */
  value: number | null;
};

export type Message = { severity: "info" | "warning" | "error"; code: string; message: string };

export type PayLine = {
  componentCode: string;
  componentName: string;
  kind: ComponentKind;
  amount: number;
  isTaxable: boolean;
  explanation: string;
  sortOrder: number;
};

export type InputKind =
  | "bonus"
  | "incentive"
  | "commission"
  | "arrear"
  | "overtime"
  | "reimbursement"
  | "deduction"
  | "recovery"
  | "referral_reward"
  | "leave_encashment"
  | "other_earning";

export const DEDUCTION_INPUT_KINDS: InputKind[] = ["deduction", "recovery"];

export type OneOffInput = {
  id?: string;
  kind: InputKind;
  componentCode: string;
  amount: number;
  isTaxable: boolean;
  note?: string | null;
  /** Overrides the default explanation (used for F&F settlement items). */
  explanation?: string;
};

export type LoanInstallment = { loanId: string; kind: string; installment: number; outstanding: number };

export type DaysSummary = {
  calendarDays: number;
  employedDays: number;
  payableDays: number;
  lopDays: number;
  windowStart: string;
  windowEnd: string;
  joinedInPeriod: string | null;
  exitedInPeriod: string | null;
  source: "attendance" | "unpaid_leave" | "none";
};

export type StatutoryProfile = {
  pfApplicable: boolean;
  pfWageBasis: "capped" | "actual";
  epsEligible: boolean;
  esiContinuing: boolean;
  ptState: string | null;
  lwfState: string | null;
  taxRegime: "new" | "old";
  declarations: Record<string, number>;
  previousEmployerIncome: number;
  previousEmployerTds: number;
  hasPan: boolean;
};

export type Ytd = {
  monthsProcessed: number;
  taxableEarnings: number;
  tds: number;
  pfEmployee: number;
  professionalTax: number;
  hra: number;
  basic: number;
};

export const EMPTY_YTD: Ytd = { monthsProcessed: 0, taxableEarnings: 0, tds: 0, pfEmployee: 0, professionalTax: 0, hra: 0, basic: 0 };

export type EngineInput = {
  employee: { id: string; name: string; dateOfBirth: string | null; gender: string | null };
  period: { year: number; month: number; startDate: string; endDate: string };
  days: DaysSummary;
  annualCtc: number;
  components: ComponentDef[];
  structure: { name: string; lines: StructureLine[] } | null;
  oneOffs: OneOffInput[];
  loans: LoanInstallment[];
  statutory: {
    pf: PfParams | null;
    esi: EsiParams | null;
    pt: PtParams | null;
    lwf: LwfParams | null;
    incomeTax: IncomeTaxParams | null;
  };
  profile: StatutoryProfile;
  ytd: Ytd;
  /** Settlement-only calculation (salary for the period already paid elsewhere). */
  skipSalary?: boolean;
};

export type StatutoryBreakdown = {
  pf?: { wage: number; employeeWage: number; employerWage: number; epsWage: number; employee: number; eps: number; epf: number };
  esi?: { covered: boolean; rateOfWages: number; wages: number; employee: number; employer: number };
  pt?: { state: string; wage: number; amount: number };
  lwf?: { state: string; employee: number; employer: number };
  tds?: { regime: "new" | "old"; projectedIncome: number; taxableIncome: number; annualTax: number; alreadyDeducted: number; remainingMonths: number; amount: number };
};

export type EngineResult = {
  lines: PayLine[];
  gross: number;
  deductions: number;
  employerContributions: number;
  net: number;
  payableDays: number;
  lopDays: number;
  fullMonthGross: number;
  messages: Message[];
  statutory: StatutoryBreakdown;
  explanation: string;
};
