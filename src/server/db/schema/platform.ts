import {
  bigserial,
  boolean,
  date,
  index,
  inet,
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

/* ------------------------------------------------------------------ */
/* Audit log: append-only (enforced by trigger in a custom migration)  */
/* ------------------------------------------------------------------ */

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    tenantId: uuid(),
    actorUserId: uuid(),
    /** "user" | "system" | "agent" | "integration" */
    actorType: text().notNull().default("user"),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text(),
    /** Redacted field-level diff. Never contains secrets or full identity numbers. */
    changes: jsonb().$type<Record<string, { from?: unknown; to?: unknown }>>(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    ip: inet(),
    userAgent: text(),
    requestId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_tenant_created_idx").on(t.tenantId, t.createdAt.desc()),
    index("audit_logs_entity_idx").on(t.tenantId, t.entityType, t.entityId),
  ],
);

/* ------------------------------------------------------------------ */
/* Durable job queue (Postgres SKIP LOCKED; no Redis dependency)       */
/* ------------------------------------------------------------------ */

export const jobStatus = pgEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "dead",
  "cancelled",
]);

export const jobs = pgTable(
  "jobs",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    tenantId: uuid(),
    type: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    status: jobStatus().notNull().default("queued"),
    runAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(5),
    lastError: text(),
    lockedAt: timestamp({ withTimezone: true }),
    lockedBy: text(),
    /** Prevents enqueuing the same logical job twice while it is pending. */
    dedupeKey: text(),
    result: jsonb(),
    completedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("jobs_ready_idx")
      .on(t.runAt)
      .where(sql`${t.status} = 'queued'`),
    uniqueIndex("jobs_dedupe_key")
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    index("jobs_tenant_idx").on(t.tenantId, t.createdAt),
  ],
);

/* ------------------------------------------------------------------ */
/* Notifications and email outbox                                      */
/* ------------------------------------------------------------------ */

export const notifications = pgTable(
  "notifications",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    userId: uuid().notNull(),
    category: text().notNull(),
    title: text().notNull(),
    /** Must not contain confidential data (salary, ids); link to the record instead. */
    body: text(),
    href: text(),
    readAt: timestamp({ withTimezone: true }),
    dedupeKey: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.tenantId, t.createdAt.desc()),
    index("notifications_unread_idx")
      .on(t.userId, t.tenantId)
      .where(sql`${t.readAt} is null`),
    uniqueIndex("notifications_dedupe_key")
      .on(t.tenantId, t.userId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    tenantId: tenantRef().references(() => tenants.id),
    userId: uuid().notNull(),
    category: text().notNull(),
    inApp: boolean().notNull().default(true),
    email: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("notification_prefs_key").on(t.tenantId, t.userId, t.category)],
);

export const deliveryStatus = pgEnum("delivery_status", [
  "pending",
  "sending",
  "sent",
  "failed",
  "dead",
  "suppressed",
]);

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: pk(),
    tenantId: uuid(),
    toAddress: text().notNull(),
    template: text().notNull(),
    subject: text().notNull(),
    html: text().notNull(),
    text: text(),
    status: deliveryStatus().notNull().default("pending"),
    attempts: smallint().notNull().default(0),
    provider: text(),
    providerMessageId: text(),
    lastError: text(),
    dedupeKey: text(),
    sentAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("email_outbox_status_idx").on(t.status, t.createdAt),
    uniqueIndex("email_outbox_dedupe_key")
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
  ],
);

/* ------------------------------------------------------------------ */
/* Idempotency keys for critical mutations                             */
/* ------------------------------------------------------------------ */

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    tenantId: tenantRef().references(() => tenants.id),
    scope: text().notNull(),
    key: text().notNull(),
    requestHash: text().notNull(),
    response: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("idempotency_keys_pk").on(t.tenantId, t.scope, t.key)],
);

/* ------------------------------------------------------------------ */
/* Fixed-window rate limiting                                          */
/* ------------------------------------------------------------------ */

export const rateLimits = pgTable(
  "rate_limits",
  {
    bucket: text().primaryKey(),
    windowStart: timestamp({ withTimezone: true }).notNull(),
    count: integer().notNull().default(0),
  },
);

/* ------------------------------------------------------------------ */
/* Generic approvals engine                                            */
/* ------------------------------------------------------------------ */

export type ApprovalStepDefinition = {
  /** "manager" = requester's manager, "manager_of_manager", "department_head", "role", "user" */
  approver:
    | { kind: "manager" }
    | { kind: "manager_of_manager" }
    | { kind: "department_head" }
    | { kind: "role"; roleKey: string }
    | { kind: "user"; userId: string };
  name: string;
  /** Hours before the step escalates to the fallback role. */
  escalateAfterHours?: number;
};

export const approvalPolicies = pgTable(
  "approval_policies",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    /** e.g. "leave_request", "job_requisition", "offer", "payroll_run", "expense_claim" */
    subjectType: text().notNull(),
    name: text().notNull(),
    /** JSON conditions evaluated against the subject; empty = default policy. */
    conditions: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    steps: jsonb().$type<ApprovalStepDefinition[]>().notNull(),
    priority: integer().notNull().default(0),
    version: integer().notNull().default(1),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [index("approval_policies_subject_idx").on(t.tenantId, t.subjectType)],
);

export const approvalStatus = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    subjectType: text().notNull(),
    subjectId: uuid().notNull(),
    policyId: uuid(),
    policyVersion: integer(),
    title: text().notNull(),
    status: approvalStatus().notNull().default("pending"),
    currentStep: smallint().notNull().default(1),
    requestedBy: uuid().notNull(),
    requestedForEmployeeId: uuid(),
    decidedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("approval_requests_open_subject_key")
      .on(t.tenantId, t.subjectType, t.subjectId)
      .where(sql`${t.status} = 'pending'`),
    index("approval_requests_tenant_status_idx").on(t.tenantId, t.status, t.createdAt),
  ],
);

export const approvalSteps = pgTable(
  "approval_steps",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    requestId: uuid()
      .notNull()
      .references(() => approvalRequests.id, { onDelete: "cascade" }),
    stepNo: smallint().notNull(),
    name: text().notNull(),
    /** Resolved approver user ids at the time the step became active. */
    approverUserIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    approverRoleKey: text(),
    status: approvalStatus().notNull().default("pending"),
    decidedBy: uuid(),
    decidedAt: timestamp({ withTimezone: true }),
    comment: text(),
    dueAt: timestamp({ withTimezone: true }),
    escalatedAt: timestamp({ withTimezone: true }),
    delegatedFrom: uuid(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("approval_steps_request_step_key").on(t.requestId, t.stepNo),
    index("approval_steps_approvers_idx").using("gin", t.approverUserIds),
  ],
);

export const approvalDelegations = pgTable(
  "approval_delegations",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    fromUserId: uuid().notNull(),
    toUserId: uuid().notNull(),
    startsOn: date().notNull(),
    endsOn: date().notNull(),
    subjectTypes: text().array(),
    ...timestamps,
  },
  (t) => [index("approval_delegations_from_idx").on(t.tenantId, t.fromUserId)],
);

/* ------------------------------------------------------------------ */
/* Tasks (onboarding, offboarding, workflows, manual)                  */
/* ------------------------------------------------------------------ */

export const taskStatus = pgEnum("task_status", [
  "open",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
]);

export const tasks = pgTable(
  "tasks",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    title: text().notNull(),
    description: text(),
    /** Owner group: "hr" | "it" | "finance" | "manager" | "employee" | "buddy" | "other" */
    ownerGroup: text().notNull().default("hr"),
    assigneeUserId: uuid(),
    /** The employee the task is about (e.g. the new joiner). */
    subjectEmployeeId: uuid(),
    /** Container the task belongs to: onboarding plan, exit case, workflow run, ... */
    containerType: text(),
    containerId: uuid(),
    status: taskStatus().notNull().default("open"),
    priority: smallint().notNull().default(2),
    dueOn: date(),
    completedAt: timestamp({ withTimezone: true }),
    completedBy: uuid(),
    /** "document_upload" | "acknowledgement" | "form" | "checklist" */
    kind: text().notNull().default("checklist"),
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    sortOrder: integer().notNull().default(0),
    createdBy: uuid(),
    ...timestamps,
  },
  (t) => [
    index("tasks_assignee_idx").on(t.tenantId, t.assigneeUserId, t.status),
    index("tasks_container_idx").on(t.containerType, t.containerId),
    index("tasks_subject_idx").on(t.tenantId, t.subjectEmployeeId),
    index("tasks_due_idx")
      .on(t.tenantId, t.dueOn)
      .where(sql`${t.status} in ('open','in_progress','blocked')`),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    subjectType: text().notNull(),
    subjectId: uuid().notNull(),
    authorUserId: uuid().notNull(),
    body: text().notNull(),
    /** Internal notes are hidden from the employee the subject concerns. */
    isInternal: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [index("comments_subject_idx").on(t.tenantId, t.subjectType, t.subjectId)],
);
