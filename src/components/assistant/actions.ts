"use server";

import { z } from "zod";
import { defineAction } from "@/server/lib/action";
import { rateLimit } from "@/server/lib/rate-limit";
import {
  askAssistant,
  getConversation,
  listConversations,
  raiseTicketFromMessage,
  setAssistantFeedback,
} from "@/server/services/assistant/conversations";
import { askAssistantSchema, assistantFeedbackSchema, assistantMessageIdSchema, conversationIdSchema } from "@/lib/validation/helpdesk";

export const listConversationsAction = defineAction({ input: z.object({}), permission: "ai.use" }, async (ctx) => listConversations(ctx));

export const getConversationAction = defineAction({ input: conversationIdSchema, permission: "ai.use" }, async (ctx, { id }) => getConversation(ctx, id));

export const askAssistantAction = defineAction({ input: askAssistantSchema, permission: "ai.use" }, async (ctx, input) => {
  // Each question can call the model; keep usage bounded per person.
  await rateLimit(`assistant:${ctx.userId}`, 30, 600);
  return askAssistant(ctx, input);
});

export const assistantFeedbackAction = defineAction({ input: assistantFeedbackSchema, permission: "ai.use" }, async (ctx, input) => setAssistantFeedback(ctx, input));

export const raiseTicketFromAssistantAction = defineAction({ input: assistantMessageIdSchema, permission: "ai.use" }, async (ctx, { messageId }) => {
  await rateLimit(`ticket:${ctx.userId}`, 20, 3600);
  return raiseTicketFromMessage(ctx, messageId);
});
