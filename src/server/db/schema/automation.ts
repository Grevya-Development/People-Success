import {
  bigint,
  boolean,
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

/* ------------------------------------------------------------------ */
/* Workflow engine                                                     */
/* ------------------------------------------------------------------ */

export type WorkflowStep = {
  key: string;
  /** "create_task" | "send_email" | "notify" | "request_approval" | "generate_document" | "create_ticket" |
   *  "update_record" | "call_integration" | "run_agent" | "wait" | "wait_for_event" | "escalate" */
  action: string;
  name: string;
  params: Record<string, unknown>;
  /** Only run when these conditions match the run context. */
  when?: Record<string, unknown>;
  retry?: { maxAttempts: number; backoffSeconds: number };
  timeoutSeconds?: number;
};

export const workflowDefinitions = pgTable(
  "workflow_definitions",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    key: text().notNull(),
    name: text().notNull(),
    description: text(),
    /** Domain event type (e.g. "employee.joined") or "schedule". */
    trigger: text().notNull(),
    /** Cron expression for schedule triggers. */
    schedule: text(),
    conditions: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    currentVersion: integer().notNull().default(1),
    isActive: boolean().notNull().default(false),
    isStarter: boolean().notNull().default(false),
    createdBy: uuid(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("workflow_definitions_key").on(t.tenantId, t.key),
    index("workflow_definitions_trigger_idx").on(t.tenantId, t.trigger, t.isActive),
  ],
);

export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    definitionId: uuid()
      .notNull()
      .references(() => workflowDefinitions.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    steps: jsonb().$type<WorkflowStep[]>().notNull(),
    createdBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("workflow_versions_key").on(t.definitionId, t.version)],
);

export const workflowRunStatus = pgEnum("workflow_run_status", ["queued", "running", "waiting", "succeeded", "failed", "cancelled"]);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    definitionId: uuid().notNull(),
    version: integer().notNull(),
    status: workflowRunStatus().notNull().default("queued"),
    triggerEvent: jsonb().$type<Record<string, unknown>>().notNull(),
    subjectType: text(),
    subjectId: uuid(),
    context: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    currentStepIndex: integer().notNull().default(0),
    /** Prevents the same trigger event from starting the same workflow twice. */
    dedupeKey: text().notNull(),
    waitingUntil: timestamp({ withTimezone: true }),
    waitingForEvent: text(),
    error: text(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
    cancelledBy: uuid(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("workflow_runs_dedupe_key").on(t.definitionId, t.dedupeKey),
    index("workflow_runs_status_idx").on(t.tenantId, t.status, t.startedAt),
  ],
);

export const stepRunStatus = pgEnum("step_run_status", ["pending", "running", "succeeded", "failed", "skipped", "waiting"]);

export const workflowRunSteps = pgTable(
  "workflow_run_steps",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    runId: uuid()
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    stepKey: text().notNull(),
    action: text().notNull(),
    status: stepRunStatus().notNull().default("pending"),
    attempts: smallint().notNull().default(0),
    input: jsonb().$type<Record<string, unknown>>(),
    output: jsonb().$type<Record<string, unknown>>(),
    error: text(),
    /** run + step: side effects check this before acting so retries never duplicate them. */
    idempotencyKey: text().notNull(),
    nextAttemptAt: timestamp({ withTimezone: true }),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("workflow_run_steps_key").on(t.runId, t.stepKey),
    uniqueIndex("workflow_run_steps_idem_key").on(t.idempotencyKey),
  ],
);

/* ------------------------------------------------------------------ */
/* Integrations                                                        */
/* ------------------------------------------------------------------ */

export const connectionStatus = pgEnum("connection_status", ["not_configured", "configured", "verified", "error", "disabled"]);

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    provider: text().notNull(),
    category: text().notNull(),
    displayName: text().notNull(),
    status: connectionStatus().notNull().default("not_configured"),
    /** AES-GCM encrypted JSON of secrets. Never returned to the client. */
    credentialsEnc: text(),
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    webhookSecretEnc: text(),
    lastVerifiedAt: timestamp({ withTimezone: true }),
    lastSyncAt: timestamp({ withTimezone: true }),
    lastError: text(),
    createdBy: uuid(),
    ...timestamps,
  },
  (t) => [uniqueIndex("integration_connections_provider_key").on(t.tenantId, t.provider)],
);

export const integrationEvents = pgTable(
  "integration_events",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    connectionId: uuid(),
    provider: text().notNull(),
    direction: text().notNull(),
    eventType: text().notNull(),
    externalId: text(),
    status: text().notNull().default("received"),
    attempts: smallint().notNull().default(0),
    /** Redacted payload for troubleshooting. */
    payload: jsonb().$type<Record<string, unknown>>(),
    error: text(),
    processedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("integration_events_external_key")
      .on(t.tenantId, t.provider, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index("integration_events_created_idx").on(t.tenantId, t.createdAt),
  ],
);

/* ------------------------------------------------------------------ */
/* AI agents                                                           */
/* ------------------------------------------------------------------ */

export const aiAgents = pgTable(
  "ai_agents",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    key: text().notNull(),
    name: text().notNull(),
    description: text(),
    isEnabled: boolean().notNull().default(true),
    /** Tenant-specific additions to the agent's base instructions. */
    instructions: text(),
    model: text(),
    allowedTools: text().array().notNull().default(sql`'{}'::text[]`),
    /** Tools that always require a human to approve the proposed action. */
    approvalTools: text().array().notNull().default(sql`'{}'::text[]`),
    monthlyBudgetUsd: integer().notNull().default(25),
    ...timestamps,
  },
  (t) => [uniqueIndex("ai_agents_key").on(t.tenantId, t.key)],
);

export const aiExecutionStatus = pgEnum("ai_execution_status", ["running", "waiting_approval", "succeeded", "failed", "cancelled", "blocked"]);

export const aiExecutions = pgTable(
  "ai_executions",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    agentKey: text().notNull(),
    userId: uuid(),
    conversationId: uuid(),
    status: aiExecutionStatus().notNull().default("running"),
    input: jsonb().$type<Record<string, unknown>>().notNull(),
    output: jsonb().$type<Record<string, unknown>>(),
    provider: text(),
    model: text(),
    promptVersion: text().notNull(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    /** Cost in micro-USD. */
    costMicros: bigint({ mode: "number" }).notNull().default(0),
    latencyMs: integer(),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("ai_executions_tenant_idx").on(t.tenantId, t.createdAt),
    index("ai_executions_agent_idx").on(t.tenantId, t.agentKey, t.createdAt),
  ],
);

export const aiToolCalls = pgTable(
  "ai_tool_calls",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    executionId: uuid()
      .notNull()
      .references(() => aiExecutions.id, { onDelete: "cascade" }),
    tool: text().notNull(),
    input: jsonb().$type<Record<string, unknown>>(),
    output: jsonb().$type<Record<string, unknown>>(),
    /** "allowed" | "denied" | "pending_approval" | "approved" | "rejected" | "error" */
    status: text().notNull(),
    approvedBy: uuid(),
    decidedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_tool_calls_execution_idx").on(t.executionId)],
);

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    userId: uuid().notNull(),
    agentKey: text().notNull().default("helpdesk"),
    title: text().notNull(),
    ...timestamps,
  },
  (t) => [index("ai_conversations_user_idx").on(t.userId, t.updatedAt)],
);

export type Citation = { sourceType: string; sourceId: string; title: string; heading: string | null; chunkId: string; version: number };

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    conversationId: uuid()
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: text().notNull(),
    content: text().notNull(),
    citations: jsonb().$type<Citation[]>().notNull().default([]),
    /** "answered" | "insufficient_sources" | "escalated" | "refused" */
    outcome: text(),
    executionId: uuid(),
    ticketId: uuid(),
    feedback: smallint(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Saved and scheduled reports                                         */
/* ------------------------------------------------------------------ */

export const savedReports = pgTable(
  "saved_reports",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text().notNull(),
    /** Standard report key, e.g. "headcount", "attrition", "leave_balances". */
    reportKey: text().notNull(),
    filters: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** Cron expression; null = not scheduled. */
    schedule: text(),
    format: text().notNull().default("csv"),
    recipients: text().array().notNull().default(sql`'{}'::text[]`),
    lastRunAt: timestamp({ withTimezone: true }),
    nextRunAt: timestamp({ withTimezone: true }),
    createdBy: uuid().notNull(),
    ...timestamps,
  },
  (t) => [index("saved_reports_schedule_idx").on(t.nextRunAt)],
);
