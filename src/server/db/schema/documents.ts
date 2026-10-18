import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { deletedAt, pk, tenantRef, timestamps } from "./_helpers";
import { tenants } from "./identity";

export const documentCategory = pgEnum("document_category", [
  "identity",
  "statutory",
  "contract",
  "offer_letter",
  "policy",
  "certificate",
  "education",
  "appraisal",
  "payslip",
  "tax",
  "exit",
  "letter",
  "receipt",
  "resume",
  "other",
]);

export const scanStatus = pgEnum("scan_status", [
  "pending",
  "clean",
  "infected",
  "skipped",
  "error",
]);

/**
 * Metadata for every stored file. Bytes live in Supabase Storage (private
 * bucket). Downloads only happen through short-lived signed URLs minted after
 * an authorization check, and every download is logged.
 */
export const documents = pgTable(
  "documents",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    /** "employee" | "candidate" | "company" | "payroll_run" | "expense_claim" | "ticket" ... */
    ownerType: text().notNull(),
    ownerId: uuid(),
    /** Convenience link for employee documents; drives self-service visibility. */
    employeeId: uuid(),
    category: documentCategory().notNull().default("other"),
    title: text().notNull(),
    bucket: text().notNull().default("documents"),
    storagePath: text().notNull(),
    fileName: text().notNull(),
    mimeType: text().notNull(),
    sizeBytes: bigint({ mode: "number" }).notNull(),
    sha256: text(),
    version: integer().notNull().default(1),
    /** Previous version this document supersedes. */
    supersedesId: uuid(),
    isCurrent: boolean().notNull().default(true),
    /** Visible to the employee in self-service. HR-only otherwise. */
    employeeVisible: boolean().notNull().default(true),
    isSensitive: boolean().notNull().default(false),
    expiresOn: date(),
    retainUntil: date(),
    legalHold: boolean().notNull().default(false),
    scanStatus: scanStatus().notNull().default("pending"),
    verifiedBy: uuid(),
    verifiedAt: timestamp({ withTimezone: true }),
    uploadedBy: uuid(),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    deletedAt: deletedAt(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("documents_storage_path_key").on(t.bucket, t.storagePath),
    index("documents_owner_idx").on(t.tenantId, t.ownerType, t.ownerId),
    index("documents_employee_idx").on(t.tenantId, t.employeeId),
    index("documents_expiry_idx")
      .on(t.tenantId, t.expiresOn)
      .where(sql`${t.expiresOn} is not null and ${t.deletedAt} is null`),
  ],
);

export const documentAccessLogs = pgTable(
  "document_access_logs",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    documentId: uuid()
      .notNull()
      .references(() => documents.id),
    userId: uuid(),
    action: text().notNull(),
    ip: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("document_access_logs_doc_idx").on(t.documentId, t.createdAt)],
);

export const templateKind = pgEnum("template_kind", [
  "offer_letter",
  "appointment_letter",
  "experience_letter",
  "relieving_letter",
  "confirmation_letter",
  "salary_revision_letter",
  "warning_letter",
  "email",
  "policy",
  "other",
]);

/** Versioned templates. Rendering uses {{placeholders}} resolved server-side. */
export const documentTemplates = pgTable(
  "document_templates",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    kind: templateKind().notNull(),
    name: text().notNull(),
    description: text(),
    isActive: boolean().notNull().default(true),
    currentVersion: integer().notNull().default(1),
    ...timestamps,
  },
  (t) => [uniqueIndex("document_templates_tenant_name_key").on(t.tenantId, t.name)],
);

export const documentTemplateVersions = pgTable(
  "document_template_versions",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    templateId: uuid()
      .notNull()
      .references(() => documentTemplates.id),
    version: integer().notNull(),
    /** Markdown-ish body with {{placeholders}}. */
    body: text().notNull(),
    subject: text(),
    placeholders: text().array().notNull().default(sql`'{}'::text[]`),
    createdBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("document_template_versions_key").on(t.templateId, t.version)],
);

/** Policy documents employees must read and acknowledge. */
export const policies = pgTable(
  "policies",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    title: text().notNull(),
    category: text().notNull().default("general"),
    summary: text(),
    /** Markdown body; also indexed for helpdesk retrieval. */
    body: text().notNull(),
    version: integer().notNull().default(1),
    effectiveFrom: date().notNull(),
    requiresAcknowledgement: boolean().notNull().default(false),
    documentId: uuid(),
    status: text().notNull().default("draft"),
    publishedAt: timestamp({ withTimezone: true }),
    publishedBy: uuid(),
    ...timestamps,
  },
  (t) => [index("policies_tenant_status_idx").on(t.tenantId, t.status)],
);

export const policyAcknowledgements = pgTable(
  "policy_acknowledgements",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    policyId: uuid()
      .notNull()
      .references(() => policies.id),
    policyVersion: integer().notNull(),
    employeeId: uuid().notNull(),
    acknowledgedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ip: text(),
  },
  (t) => [
    uniqueIndex("policy_ack_key").on(t.policyId, t.policyVersion, t.employeeId),
  ],
);
