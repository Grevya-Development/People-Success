"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { defineAction, zodFieldErrors } from "@/server/lib/action";
import { AppError } from "@/server/lib/errors";
import { rateLimit } from "@/server/lib/rate-limit";
import { acceptTriage, createTicket, rateTicket, reopenTicket, replyToTicket, updateTicket } from "@/server/services/helpdesk/tickets";
import { draftTicketReply } from "@/server/services/helpdesk/drafts";
import { createTicketCategory, seedDefaultTicketCategories, updateTicketCategory } from "@/server/services/helpdesk/categories";
import { createKbArticle, deleteKbArticle, publishKbArticle, unpublishKbArticle, updateKbArticle } from "@/server/services/helpdesk/kb";
import { reindexKnowledge } from "@/server/services/helpdesk/knowledge";
import {
  createTicketSchema,
  kbArticleIdSchema,
  kbArticleSchema,
  rateTicketSchema,
  replySchema,
  ticketCategorySchema,
  ticketIdSchema,
  updateKbArticleSchema,
  updateTicketCategorySchema,
  updateTicketSchema,
} from "@/lib/validation/helpdesk";

/* ------------------------------------------------------------------ */
/* Tickets                                                             */
/* ------------------------------------------------------------------ */

/** FormData so attachments travel with the fields. Any member may raise a ticket. */
export const createTicketAction = defineAction({ input: z.instanceof(FormData, { message: "Invalid form" }) }, async (ctx, form) => {
  await rateLimit(`ticket:${ctx.userId}`, 20, 3600);
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
  const parsed = createTicketSchema.safeParse(fields);
  if (!parsed.success) throw new AppError("VALIDATION", "Please correct the highlighted fields.", { fieldErrors: zodFieldErrors(parsed.error) });
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  return createTicket(ctx, parsed.data, { files, channel: "portal" });
});

export const replyAction = defineAction({ input: replySchema }, async (ctx, input) => {
  const r = await replyToTicket(ctx, input);
  refresh();
  return r;
});

export const updateTicketAction = defineAction({ input: updateTicketSchema }, async (ctx, input) => {
  const r = await updateTicket(ctx, input);
  refresh();
  return r;
});

export const acceptTriageAction = defineAction({ input: ticketIdSchema }, async (ctx, { id }) => {
  const r = await acceptTriage(ctx, id);
  refresh();
  return r;
});

export const reopenTicketAction = defineAction({ input: ticketIdSchema }, async (ctx, { id }) => {
  const r = await reopenTicket(ctx, id);
  refresh();
  return r;
});

export const rateTicketAction = defineAction({ input: rateTicketSchema }, async (ctx, input) => {
  const r = await rateTicket(ctx, input);
  refresh();
  return r;
});

export const draftReplyAction = defineAction({ input: ticketIdSchema }, async (ctx, { id }) => {
  await rateLimit(`draft:${ctx.userId}`, 30, 600);
  return draftTicketReply(ctx, id);
});

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export const createTicketCategoryAction = defineAction(
  { input: ticketCategorySchema, permission: "helpdesk.manage", scope: "all" },
  async (ctx, input) => {
    const r = await createTicketCategory(ctx, input);
    refresh();
    return r;
  },
);

export const updateTicketCategoryAction = defineAction(
  { input: updateTicketCategorySchema, permission: "helpdesk.manage", scope: "all" },
  async (ctx, input) => {
    const r = await updateTicketCategory(ctx, input);
    refresh();
    return r;
  },
);

export const seedTicketCategoriesAction = defineAction({ input: z.object({}), permission: "helpdesk.manage", scope: "all" }, async (ctx) => {
  const r = await seedDefaultTicketCategories(ctx);
  refresh();
  return r;
});

export const createKbArticleAction = defineAction({ input: kbArticleSchema, permission: "helpdesk.manage", scope: "all" }, async (ctx, input) =>
  createKbArticle(ctx, input),
);

export const updateKbArticleAction = defineAction({ input: updateKbArticleSchema, permission: "helpdesk.manage", scope: "all" }, async (ctx, input) => {
  const r = await updateKbArticle(ctx, input);
  refresh();
  return r;
});

export const publishKbArticleAction = defineAction({ input: kbArticleIdSchema, permission: "helpdesk.manage", scope: "all" }, async (ctx, { id }) => {
  const r = await publishKbArticle(ctx, id);
  refresh();
  return r;
});

export const unpublishKbArticleAction = defineAction({ input: kbArticleIdSchema, permission: "helpdesk.manage", scope: "all" }, async (ctx, { id }) => {
  const r = await unpublishKbArticle(ctx, id);
  refresh();
  return r;
});

export const deleteKbArticleAction = defineAction({ input: kbArticleIdSchema, permission: "helpdesk.manage", scope: "all" }, async (ctx, { id }) =>
  deleteKbArticle(ctx, id),
);

export const reindexKnowledgeAction = defineAction(
  { input: z.object({ force: z.boolean().default(false) }), permission: "helpdesk.manage", scope: "all" },
  async (ctx, { force }) => {
    const r = await reindexKnowledge(ctx, { force });
    refresh();
    return r;
  },
);
