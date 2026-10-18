import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { money, pk, tenantRef, timestamps } from "./_helpers";
import { tenants } from "./identity";

/* ------------------------------------------------------------------ */
/* Components and salary structures                                    */
/* ------------------------------------------------------------------ */

export const componentKind = pgEnum("component_kind", [
  "earning",
  "deduction",
  "employer_contribution",
  "reimbursement",
  "statutory_deduction",
]);

export const componentCalc = pgEnum("component_calc", [
  "fixed",
  "percent_of_ctc",
  "percent_of_basic",
  "percent_of_gross",
  "balancing",
  "statutory",
  "input",
]);

export const payComponents = pgTable(
  "pay_components",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    code: text().notNull(),
    name: text().notNull(),
    kind: componentKind().notNull(),
    calculation: componentCalc().notNull(),
    /** Percent (e.g. 50.00) or fixed annual amount in paise, depending on calculation. */
    value: numeric({ precision: 14, scale: 4, mode: "number" }),
    isTaxable: boolean().notNull().default(true),
    isPartOfCtc: boolean().notNull().default(true),
    /** Whether the component counts toward PF / ESI / PT wages. */
    pfWage: boolean().notNull().default(false),
    esiWage: boolean().notNull().default(false),
    ptWage: boolean().notNull().default(true),
    /** Prorated by payable days (most earnings) or paid in full. */
    prorate: boolean().notNull().default(true),
    payslipLabel: text(),
    sortOrder: integer().notNull().default(0),
    isSystem: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("pay_components_code_key").on(t.tenantId, t.code)],
);

export type StructureLine = {
  componentCode: string;
  calculation: "fixed" | "percent_of_ctc" | "percent_of_basic" | "percent_of_gross" | "balancing";
  /** Percent, or annual fixed amount in paise. */
  value: number | null;
};

export const salaryStructures = pgTable(
  "salary_structures",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text().notNull(),
    description: text(),
    lines: jsonb().$type<StructureLine[]>().notNull(),
    version: integer().notNull().default(1),
    isDefault: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("salary_structures_name_key").on(t.tenantId, t.name)],
);

/* ------------------------------------------------------------------ */
/* Statutory rule sets: versioned, effective-dated, verification state */
/* ------------------------------------------------------------------ */

/**
 * Parameters for PF, ESI, professional tax, LWF, gratuity, bonus and income
 * tax. Values are configuration, not code, so they can be updated when law
 * changes without a deploy. A rule set is "unverified" until a qualified
 * reviewer records verification; payroll shows that state prominently and
 * blocks locking a run that uses unverified rules unless explicitly overridden.
 */
export const statutoryRuleSets = pgTable(
  "statutory_rule_sets",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    /** "pf" | "esi" | "pt" | "lwf" | "income_tax" | "gratuity" | "bonus" */
    kind: text().notNull(),
    /** "IN" or a state such as "IN-KA". */
    jurisdiction: text().notNull(),
    name: text().notNull(),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),
    version: integer().notNull().default(1),
    parameters: jsonb().$type<Record<string, unknown>>().notNull(),
    sourceReference: text(),
    notes: text(),
    verifiedBy: uuid(),
    verifiedAt: timestamp({ withTimezone: true }),
    createdBy: uuid(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("statutory_rule_sets_version_key").on(t.tenantId, t.kind, t.jurisdiction, t.effectiveFrom, t.version),
    index("statutory_rule_sets_lookup_idx").on(t.tenantId, t.kind, t.jurisdiction, t.effectiveFrom),
  ],
);

/* ------------------------------------------------------------------ */
/* Periods, inputs, runs                                               */
/* ------------------------------------------------------------------ */

export const periodStatus = pgEnum("period_status", ["open", "processing", "locked", "closed"]);

export const payrollPeriods = pgTable(
  "payroll_periods",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    legalEntityId: uuid().notNull(),
    year: smallint().notNull(),
    month: smallint().notNull(),
    startDate: date().notNull(),
    endDate: date().notNull(),
    payDate: date().notNull(),
    /** Attendance and inputs after this date roll into the next period. */
    inputCutoffDate: date().notNull(),
    status: periodStatus().notNull().default("open"),
    ...timestamps,
  },
  (t) => [uniqueIndex("payroll_periods_key").on(t.tenantId, t.legalEntityId, t.year, t.month)],
);

export const inputKind = pgEnum("input_kind", [
  "bonus",
  "incentive",
  "commission",
  "arrear",
  "overtime",
  "reimbursement",
  "deduction",
  "recovery",
  "referral_reward",
  "leave_encashment",
  "other_earning",
]);

/** One-off amounts for a period. `sourceType + sourceId` prevents double-posting. */
export const payrollInputs = pgTable(
  "payroll_inputs",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    periodId: uuid()
      .notNull()
      .references(() => payrollPeriods.id),
    employeeId: uuid().notNull(),
    kind: inputKind().notNull(),
    componentCode: text().notNull(),
    amount: money().notNull(),
    isTaxable: boolean().notNull().default(true),
    note: text(),
    sourceType: text().notNull().default("manual"),
    sourceId: text(),
    createdBy: uuid(),
    ...timestamps,
  },
  (t) => [
    index("payroll_inputs_period_idx").on(t.periodId, t.employeeId),
    uniqueIndex("payroll_inputs_source_key")
      .on(t.tenantId, t.sourceType, t.sourceId)
      .where(sql`${t.sourceId} is not null`),
  ],
);

export const runKind = pgEnum("run_kind", ["regular", "adjustment", "off_cycle", "full_and_final"]);
export const runStatus = pgEnum("run_status", [
  "draft",
  "calculated",
  "pending_approval",
  "approved",
  "locked",
  "disbursed",
  "published",
  "cancelled",
]);

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    periodId: uuid()
      .notNull()
      .references(() => payrollPeriods.id),
    legalEntityId: uuid().notNull(),
    kind: runKind().notNull().default("regular"),
    status: runStatus().notNull().default("draft"),
    parentRunId: uuid(),
    /** Exact rule-set ids/versions and engine version used by the last calculation. */
    calculationBasis: jsonb().$type<{ engineVersion: string; ruleSets: { id: string; kind: string; jurisdiction: string; version: number; verified: boolean }[] }>(),
    totals: jsonb().$type<{ employees: number; gross: number; deductions: number; employerContributions: number; net: number }>(),
    /** SHA-256 over the per-employee results at approval; verified before lock and disbursement. */
    snapshotHash: text(),
    usesUnverifiedRules: boolean().notNull().default(false),
    unverifiedOverrideBy: uuid(),
    idempotencyKey: text(),
    calculatedAt: timestamp({ withTimezone: true }),
    approvedAt: timestamp({ withTimezone: true }),
    lockedAt: timestamp({ withTimezone: true }),
    publishedAt: timestamp({ withTimezone: true }),
    notes: text(),
    createdBy: uuid().notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("payroll_runs_one_regular_key")
      .on(t.periodId)
      .where(sql`${t.kind} = 'regular' and ${t.status} <> 'cancelled'`),
    uniqueIndex("payroll_runs_idempotency_key")
      .on(t.tenantId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    index("payroll_runs_period_idx").on(t.periodId),
  ],
);

export const runEmployeeStatus = pgEnum("run_employee_status", ["ok", "warning", "error", "on_hold", "excluded"]);

/** Per-employee result of a run, including the input snapshot used. */
export const payrollRunEmployees = pgTable(
  "payroll_run_employees",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    runId: uuid()
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    employeeId: uuid().notNull(),
    status: runEmployeeStatus().notNull().default("ok"),
    calendarDays: smallint().notNull(),
    payableDays: numeric({ precision: 5, scale: 2, mode: "number" }).notNull(),
    lopDays: numeric({ precision: 5, scale: 2, mode: "number" }).notNull().default(0),
    grossEarnings: money().notNull(),
    totalDeductions: money().notNull(),
    employerContributions: money().notNull(),
    netPay: money().notNull(),
    currency: text().notNull().default("INR"),
    /** Inputs (CTC, structure, attendance, rule params) frozen at calculation. */
    snapshot: jsonb().$type<Record<string, unknown>>().notNull(),
    messages: jsonb().$type<{ severity: "info" | "warning" | "error"; code: string; message: string }[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("payroll_run_employees_key").on(t.runId, t.employeeId),
    index("payroll_run_employees_employee_idx").on(t.employeeId),
  ],
);

export const payrollLineItems = pgTable(
  "payroll_line_items",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    runEmployeeId: uuid()
      .notNull()
      .references(() => payrollRunEmployees.id, { onDelete: "cascade" }),
    componentCode: text().notNull(),
    componentName: text().notNull(),
    kind: componentKind().notNull(),
    amount: money().notNull(),
    isTaxable: boolean().notNull().default(true),
    /** Human-readable calculation trail, e.g. "Basic 50% of CTC ÷ 12 × 29/31 days". */
    explanation: text().notNull(),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [index("payroll_line_items_run_employee_idx").on(t.runEmployeeId)],
);

/* ------------------------------------------------------------------ */
/* Loans, payslips, disbursements                                      */
/* ------------------------------------------------------------------ */

export const loanStatus = pgEnum("loan_status", ["active", "closed", "written_off"]);

export const employeeLoans = pgTable(
  "employee_loans",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid().notNull(),
    /** "loan" | "advance" */
    kind: text().notNull().default("advance"),
    principal: money().notNull(),
    monthlyInstallment: money().notNull(),
    outstanding: money().notNull(),
    startPeriodYear: smallint().notNull(),
    startPeriodMonth: smallint().notNull(),
    status: loanStatus().notNull().default("active"),
    approvedBy: uuid(),
    notes: text(),
    ...timestamps,
  },
  (t) => [index("employee_loans_employee_idx").on(t.employeeId, t.status)],
);

export const loanRepayments = pgTable(
  "loan_repayments",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    loanId: uuid()
      .notNull()
      .references(() => employeeLoans.id),
    runId: uuid().notNull(),
    amount: money().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("loan_repayments_run_key").on(t.loanId, t.runId)],
);

export const payslips = pgTable(
  "payslips",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    runEmployeeId: uuid()
      .notNull()
      .references(() => payrollRunEmployees.id),
    runId: uuid().notNull(),
    employeeId: uuid().notNull(),
    periodId: uuid().notNull(),
    documentId: uuid(),
    publishedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("payslips_run_employee_key").on(t.runEmployeeId),
    index("payslips_employee_idx").on(t.employeeId, t.periodId),
  ],
);

export const disbursementStatus = pgEnum("disbursement_status", ["pending", "file_generated", "submitted", "paid", "failed", "cancelled"]);

export const disbursementBatches = pgTable("disbursement_batches", {
  id: pk(),
  tenantId: tenantRef().references(() => tenants.id),
  runId: uuid().notNull(),
  /** "generic_csv" | "neft_bulk" | provider key */
  format: text().notNull(),
  documentId: uuid(),
  totalAmount: money().notNull(),
  count: integer().notNull(),
  status: disbursementStatus().notNull().default("file_generated"),
  createdBy: uuid().notNull(),
  ...timestamps,
});

/** One payment per employee per run: the unique index makes duplicate disbursement impossible. */
export const disbursements = pgTable(
  "disbursements",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    runId: uuid().notNull(),
    runEmployeeId: uuid().notNull(),
    employeeId: uuid().notNull(),
    batchId: uuid(),
    amount: money().notNull(),
    bankAccountLast4: text(),
    bankIfsc: text(),
    status: disbursementStatus().notNull().default("pending"),
    utr: text(),
    failureReason: text(),
    paidAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("disbursements_run_employee_key").on(t.runId, t.employeeId),
    index("disbursements_batch_idx").on(t.batchId),
  ],
);

/** Investment declarations / proofs used by old-regime TDS projections. */
export const taxDeclarations = pgTable(
  "tax_declarations",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid().notNull(),
    /** Financial year start, e.g. 2026 for FY 2026-27. */
    fyStartYear: smallint().notNull(),
    regime: text().notNull().default("new"),
    declarations: jsonb().$type<Record<string, number>>().notNull().default({}),
    previousEmployerIncome: money(),
    previousEmployerTds: money(),
    status: text().notNull().default("draft"),
    verifiedBy: uuid(),
    ...timestamps,
  },
  (t) => [uniqueIndex("tax_declarations_key").on(t.employeeId, t.fyStartYear)],
);
