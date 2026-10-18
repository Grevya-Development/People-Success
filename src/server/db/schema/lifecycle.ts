import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pk, tenantRef, timestamps } from "./_helpers";
import { tenants } from "./identity";

export const planKind = pgEnum("plan_kind", ["onboarding", "offboarding"]);

/** Reusable checklist templates selected by department / location / employment type. */
export const lifecycleTemplates = pgTable(
  "lifecycle_templates",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    kind: planKind().notNull(),
    name: text().notNull(),
    description: text(),
    /** e.g. { departmentId: "...", employmentType: "intern" } — empty means default. */
    conditions: jsonb().$type<Record<string, string | string[]>>().notNull().default({}),
    priority: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("lifecycle_templates_name_key").on(t.tenantId, t.kind, t.name)],
);

export const lifecycleTemplateTasks = pgTable(
  "lifecycle_template_tasks",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    templateId: uuid()
      .notNull()
      .references(() => lifecycleTemplates.id, { onDelete: "cascade" }),
    title: text().notNull(),
    description: text(),
    /** "hr" | "it" | "finance" | "manager" | "employee" | "buddy" */
    ownerGroup: text().notNull(),
    /** Days relative to the plan anchor (joining date or last working day). Negative = before. */
    dueOffsetDays: integer().notNull().default(0),
    /** "checklist" | "document_upload" | "acknowledgement" | "form" | "checkin" */
    kind: text().notNull().default("checklist"),
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    sortOrder: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [index("lifecycle_template_tasks_template_idx").on(t.templateId, t.sortOrder)],
);

export const planStatus = pgEnum("plan_status", ["not_started", "in_progress", "completed", "cancelled"]);

/** An onboarding or offboarding plan for one employee; its tasks live in `tasks`. */
export const lifecyclePlans = pgTable(
  "lifecycle_plans",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid().notNull(),
    kind: planKind().notNull(),
    templateId: uuid(),
    exitCaseId: uuid(),
    status: planStatus().notNull().default("not_started"),
    anchorDate: date().notNull(),
    buddyEmployeeId: uuid(),
    progressPercent: smallint().notNull().default(0),
    completedAt: timestamp({ withTimezone: true }),
    createdBy: uuid(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("lifecycle_plans_open_key")
      .on(t.employeeId, t.kind)
      .where(sql`${t.status} in ('not_started','in_progress')`),
    index("lifecycle_plans_status_idx").on(t.tenantId, t.kind, t.status),
  ],
);

export const exitType = pgEnum("exit_type", [
  "resignation",
  "termination",
  "retirement",
  "end_of_contract",
  "absconding",
  "death",
  "mutual_separation",
]);

export const exitStatus = pgEnum("exit_status", [
  "submitted",
  "under_review",
  "accepted",
  "rejected",
  "withdrawn",
  "in_progress",
  "completed",
]);

export const settlementStatus = pgEnum("settlement_status", ["not_started", "draft", "pending_approval", "approved", "paid"]);

export type ExitInterview = {
  conductedOn?: string;
  conductedBy?: string;
  primaryReason?: string;
  ratings?: Record<string, number>;
  wouldRecommend?: boolean;
  comments?: string;
};

export const exitCases = pgTable(
  "exit_cases",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid().notNull(),
    type: exitType().notNull(),
    status: exitStatus().notNull().default("submitted"),
    submittedOn: date().notNull(),
    requestedLastWorkingDate: date(),
    approvedLastWorkingDate: date(),
    noticePeriodDays: integer().notNull(),
    noticeShortfallDays: integer().notNull().default(0),
    /** "none" | "waived" | "recover" | "buyout" */
    shortfallTreatment: text().notNull().default("none"),
    reasonCategory: text(),
    reasonDetail: text(),
    eligibleForRehire: boolean(),
    exitInterview: jsonb().$type<ExitInterview>(),
    settlementStatus: settlementStatus().notNull().default("not_started"),
    settlementRunId: uuid(),
    initiatedBy: uuid().notNull(),
    approvedBy: uuid(),
    completedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("exit_cases_open_key")
      .on(t.employeeId)
      .where(sql`${t.status} not in ('rejected','withdrawn','completed')`),
    index("exit_cases_status_idx").on(t.tenantId, t.status),
  ],
);
