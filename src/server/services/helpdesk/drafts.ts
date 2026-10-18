import "server-only";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { RequestContext } from "../../auth/context";
import { runAi } from "../../ai/run";
import { ticketCategories, tickets, users } from "../../db/schema";
import { env } from "../../env";
import { forbidden, notFound } from "../../lib/errors";
import { knowledgeSourceHref } from "@/lib/validation/helpdesk";
import { searchKnowledge, type RetrievedChunk } from "../assistant/retrieval";
import { canManageHelpdesk, isHelpdeskAgent } from "./rules";

export type DraftReply = {
  body: string;
  source: "ai" | "rules";
  /** Why a rule-based draft was used (AI off, confidential ticket, ...). */
  note: string | null;
  sources: { title: string; heading: string | null; href: string }[];
};

const draftSchema = z.object({
  reply: z.string().min(1).max(4000),
  usedChunkIds: z.array(z.string()).max(6),
});

const firstName = (name: string | null) => (name ?? "").trim().split(/\s+/)[0] || "there";

function templateReply(t: { number: string; subject: string }, requester: string | null, agent: string | null, chunks: RetrievedChunk[]) {
  const base = env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const links = chunks.slice(0, 3).map((c) => `- ${c.sourceTitle}${c.heading && c.heading !== c.sourceTitle ? ` — ${c.heading}` : ""}: ${base}${knowledgeSourceHref(c.sourceType, c.sourceId)}`);
  return [
    `Hi ${firstName(requester)},`,
    `Thanks for reaching out about “${t.subject}”. We have received your request (${t.number}) and are looking into it.`,
    links.length ? `In the meantime, these sections of our published policies may help:\n${links.join("\n")}` : null,
    "We will update you here as soon as we can.",
    `Regards,\n${agent ?? "HR team"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Draft a reply for an agent to edit and send. Uses the ticket text and the
 * most relevant published policy sections. Confidential tickets are never
 * sent to an AI model: they get the templated acknowledgement.
 */
export async function draftTicketReply(ctx: RequestContext, ticketId: string): Promise<DraftReply> {
  const loaded = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        t: tickets,
        sensitive: ticketCategories.isSensitive,
        requesterName: sql<string | null>`(select coalesce(u.full_name, u.email) from users u where u.id = ${tickets.requesterUserId})`,
      })
      .from(tickets)
      .leftJoin(ticketCategories, eq(ticketCategories.id, tickets.categoryId))
      .where(eq(tickets.id, ticketId));
    if (!row) throw notFound("Ticket");
    const works = row.t.assigneeUserId === ctx.userId || canManageHelpdesk(ctx) || (isHelpdeskAgent(ctx) && !row.sensitive);
    if (!works || (row.t.requesterUserId === ctx.userId && !canManageHelpdesk(ctx))) throw forbidden();
    const [me] = await tx.select({ name: sql<string | null>`coalesce(${users.fullName}, ${users.email})` }).from(users).where(eq(users.id, ctx.userId));
    const chunks = await searchKnowledge(tx, ctx.tenantId, `${row.t.subject} ${row.t.description}`, 4);
    return { ...row, agentName: me?.name ?? null, chunks };
  });
  const { t, chunks } = loaded;
  const sources = chunks.slice(0, 3).map((c) => ({ title: c.sourceTitle, heading: c.heading, href: knowledgeSourceHref(c.sourceType, c.sourceId) }));
  const fallback = () => ({ reply: templateReply(t, loaded.requesterName, loaded.agentName, chunks), usedChunkIds: chunks.slice(0, 3).map((c) => c.id) });

  if (loaded.sensitive) {
    return { body: fallback().reply, source: "rules", note: "Confidential tickets are never sent to AI. This is a templated acknowledgement.", sources };
  }

  const excerpts = chunks.map((c, i) => `[${i + 1}] id=${c.id}\nSource: ${c.sourceTitle}${c.heading ? ` — ${c.heading}` : ""} (version ${c.sourceVersion})\n${c.content}`).join("\n\n---\n\n");
  const out = await runAi(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    {
      agentKey: "helpdesk",
      task: "helpdesk.draft_reply",
      system: [
        "Draft a short, warm reply from an HR agent to the employee who raised this ticket.",
        "Base any policy statement ONLY on the excerpts provided and mention the policy by name. If the excerpts do not answer the question, acknowledge the request and say HR is checking; do not guess.",
        "Never promise outcomes (approvals, payments, decisions). Plain text, no Markdown headings. Sign off as the agent.",
        `Agent name: ${loaded.agentName ?? "HR team"}. Employee first name: ${firstName(loaded.requesterName)}. Ticket number: ${t.number}.`,
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: `Ticket subject: ${t.subject}\n\nTicket description:\n${t.description.slice(0, 4000)}\n\nPolicy excerpts:\n${excerpts || "(none found)"}`,
        },
      ],
      schema: draftSchema,
      effort: "low",
      maxTokens: 4000,
      fallback,
    },
  );
  const used = new Set(out.data.usedChunkIds);
  return {
    body: out.data.reply,
    source: out.source,
    note: out.source === "rules" ? `${out.reason} Rule-based draft: a templated acknowledgement with relevant policy links.` : null,
    sources: out.source === "ai" ? chunks.filter((c) => used.has(c.id)).map((c) => ({ title: c.sourceTitle, heading: c.heading, href: knowledgeSourceHref(c.sourceType, c.sourceId) })) : sources,
  };
}
