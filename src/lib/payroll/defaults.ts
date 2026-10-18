/**
 * Default pay components and statutory rule sets offered by the explicit
 * "Load defaults" actions. Every rule set is seeded UNVERIFIED with the
 * statute / notification it is based on; values must be checked by a
 * qualified payroll professional before production use. Amounts in paise.
 */
import type { ComponentCalc, ComponentKind, StructureLine } from "./types";
import type { RuleKind } from "./params";

export type DefaultComponent = {
  code: string;
  name: string;
  kind: ComponentKind;
  calculation: ComponentCalc;
  value: number | null;
  isTaxable: boolean;
  isPartOfCtc: boolean;
  pfWage: boolean;
  esiWage: boolean;
  ptWage: boolean;
  prorate: boolean;
  payslipLabel: string | null;
  sortOrder: number;
  isSystem: boolean;
};

const earning = (code: string, name: string, sortOrder: number, o: Partial<DefaultComponent> = {}): DefaultComponent => ({
  code,
  name,
  kind: "earning",
  calculation: "input",
  value: null,
  isTaxable: true,
  isPartOfCtc: false,
  pfWage: false,
  esiWage: false,
  ptWage: true,
  prorate: false,
  payslipLabel: null,
  sortOrder,
  isSystem: false,
  ...o,
});

const statutory = (code: string, name: string, kind: ComponentKind, sortOrder: number, o: Partial<DefaultComponent> = {}): DefaultComponent => ({
  code,
  name,
  kind,
  calculation: "statutory",
  value: null,
  isTaxable: false,
  isPartOfCtc: false,
  pfWage: false,
  esiWage: false,
  ptWage: false,
  prorate: false,
  payslipLabel: null,
  sortOrder,
  isSystem: true,
  ...o,
});

export const DEFAULT_COMPONENTS: DefaultComponent[] = [
  earning("BASIC", "Basic salary", 10, { calculation: "percent_of_ctc", value: 50, isPartOfCtc: true, pfWage: true, esiWage: true, prorate: true, isSystem: true }),
  earning("HRA", "House rent allowance", 20, { calculation: "percent_of_basic", value: 40, isPartOfCtc: true, esiWage: true, prorate: true }),
  earning("CONV", "Conveyance allowance", 30, { calculation: "fixed", value: 0, isPartOfCtc: true, esiWage: true, prorate: true }),
  earning("LTA", "Leave travel allowance", 40, { calculation: "fixed", value: 0, isPartOfCtc: true, esiWage: true, prorate: true }),
  earning("SPECIAL", "Special allowance", 50, { calculation: "balancing", isPartOfCtc: true, esiWage: true, prorate: true, isSystem: true }),
  earning("BONUS", "Bonus", 100),
  earning("INCENTIVE", "Incentive", 105, { esiWage: true }),
  earning("ARREAR", "Arrears", 110, { esiWage: true }),
  earning("OT", "Overtime", 120, { esiWage: true }),
  earning("REIMB", "Reimbursement", 130, { kind: "reimbursement", isTaxable: false, ptWage: false }),
  earning("REFERRAL", "Referral reward", 135),
  earning("LEAVE_ENC", "Leave encashment", 140, { ptWage: false }),
  earning("GRATUITY", "Gratuity", 145, { isTaxable: false, ptWage: false }),
  earning("NOTICE_PAY", "Notice pay in lieu", 150, { ptWage: false }),
  earning("OTHER_EARN", "Other earning", 160),
  statutory("LOP", "Loss of pay", "deduction", 199, { calculation: "input", payslipLabel: "Loss of pay (days)" }),
  statutory("PF_EE", "Provident fund (employee)", "statutory_deduction", 200),
  statutory("ESI_EE", "ESI (employee)", "statutory_deduction", 210),
  statutory("PT", "Professional tax", "statutory_deduction", 220),
  statutory("LWF_EE", "Labour welfare fund (employee)", "statutory_deduction", 230),
  statutory("TDS", "Income tax (TDS)", "statutory_deduction", 240),
  statutory("LOAN", "Loan / advance recovery", "deduction", 260, { calculation: "input" }),
  statutory("NOTICE_REC", "Notice period recovery", "deduction", 265, { calculation: "input", isSystem: false }),
  statutory("OTHER_DED", "Other deduction", "deduction", 270, { calculation: "input", isSystem: false }),
  statutory("PF_ER", "Provident fund (employer)", "employer_contribution", 300, { isPartOfCtc: true }),
  statutory("ESI_ER", "ESI (employer)", "employer_contribution", 310),
  statutory("LWF_ER", "Labour welfare fund (employer)", "employer_contribution", 330),
];

export const DEFAULT_STRUCTURE: { name: string; description: string; lines: StructureLine[] } = {
  name: "Standard",
  description: "Basic 50% of CTC, HRA 40% of basic, special allowance balances to CTC (employer PF inside CTC).",
  lines: [
    { componentCode: "BASIC", calculation: "percent_of_ctc", value: 50 },
    { componentCode: "HRA", calculation: "percent_of_basic", value: 40 },
    { componentCode: "SPECIAL", calculation: "balancing", value: null },
  ],
};

export const UNVERIFIED_NOTE =
  "Default values loaded by PeopleSuccess for convenience. They are NOT guaranteed to be current and must be verified by a qualified payroll professional against the latest statute, rules and notifications before production use.";

export type DefaultRuleSet = {
  kind: RuleKind;
  jurisdiction: string;
  name: string;
  effectiveFrom: string;
  parameters: Record<string, unknown>;
  sourceReference: string;
  notes: string;
};

const note = (extra: string) => `${UNVERIFIED_NOTE} ${extra}`.trim();

export const DEFAULT_RULE_SETS: DefaultRuleSet[] = [
  {
    kind: "pf",
    jurisdiction: "IN",
    name: "Provident fund (EPF & EPS)",
    effectiveFrom: "2014-09-01",
    parameters: { employeeRate: 12, employerRate: 12, epsRate: 8.33, wageCeiling: 1500000, epsWageCeiling: 1500000, epsMaxAge: 58, employerAlwaysCapped: true, rounding: "half_up_rupee" },
    sourceReference: "Employees' Provident Funds and Miscellaneous Provisions Act, 1952 s.6; EPF Scheme 1952 para 29; EPS 1995 para 3; G.S.R. 609(E) dated 22-08-2014 (wage ceiling ₹15,000 from 01-09-2014).",
    notes: note("Reduced 10% rate for notified establishments, EDLI and administrative charges are not modelled."),
  },
  {
    kind: "esi",
    jurisdiction: "IN",
    name: "Employees' State Insurance",
    effectiveFrom: "2019-07-01",
    parameters: { employeeRate: 0.75, employerRate: 3.25, wageThreshold: 2100000, rounding: "ceil_rupee", contributionPeriods: [{ startMonth: 4, endMonth: 9 }, { startMonth: 10, endMonth: 3 }] },
    sourceReference: "Employees' State Insurance Act, 1948 s.39; ESI (Central) Rules, 1950 r.51; G.S.R. 423(E) dated 13-06-2019 (rates from 01-07-2019); wage ceiling ₹21,000 from 01-01-2017.",
    notes: note("Higher threshold for persons with disability and the low-wage employee-share exemption are not modelled."),
  },
  {
    kind: "pt",
    jurisdiction: "IN-KA",
    name: "Professional tax – Karnataka",
    effectiveFrom: "2025-04-01",
    parameters: { periodicity: "monthly", slabs: [{ upTo: 2499999, amount: 0 }, { upTo: null, amount: 20000, monthAmounts: { "2": 30000 } }] },
    sourceReference: "Karnataka Tax on Professions, Trades, Callings and Employments Act, 1976 – Schedule entry 1 (salary ≥ ₹25,000: ₹200 a month; February ₹300 per the 2025 amendment).",
    notes: note(""),
  },
  {
    kind: "pt",
    jurisdiction: "IN-MH",
    name: "Professional tax – Maharashtra",
    effectiveFrom: "2023-04-01",
    parameters: {
      periodicity: "monthly",
      slabs: [{ upTo: 750000, amount: 0 }, { upTo: 1000000, amount: 17500 }, { upTo: null, amount: 20000, monthAmounts: { "2": 30000 } }],
      slabsByGender: { female: [{ upTo: 2500000, amount: 0 }, { upTo: null, amount: 20000, monthAmounts: { "2": 30000 } }] },
    },
    sourceReference: "Maharashtra State Tax on Professions, Trades, Callings and Employments Act, 1975 – Schedule I entry 1 (women up to ₹25,000 exempt).",
    notes: note(""),
  },
  {
    kind: "pt",
    jurisdiction: "IN-TN",
    name: "Professional tax – Tamil Nadu (half-yearly)",
    effectiveFrom: "2024-10-01",
    parameters: {
      periodicity: "half_yearly",
      deductionMonths: [9, 3],
      slabs: [
        { upTo: 2100000, amount: 0 },
        { upTo: 3000000, amount: 18000 },
        { upTo: 4500000, amount: 42500 },
        { upTo: 6000000, amount: 93000 },
        { upTo: 7500000, amount: 102500 },
        { upTo: null, amount: 125000 },
      ],
    },
    sourceReference: "Tamil Nadu Urban Local Bodies Act, 1998 and the Greater Chennai Corporation half-yearly professional tax schedule (revision from the second half of 2024-25).",
    notes: note("Rates differ between local bodies; half-yearly PT is computed on projected wages (this month × 6)."),
  },
  {
    kind: "pt",
    jurisdiction: "IN-TG",
    name: "Professional tax – Telangana",
    effectiveFrom: "2015-04-01",
    parameters: { periodicity: "monthly", slabs: [{ upTo: 1500000, amount: 0 }, { upTo: 2000000, amount: 15000 }, { upTo: null, amount: 20000 }] },
    sourceReference: "Telangana Tax on Professions, Trades, Callings and Employments Act, 1987 – Schedule entry 1.",
    notes: note(""),
  },
  {
    kind: "pt",
    jurisdiction: "IN-WB",
    name: "Professional tax – West Bengal",
    effectiveFrom: "2015-04-01",
    parameters: {
      periodicity: "monthly",
      slabs: [{ upTo: 1000000, amount: 0 }, { upTo: 1500000, amount: 11000 }, { upTo: 2500000, amount: 13000 }, { upTo: 4000000, amount: 15000 }, { upTo: null, amount: 20000 }],
    },
    sourceReference: "West Bengal State Tax on Professions, Trades, Callings and Employments Act, 1979 – Schedule entry 1.",
    notes: note(""),
  },
  {
    kind: "pt",
    jurisdiction: "IN-GJ",
    name: "Professional tax – Gujarat",
    effectiveFrom: "2023-04-01",
    parameters: { periodicity: "monthly", slabs: [{ upTo: 1199999, amount: 0 }, { upTo: null, amount: 20000 }] },
    sourceReference: "Gujarat State Tax on Professions, Traders, Callings and Employments Act, 1976 – as amended in 2023 (salary ≥ ₹12,000: ₹200 a month).",
    notes: note(""),
  },
  {
    kind: "lwf",
    jurisdiction: "IN-KA",
    name: "Labour welfare fund – Karnataka",
    effectiveFrom: "2024-01-01",
    parameters: { deductionMonths: [12], slabs: [{ upTo: null, employee: 5000, employer: 10000 }] },
    sourceReference: "Karnataka Labour Welfare Fund Act, 1965 s.7A as amended in 2024 (annual ₹50 employee / ₹100 employer, deducted in December).",
    notes: note("Confirm the applicable rates and any exemptions for managerial employees."),
  },
  {
    kind: "lwf",
    jurisdiction: "IN-MH",
    name: "Labour welfare fund – Maharashtra",
    effectiveFrom: "2019-01-01",
    parameters: { deductionMonths: [6, 12], slabs: [{ upTo: 300000, employee: 600, employer: 1800 }, { upTo: null, employee: 1200, employer: 3600 }] },
    sourceReference: "Maharashtra Labour Welfare Fund Act, 1953 s.6BB (half-yearly, June and December).",
    notes: note("Rates were reported as revised in 2024; verify current employee/employer amounts and the managerial-wage exclusion."),
  },
  {
    kind: "income_tax",
    jurisdiction: "IN",
    name: "Income tax on salary – FY 2025-26 (new and old regimes)",
    effectiveFrom: "2025-04-01",
    parameters: {
      fyStartYear: 2025,
      annualRounding: "nearest_10_rupees",
      monthlyRounding: "half_up_rupee",
      regimes: {
        new: {
          standardDeduction: 7500000,
          slabs: [
            { upTo: 40000000, rate: 0 },
            { upTo: 80000000, rate: 5 },
            { upTo: 120000000, rate: 10 },
            { upTo: 160000000, rate: 15 },
            { upTo: 200000000, rate: 20 },
            { upTo: 240000000, rate: 25 },
            { upTo: null, rate: 30 },
          ],
          rebate: { incomeUpTo: 120000000, maxRebate: 6000000, marginalRelief: true },
          surcharge: [{ above: 500000000, rate: 10 }, { above: 1000000000, rate: 15 }, { above: 2000000000, rate: 25 }],
          cessRate: 4,
          allowsProfessionalTax: false,
          allowsHraExemption: false,
        },
        old: {
          standardDeduction: 5000000,
          slabs: [{ upTo: 25000000, rate: 0 }, { upTo: 50000000, rate: 5 }, { upTo: 100000000, rate: 20 }, { upTo: null, rate: 30 }],
          seniorSlabs: [{ upTo: 30000000, rate: 0 }, { upTo: 50000000, rate: 5 }, { upTo: 100000000, rate: 20 }, { upTo: null, rate: 30 }],
          superSeniorSlabs: [{ upTo: 50000000, rate: 0 }, { upTo: 100000000, rate: 20 }, { upTo: null, rate: 30 }],
          rebate: { incomeUpTo: 50000000, maxRebate: 1250000, marginalRelief: false },
          surcharge: [{ above: 500000000, rate: 10 }, { above: 1000000000, rate: 15 }, { above: 2000000000, rate: 25 }, { above: 5000000000, rate: 37 }],
          cessRate: 4,
          deductionLimits: { "80C": 15000000, "80CCD1B": 5000000, "80D": 2500000, "24b": 20000000, "80TTA": 1000000 },
          allowsProfessionalTax: true,
          allowsHraExemption: true,
        },
      },
    },
    sourceReference: "Income-tax Act, 1961 s.115BAC (new regime), First Schedule Part III, s.87A, s.16(ia), s.192; Finance Act 2025 (FY 2025-26 slabs, ₹75,000 standard deduction, rebate up to ₹60,000 for income ≤ ₹12 lakh).",
    notes: note("Applies to FY 2025-26 only; add a new version for later financial years. 80D limits for senior citizens and employer NPS (80CCD(2)) are not modelled."),
  },
  {
    kind: "gratuity",
    jurisdiction: "IN",
    name: "Gratuity",
    effectiveFrom: "2018-03-29",
    parameters: { daysFactor: 15, monthDays: 26, minYears: 5, roundUpMonthsAbove: 6, cap: 200000000, rounding: "half_up_rupee" },
    sourceReference: "Payment of Gratuity Act, 1972 s.4(2) and s.4(3); ceiling ₹20 lakh per S.O. 1420(E) dated 29-03-2018.",
    notes: note("Eligibility uses completed years of continuous service; death/disablement exceptions are not modelled."),
  },
  {
    kind: "bonus",
    jurisdiction: "IN",
    name: "Statutory bonus",
    effectiveFrom: "2015-04-01",
    parameters: { eligibilityWageCeiling: 2100000, calculationWageCeiling: 700000, minPercent: 8.33, maxPercent: 20, minDaysWorked: 30, rounding: "half_up_rupee" },
    sourceReference: "Payment of Bonus Act, 1965 ss.2(13), 8, 10, 11, 12 as amended by the Payment of Bonus (Amendment) Act, 2015.",
    notes: note("Calculator only; the higher of ₹7,000 or the scheduled minimum wage applies as the calculation ceiling."),
  },
];
