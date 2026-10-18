import {
  boolean,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { money, pk, tenantRef, timestamps } from "./_helpers";
import { tenants } from "./identity";

export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text().notNull(),
    code: text().notNull(),
    /** Per-item limit; null = no limit. */
    maxPerItem: money(),
    /** Monthly limit per employee; null = no limit. */
    maxPerMonth: money(),
    receiptRequiredAbove: money().notNull().default(0),
    glCode: text(),
    isTaxable: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("expense_categories_code_key").on(t.tenantId, t.code)],
);

export const claimStatus = pgEnum("claim_status", ["draft", "submitted", "approved", "rejected", "reimbursed", "cancelled"]);

export const expenseClaims = pgTable(
  "expense_claims",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    number: text().notNull(),
    employeeId: uuid().notNull(),
    title: text().notNull(),
    status: claimStatus().notNull().default("draft"),
    total: money().notNull().default(0),
    currency: text().notNull().default("INR"),
    /** "payroll" | "bank_transfer" */
    reimbursementMethod: text().notNull().default("payroll"),
    payrollInputId: uuid(),
    paymentReference: text(),
    submittedAt: timestamp({ withTimezone: true }),
    decidedAt: timestamp({ withTimezone: true }),
    reimbursedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("expense_claims_number_key").on(t.tenantId, t.number),
    index("expense_claims_employee_idx").on(t.employeeId, t.status),
  ],
);

export const expenseItems = pgTable(
  "expense_items",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    claimId: uuid()
      .notNull()
      .references(() => expenseClaims.id, { onDelete: "cascade" }),
    categoryId: uuid()
      .notNull()
      .references(() => expenseCategories.id),
    spentOn: date().notNull(),
    merchant: text(),
    description: text().notNull(),
    amount: money().notNull(),
    receiptDocumentId: uuid(),
    policyViolations: jsonb().$type<string[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [index("expense_items_claim_idx").on(t.claimId)],
);

export const benefitPlans = pgTable(
  "benefit_plans",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text().notNull(),
    /** "health_insurance" | "life_insurance" | "nps" | "meal" | "wellness" | "other" */
    kind: text().notNull(),
    description: text(),
    provider: text(),
    eligibility: jsonb().$type<Record<string, string | string[]>>().notNull().default({}),
    /** Monthly amounts in paise. */
    employerContribution: money().notNull().default(0),
    employeeContribution: money().notNull().default(0),
    deductFromSalary: boolean().notNull().default(false),
    coverageOptions: text().array().notNull().default(sql`'{self}'::text[]`),
    enrollmentOpensOn: date(),
    enrollmentClosesOn: date(),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("benefit_plans_name_key").on(t.tenantId, t.name)],
);

export const enrollmentStatus = pgEnum("enrollment_status", ["enrolled", "waived", "ended"]);

export const benefitEnrollments = pgTable(
  "benefit_enrollments",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    planId: uuid()
      .notNull()
      .references(() => benefitPlans.id),
    employeeId: uuid().notNull(),
    status: enrollmentStatus().notNull(),
    coverage: text().notNull().default("self"),
    dependentIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("benefit_enrollments_open_key")
      .on(t.planId, t.employeeId)
      .where(sql`${t.effectiveTo} is null`),
  ],
);
