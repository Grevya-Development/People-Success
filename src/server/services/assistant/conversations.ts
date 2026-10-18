import "server-only";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { authorize, type RequestContext } from "../../auth/context";
import { runAi } from "../../ai/run";
import { aiConversations, aiExecutions, aiMessages, tickets, type Citation } from "../../db/schema";
import { audit } from "../../lib/audit";
import { invalidState, notFound } from "../../lib/errors";
import { knowledgeSourceHref, type AskAssistantInput } from "@/lib/validation/helpdesk";
import { knowledgeIsStale, syncKnowledge } from "../helpdesk/knowledge";
import { sensitiveTopic } from "../helpdesk/rules";
import { createTicket } from "../helpdesk/tickets";
import { isStrongMatch, searchKnowledge, type RetrievedChunk } from "./retrieval";

export type AssistantOutcome = "answered" | "insufficient_sources" | "escalated" | "refused";

export type AssistantCitation = Citation & { href: string };

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: AssistantCitation[];
  outcome: AssistantOutcome | null;
  /** "ai" when a model wrote the answer, "rules" for verbatim excerpts; null for non-answers. */
  source: "ai" | "rules" | null;
  ticket: { id: string; number: string } | null;
  feedback: number | null;
  createdAt: string;
};

export const NOT_FOUND_MESSAGE =
  "I couldn't find this in your company's published policies, so I won't guess. You can raise an HR ticket and the HR team will get back to you.";
export const NEEDS_HUMAN_MESSAGE =
  "This needs someone from HR to look at it — I couldn't answer it reliably from your company's published policies. Raise an HR ticket and the right team will follow up.";
export const SENSITIVE_MESSAGE =
  "This sounds like a sensitive matter, so I won't try to answer it here. Raise a confidential HR ticket — it goes only to the HR team that handles these concerns.";
export const EXCERPTS_INTRO = "Here are the most relevant policy sections:";

const answerSchema = z.object({
  answer: z.string().max(6000),
  citations: z.array(z.string()).max(12),
  confidence: z.enum(["high", "medium", "low"]),
  needsHuman: z.boolean(),
  sensitive: z.boolean(),
});
type Answer = z.infer<typeof answerSchema>;

const label = (c: Pick<RetrievedChunk, "sourceTitle" | "heading">) =>
  `${c.sourceTitle}${c.heading && c.heading !== c.sourceTitle ? ` — ${c.heading}` : ""}`;

/** Deterministic answer: quote the strongest excerpts verbatim, or admit there is nothing. */
function excerptAnswer(chunks: RetrievedChunk[]): Answer {
  const strong = chunks.filter(isStrongMatch).slice(0, 3);
  if (!strong.length) return { answer: "", citations: [], confidence: "low", needsHuman: true, sensitive: false };
  return {
    answer: [EXCERPTS_INTRO, ...strong.map((c) => `**${label(c)}**\n\n${c.content}`)].join("\n\n"),
    citations: strong.map((c) => c.id),
    confidence: "medium",
    needsHuman: false,
    sensitive: false,
  };
}

const toCitation = (c: RetrievedChunk): Citation => ({
  sourceType: c.sourceType,
  sourceId: c.sourceId,
  title: c.sourceTitle,
  heading: c.heading,
  chunkId: c.id,
  version: c.sourceVersion,
});

const withHref = (c: Citation): AssistantCitation => ({ ...c, href: knowledgeSourceHref(c.sourceType, c.sourceId) });

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function listConversations(ctx: RequestContext) {
  authorize(ctx, "ai.use");
  return ctx.db((tx) =>
    tx
      .select({ id: aiConversations.id, title: aiConversations.title, updatedAt: aiConversations.updatedAt })
      .from(aiConversations)
      .where(eq(aiConversations.userId, ctx.userId))
      .orderBy(desc(aiConversations.updatedAt))
      .limit(30),
  ).then((rows) => rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })));
}

export async function getConversation(ctx: RequestContext, id: string) {
  authorize(ctx, "ai.use");
  return ctx.db(async (tx) => {
    const [conv] = await tx.select().from(aiConversations).where(eq(aiConversations.id, id));
    if (!conv) throw notFound("Conversation");
    const rows = await tx
      .select({ m: aiMessages, execStatus: aiExecutions.status, ticketNumber: tickets.number })
      .from(aiMessages)
      .leftJoin(aiExecutions, eq(aiExecutions.id, aiMessages.executionId))
      .leftJoin(tickets, eq(tickets.id, aiMessages.ticketId))
      .where(eq(aiMessages.conversationId, id))
      .orderBy(asc(aiMessages.createdAt))
      .limit(200);
    return { id: conv.id, title: conv.title, messages: rows.map(({ m, execStatus, ticketNumber }) => toView(m, execStatus, ticketNumber)) };
  });
}

function toView(m: typeof aiMessages.$inferSelect, execStatus: string | null, ticketNumber: string | null): AssistantMessage {
  return {
    id: m.id,
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
    citations: m.citations.map(withHref),
    outcome: (m.outcome as AssistantOutcome | null) ?? null,
    source: m.role === "assistant" && m.outcome === "answered" ? (execStatus === "succeeded" ? "ai" : "rules") : null,
    ticket: m.ticketId ? { id: m.ticketId, number: ticketNumber ?? "Ticket" } : null,
    feedback: m.feedback,
    createdAt: m.createdAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Ask                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Answer an HR question from the company's published policies and KB
 * articles only. The model sees numbered excerpts and must cite them; cited
 * ids not in the retrieved set are dropped. No excerpts, low confidence, no
 * valid citations, or a sensitive/needs-a-human signal produce an honest
 * "not found / ask HR" reply with a one-click ticket instead of an answer.
 * The assistant has no tools and never sees personal records.
 */
export async function askAssistant(ctx: RequestContext, input: AskAssistantInput) {
  authorize(ctx, "ai.use");
  const question = input.question;

  const prep = await ctx.db(async (tx) => {
    let conversationId = input.conversationId;
    if (conversationId) {
      const [conv] = await tx.select({ id: aiConversations.id }).from(aiConversations).where(eq(aiConversations.id, conversationId));
      if (!conv) throw notFound("Conversation");
    } else {
      const [conv] = await tx
        .insert(aiConversations)
        .values({ tenantId: ctx.tenantId, userId: ctx.userId, agentKey: "helpdesk", title: question.slice(0, 80) })
        .returning({ id: aiConversations.id });
      conversationId = conv.id;
    }
    const [userMsg] = await tx
      .insert(aiMessages)
      .values({ tenantId: ctx.tenantId, conversationId, role: "user", content: question })
      .returning();
    // Pick up policies published since the last scheduled sync.
    if (await knowledgeIsStale(tx, ctx.tenantId)) await syncKnowledge(tx, ctx.tenantId);
    const chunks = await searchKnowledge(tx, ctx.tenantId, question, 6);
    return { conversationId, userMsg, chunks };
  });
  const { conversationId, chunks } = prep;

  let outcome: AssistantOutcome;
  let content: string;
  let cited: RetrievedChunk[] = [];
  let executionId: string | null = null;

  if (sensitiveTopic(question)) {
    // Deterministic: sensitive questions are routed to a person, never to a model.
    outcome = "escalated";
    content = SENSITIVE_MESSAGE;
  } else if (!chunks.length) {
    outcome = "insufficient_sources";
    content = NOT_FOUND_MESSAGE;
  } else {
    const excerpts = chunks
      .map((c, i) => `[${i + 1}] id=${c.id}\nSource: ${label(c)} (version ${c.sourceVersion})\n${c.content}`)
      .join("\n\n---\n\n");
    const out = await runAi(
      { tenantId: ctx.tenantId, userId: ctx.userId },
      {
        agentKey: "helpdesk",
        task: "helpdesk.answer",
        conversationId,
        system: [
          "You are the company's HR assistant. Answer the employee's question using ONLY the numbered policy excerpts below.",
          "Every statement of policy must be supported by an excerpt; list the ids of the excerpts you used in `citations` (use the id= values exactly).",
          "If the excerpts do not clearly answer the question, set confidence to \"low\", needsHuman to true and leave the answer short. Never fill gaps with general knowledge or typical Indian practice.",
          "Set `sensitive` to true for harassment, grievances, health, disciplinary or other personal matters. You cannot see anyone's personal records (balances, salary, tickets) — if the question needs them, set needsHuman to true.",
          "Write in plain, friendly English; short paragraphs or bullets; no headings.",
        ].join("\n"),
        messages: [{ role: "user", content: `Question: ${question}\n\nPolicy excerpts:\n\n${excerpts}` }],
        schema: answerSchema,
        effort: "medium",
        maxTokens: 6000,
        fallback: () => excerptAnswer(chunks),
      },
    );
    executionId = out.executionId;
    const allowed = new Map(chunks.map((c) => [c.id, c]));
    // Drop any citation that was not in the retrieved set (hallucinated or stale ids).
    cited = [...new Set(out.data.citations)].map((id) => allowed.get(id)).filter((c): c is RetrievedChunk => !!c);
    if (out.data.sensitive) {
      outcome = "escalated";
      content = SENSITIVE_MESSAGE;
      cited = [];
    } else if (out.data.needsHuman) {
      outcome = out.data.confidence === "low" || !cited.length ? "insufficient_sources" : "escalated";
      content = outcome === "escalated" ? NEEDS_HUMAN_MESSAGE : NOT_FOUND_MESSAGE;
      cited = [];
    } else if (out.data.confidence === "low" || !cited.length || !out.data.answer.trim()) {
      outcome = "insufficient_sources";
      content = NOT_FOUND_MESSAGE;
      cited = [];
    } else {
      outcome = "answered";
      content = out.data.answer.trim();
    }
  }

  const assistantMsg = await ctx.db(async (tx) => {
    const [m] = await tx
      .insert(aiMessages)
      .values({
        tenantId: ctx.tenantId,
        conversationId,
        role: "assistant",
        content,
        citations: cited.map(toCitation),
        outcome,
        executionId,
      })
      .returning();
    await tx.update(aiConversations).set({ updatedAt: new Date() }).where(eq(aiConversations.id, conversationId));
    const [exec] = executionId ? await tx.select({ status: aiExecutions.status }).from(aiExecutions).where(eq(aiExecutions.id, executionId)) : [];
    return toView(m, exec?.status ?? null, null);
  });
  return { conversationId, userMessage: toView(prep.userMsg, null, null), assistantMessage: assistantMsg };
}

/* ------------------------------------------------------------------ */
/* Feedback and escalation                                             */
/* ------------------------------------------------------------------ */

export async function setAssistantFeedback(ctx: RequestContext, input: { messageId: string; value: 1 | -1 | 0 }) {
  authorize(ctx, "ai.use");
  return ctx.db(async (tx) => {
    const [m] = await tx
      .update(aiMessages)
      .set({ feedback: input.value === 0 ? null : input.value })
      .where(and(eq(aiMessages.id, input.messageId), eq(aiMessages.role, "assistant")))
      .returning({ id: aiMessages.id });
    if (!m) throw notFound("Message");
    return { id: m.id };
  });
}

/**
 * One-click "Raise HR ticket" from an assistant reply: the employee's
 * question becomes a ticket (channel "assistant") and the reply links to it.
 * Triage and the sensitive-topic routing apply as for any other ticket.
 */
export async function raiseTicketFromMessage(ctx: RequestContext, messageId: string) {
  authorize(ctx, "ai.use");
  const ctxRow = await ctx.db(async (tx) => {
    const [m] = await tx.select().from(aiMessages).where(eq(aiMessages.id, messageId));
    if (!m || m.role !== "assistant") throw notFound("Message");
    if (m.ticketId) {
      const [t] = await tx.select({ id: tickets.id, number: tickets.number }).from(tickets).where(eq(tickets.id, m.ticketId));
      return { existing: t ?? { id: m.ticketId, number: "Ticket" }, question: null };
    }
    const [q] = await tx
      .select({ content: aiMessages.content })
      .from(aiMessages)
      .where(and(eq(aiMessages.conversationId, m.conversationId), eq(aiMessages.role, "user"), lte(aiMessages.createdAt, m.createdAt)))
      .orderBy(desc(aiMessages.createdAt))
      .limit(1);
    if (!q) throw invalidState("There is no question to raise.");
    return { existing: null, question: q.content };
  });
  if (ctxRow.existing) return { ticketId: ctxRow.existing.id, number: ctxRow.existing.number, alreadyRaised: true };

  const question = ctxRow.question!;
  const subject = (question.length >= 5 ? question : `HR question: ${question}`).replace(/\s+/g, " ").slice(0, 160);
  const ticket = await createTicket(
    ctx,
    {
      subject,
      description: `${question}\n\n— Raised from the HR assistant, which could not answer this from the company's published policies.`,
      categoryId: null,
      priority: "normal",
    },
    { channel: "assistant" },
  );
  await ctx.db(async (tx) => {
    await tx
      .update(aiMessages)
      .set({ ticketId: ticket.id, outcome: "escalated" })
      .where(and(eq(aiMessages.id, messageId), sql`${aiMessages.ticketId} is null`));
    await audit(tx, ctx, { action: "assistant.ticket_raised", entityType: "ticket", entityId: ticket.id, metadata: { messageId } });
  });
  return { ticketId: ticket.id, number: ticket.number, alreadyRaised: false };
}
