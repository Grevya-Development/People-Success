import "server-only";
import { z } from "zod";
import { runAi, type AiActor } from "../../ai/run";
import type { tickets } from "../../db/schema";
import { keywordTriage } from "./rules";

export type AiTriage = NonNullable<(typeof tickets.$inferSelect)["aiTriage"]>;

const triageSchema = z.object({
  categoryId: z.string().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(400),
});

/**
 * Suggest a category and priority for a new ticket. Advisory only: the
 * suggestion is stored on the ticket and an agent accepts or changes it.
 * Only non-sensitive categories are offered to the model; sensitive matters
 * are routed by the deterministic rule before this is ever called.
 */
export async function triageTicket(
  actor: AiActor,
  ticket: { subject: string; description: string },
  categories: { id: string; name: string; description: string | null; isSensitive: boolean }[],
): Promise<AiTriage> {
  const offered = categories.filter((c) => !c.isSensitive);
  const text = `${ticket.subject}\n${ticket.description}`;
  const out = await runAi(actor, {
    agentKey: "helpdesk",
    task: "helpdesk.triage",
    system: [
      "Classify an employee's HR helpdesk ticket.",
      "Choose the single best category id from the list, or null if none fits. Choose a priority: urgent only when pay or the ability to work is blocked today; high for time-sensitive issues; low for general questions.",
      "Give a confidence between 0 and 1 and a one-sentence rationale that does not repeat personal details.",
      `Categories:\n${offered.map((c) => `- ${c.id}: ${c.name}${c.description ? ` — ${c.description}` : ""}`).join("\n")}`,
    ].join("\n\n"),
    messages: [{ role: "user", content: `Subject: ${ticket.subject}\n\nDescription:\n${ticket.description.slice(0, 4000)}` }],
    schema: triageSchema,
    effort: "low",
    maxTokens: 2000,
    fallback: () => keywordTriage(text, offered),
  });
  const valid = out.data.categoryId && offered.some((c) => c.id === out.data.categoryId) ? out.data.categoryId : null;
  return {
    ...(valid ? { categoryId: valid } : {}),
    priority: out.data.priority,
    confidence: Math.round(out.data.confidence * 100) / 100,
    rationale: out.data.rationale,
    model: out.source === "ai" ? out.model : "rules",
  };
}
