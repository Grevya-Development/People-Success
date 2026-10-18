import { z } from "zod";

const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const optionalId = z
  .union([z.uuid(), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));
const formBool = (fallback: boolean) =>
  z
    .union([z.boolean(), z.enum(["true", "false", "on", "off", ""])])
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : v === true || v === "true" || v === "on"));

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

/** Built-in role keys that can own a helpdesk queue. */
export const OWNER_ROLE_KEYS = ["hr_admin", "hr_manager", "payroll_admin", "finance_manager", "tenant_owner"] as const;
export const OWNER_ROLE_LABELS: Record<(typeof OWNER_ROLE_KEYS)[number], string> = {
  hr_admin: "HR Administrator",
  hr_manager: "HR Manager",
  payroll_admin: "Payroll Administrator",
  finance_manager: "Finance Manager",
  tenant_owner: "Tenant Owner",
};

const hours = (label: string, max: number) =>
  z.coerce
    .number({ message: `Enter ${label} in hours` })
    .int("Use whole hours")
    .min(1, "At least 1 hour")
    .max(max, `At most ${max} hours`);

export const ticketCategorySchema = z
  .object({
    name: z.string().trim().min(2, "Enter a name").max(80),
    description: optionalText(300),
    ownerRoleKey: z.enum(OWNER_ROLE_KEYS),
    firstResponseHours: hours("first response time", 720),
    resolutionHours: hours("resolution time", 2160),
    isSensitive: formBool(false),
    isActive: formBool(true),
  })
  .refine((c) => c.resolutionHours >= c.firstResponseHours, {
    message: "Resolution time must be at least the first response time",
    path: ["resolutionHours"],
  });
export type TicketCategoryInput = z.output<typeof ticketCategorySchema>;
export type TicketCategoryFormValues = z.input<typeof ticketCategorySchema>;
export const updateTicketCategorySchema = z.intersection(ticketCategorySchema, z.object({ id: z.uuid() }));

/* ------------------------------------------------------------------ */
/* Tickets                                                             */
/* ------------------------------------------------------------------ */

export const TICKET_STATUSES = ["open", "in_progress", "waiting_on_employee", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_on_employee: "Waiting on employee",
  resolved: "Resolved",
  closed: "Closed",
};

export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const createTicketSchema = z.object({
  subject: z.string().trim().min(5, "Summarize your question in a few words").max(160),
  description: z.string().trim().min(10, "Add a few details so HR can help").max(8000),
  categoryId: optionalId,
  priority: z.enum(TICKET_PRIORITIES).default("normal"),
});
export type CreateTicketInput = z.output<typeof createTicketSchema>;
export type CreateTicketFormValues = z.input<typeof createTicketSchema>;

export const ticketIdSchema = z.object({ id: z.uuid() });

export const replySchema = z.object({
  ticketId: z.uuid(),
  body: z.string().trim().min(1, "Write a reply").max(8000),
  internal: z.boolean().default(false),
  aiAssisted: z.boolean().default(false),
  /** Optional status to set together with the reply (agents only). */
  status: z.enum(TICKET_STATUSES).optional(),
});
export type ReplyInput = z.output<typeof replySchema>;

export const updateTicketSchema = z.object({
  id: z.uuid(),
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  categoryId: z.uuid().optional(),
  /** null unassigns. */
  assigneeUserId: z.union([z.uuid(), z.null()]).optional(),
});
export type UpdateTicketInput = z.output<typeof updateTicketSchema>;

export const rateTicketSchema = z.object({ id: z.uuid(), rating: z.number().int().min(1).max(5) });

export const QUEUE_VIEWS = ["mine", "unassigned", "overdue", "all"] as const;
export type QueueView = (typeof QUEUE_VIEWS)[number];
export const queueFilterSchema = z.object({
  view: z.enum(QUEUE_VIEWS).default("all"),
  status: z.enum([...TICKET_STATUSES, "active"] as const).optional(),
  categoryId: z.uuid().optional(),
});
export type QueueFilter = z.output<typeof queueFilterSchema>;

/* ------------------------------------------------------------------ */
/* Knowledge base                                                      */
/* ------------------------------------------------------------------ */

export const kbArticleSchema = z.object({
  title: z.string().trim().min(3, "Enter a title").max(160),
  category: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .default("general"),
  body: z.string().trim().min(20, "Write at least a couple of sentences").max(100_000),
});
export type KbArticleInput = z.output<typeof kbArticleSchema>;
export type KbArticleFormValues = z.input<typeof kbArticleSchema>;
export const updateKbArticleSchema = kbArticleSchema.extend({ id: z.uuid() });
export const kbArticleIdSchema = z.object({ id: z.uuid() });

/* ------------------------------------------------------------------ */
/* Assistant                                                           */
/* ------------------------------------------------------------------ */

export const askAssistantSchema = z.object({
  conversationId: z.uuid().nullish().transform((v) => v ?? null),
  question: z.string().trim().min(3, "Ask a question").max(1000, "Keep questions under 1,000 characters"),
});
export type AskAssistantInput = z.output<typeof askAssistantSchema>;

export const assistantFeedbackSchema = z.object({
  messageId: z.uuid(),
  /** 1 = helpful, -1 = not helpful, 0 = clear. */
  value: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
});

export const assistantMessageIdSchema = z.object({ messageId: z.uuid() });
export const conversationIdSchema = z.object({ id: z.uuid() });

export const ASSISTANT_DISCLAIMER = "Answers come from your company's published policies. HR has the final word.";

/** Where a knowledge citation links to (policies live in Documents, articles in the helpdesk). */
export const knowledgeSourceHref = (sourceType: string, sourceId: string) =>
  sourceType === "policy" ? `/documents/policies/${sourceId}` : `/helpdesk/kb/${sourceId}`;
