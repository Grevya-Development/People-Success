import {
  boolean,
  customType,
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

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const ticketCategories = pgTable(
  "ticket_categories",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text().notNull(),
    description: text(),
    /** Built-in role key that owns the queue (e.g. "hr_admin", "payroll_admin"). */
    ownerRoleKey: text().notNull().default("hr_admin"),
    firstResponseHours: smallint().notNull().default(8),
    resolutionHours: smallint().notNull().default(48),
    /** Sensitive categories (grievance, harassment) are visible only to helpdesk.manage. */
    isSensitive: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("ticket_categories_name_key").on(t.tenantId, t.name)],
);

export const ticketStatus = pgEnum("ticket_status", ["open", "in_progress", "waiting_on_employee", "resolved", "closed"]);
export const ticketPriority = pgEnum("ticket_priority", ["low", "normal", "high", "urgent"]);

export const tickets = pgTable(
  "tickets",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    number: text().notNull(),
    requesterEmployeeId: uuid(),
    requesterUserId: uuid().notNull(),
    categoryId: uuid().references(() => ticketCategories.id),
    subject: text().notNull(),
    description: text().notNull(),
    priority: ticketPriority().notNull().default("normal"),
    status: ticketStatus().notNull().default("open"),
    assigneeUserId: uuid(),
    /** "portal" | "assistant" | "email" */
    channel: text().notNull().default("portal"),
    firstResponseDueAt: timestamp({ withTimezone: true }),
    resolutionDueAt: timestamp({ withTimezone: true }),
    firstRespondedAt: timestamp({ withTimezone: true }),
    resolvedAt: timestamp({ withTimezone: true }),
    closedAt: timestamp({ withTimezone: true }),
    escalatedAt: timestamp({ withTimezone: true }),
    aiTriage: jsonb().$type<{ categoryId?: string; priority?: string; confidence: number; rationale: string; model: string } | null>(),
    satisfaction: smallint(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("tickets_number_key").on(t.tenantId, t.number),
    index("tickets_queue_idx").on(t.tenantId, t.status, t.assigneeUserId),
    index("tickets_requester_idx").on(t.requesterUserId, t.createdAt),
  ],
);

export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    ticketId: uuid()
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    authorUserId: uuid(),
    body: text().notNull(),
    /** Internal notes are never shown to the requester. */
    isInternal: boolean().notNull().default(false),
    attachmentIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    /** Set when the text was drafted by AI and sent by a human. */
    aiAssisted: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ticket_messages_ticket_idx").on(t.ticketId, t.createdAt)],
);

export const kbArticles = pgTable(
  "kb_articles",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    title: text().notNull(),
    body: text().notNull(),
    category: text().notNull().default("general"),
    status: text().notNull().default("draft"),
    publishedAt: timestamp({ withTimezone: true }),
    createdBy: uuid(),
    ...timestamps,
  },
  (t) => [index("kb_articles_status_idx").on(t.tenantId, t.status)],
);

/**
 * Retrieval index for the HR assistant: published policies and knowledge
 * base articles split into sections, searched with Postgres full-text search.
 * Answers must cite these chunks; nothing outside them is presented as policy.
 */
export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    /** "policy" | "kb_article" */
    sourceType: text().notNull(),
    sourceId: uuid().notNull(),
    sourceVersion: integer().notNull().default(1),
    sourceTitle: text().notNull(),
    /** sha256 of title + body at index time; change detection without comparing clocks. */
    sourceHash: text().notNull().default(""),
    heading: text(),
    chunkIndex: integer().notNull(),
    content: text().notNull(),
    tsv: tsvector().generatedAlwaysAs(sql`to_tsvector('english', coalesce(heading, '') || ' ' || content)`),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("knowledge_chunks_tsv_idx").using("gin", t.tsv),
    index("knowledge_chunks_source_idx").on(t.tenantId, t.sourceType, t.sourceId),
  ],
);
