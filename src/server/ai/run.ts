import { and, eq, gte, sql } from "drizzle-orm";
import type { z } from "zod";
import { withSystem } from "../db/tx";
import { aiAgents, aiExecutions } from "../db/schema";
import { logger } from "../lib/logger";
import { sha256 } from "../lib/crypto";
import { agentDefinition } from "./agents";
import { costMicros, priceFor } from "./pricing";
import { getProvider, type Effort, type LlmMessage } from "./providers";

export type AiActor = { tenantId: string; userId: string | null };

export type AiOutcome<T> =
  | { source: "ai"; data: T; executionId: string; model: string; fellBack: boolean }
  /** Rule-based result: AI disabled, unconfigured, over budget, refused or failed. */
  | { source: "rules"; data: T; reason: string; executionId: string | null };

type RunOptions<S extends z.ZodType> = {
  agentKey: string;
  task: string;
  system: string;
  messages: LlmMessage[];
  schema: S;
  effort?: Effort;
  maxTokens?: number;
  conversationId?: string;
  /** Deterministic implementation used whenever AI cannot run. */
  fallback: () => Promise<z.infer<S>> | z.infer<S>;
};

async function agentConfig(tenantId: string, agentKey: string) {
  const def = agentDefinition(agentKey);
  if (!def) throw new Error(`Unknown agent ${agentKey}`);
  return withSystem(async (tx) => {
    const [row] = await tx
      .select()
      .from(aiAgents)
      .where(and(eq(aiAgents.tenantId, tenantId), eq(aiAgents.key, agentKey)));
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [{ spent }] = await tx
      .select({ spent: sql<number>`coalesce(sum(${aiExecutions.costMicros}), 0)`.mapWith(Number) })
      .from(aiExecutions)
      .where(and(eq(aiExecutions.tenantId, tenantId), eq(aiExecutions.agentKey, agentKey), gte(aiExecutions.createdAt, monthStart)));
    return {
      def,
      enabled: row?.isEnabled ?? true,
      instructions: row?.instructions ?? null,
      model: row?.model ?? null,
      budgetMicros: (row?.monthlyBudgetUsd ?? 25) * 1_000_000,
      spentMicros: spent,
    };
  }, tenantId);
}

/**
 * Governed LLM call: checks the agent is enabled and within budget, records
 * an execution (tokens, cost, latency, prompt version), validates structured
 * output, and falls back to deterministic logic on any failure so features
 * keep working without AI.
 *
 * Inputs are not stored verbatim (they can contain personal data); a hash and
 * size are kept for traceability.
 */
export async function runAi<S extends z.ZodType>(actor: AiActor, opts: RunOptions<S>): Promise<AiOutcome<z.infer<S>>> {
  const cfg = await agentConfig(actor.tenantId, opts.agentKey);
  const provider = getProvider();
  const rules = async (reason: string, executionId: string | null = null): Promise<AiOutcome<z.infer<S>>> => ({
    source: "rules",
    data: await opts.fallback(),
    reason,
    executionId,
  });

  if (!cfg.enabled) return rules("This AI agent is turned off for your organization.");
  if (!provider) return rules("AI is not configured. Showing a rule-based result.");
  if (cfg.spentMicros >= cfg.budgetMicros) return rules("This agent reached its monthly AI budget. Showing a rule-based result.");

  const system = [cfg.def.baseInstructions, cfg.instructions ? `Organization guidance:\n${cfg.instructions}` : null, opts.system]
    .filter(Boolean)
    .join("\n\n");
  const inputDigest = sha256(system + JSON.stringify(opts.messages));
  const [exec] = await withSystem(
    (tx) =>
      tx
        .insert(aiExecutions)
        .values({
          tenantId: actor.tenantId,
          agentKey: opts.agentKey,
          userId: actor.userId,
          conversationId: opts.conversationId ?? null,
          status: "running",
          input: { task: opts.task, digest: inputDigest, chars: JSON.stringify(opts.messages).length },
          provider: provider.name,
          model: cfg.model ?? provider.defaultModel,
          promptVersion: cfg.def.promptVersion,
        })
        .returning({ id: aiExecutions.id }),
    actor.tenantId,
  );

  const started = Date.now();
  try {
    const result = await provider.complete({
      system,
      messages: opts.messages,
      schema: opts.schema,
      schemaName: opts.task.replace(/\W+/g, "_"),
      effort: opts.effort,
      maxTokens: opts.maxTokens,
      model: cfg.model ?? undefined,
    });
    const cost = costMicros(result.model, result.inputTokens, result.outputTokens);
    const parsed = result.parsed ? opts.schema.safeParse(result.parsed) : null;
    const ok = !result.refused && parsed?.success;
    await withSystem(
      (tx) =>
        tx
          .update(aiExecutions)
          .set({
            status: ok ? "succeeded" : result.refused ? "blocked" : "failed",
            output: ok ? { summary: "structured output validated" } : { stopReason: result.stopReason, refusalCategory: result.refusalCategory },
            model: result.model,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            costMicros: cost,
            latencyMs: Date.now() - started,
            error: ok ? (priceFor(result.model).known ? null : "price unknown for model; cost recorded as 0") : result.refused ? `refused (${result.refusalCategory ?? "unspecified"})` : "output failed schema validation",
            finishedAt: new Date(),
          })
          .where(eq(aiExecutions.id, exec.id)),
      actor.tenantId,
    );
    if (!ok) {
      return rules(result.refused ? "The AI model declined this request. Showing a rule-based result." : "The AI response could not be validated. Showing a rule-based result.", exec.id);
    }
    return { source: "ai", data: parsed!.data, executionId: exec.id, model: result.model, fellBack: result.fellBack };
  } catch (err) {
    logger.error("ai.call_failed", { agent: opts.agentKey, task: opts.task, err });
    await withSystem(
      (tx) =>
        tx
          .update(aiExecutions)
          .set({ status: "failed", error: err instanceof Error ? err.message.slice(0, 500) : "error", latencyMs: Date.now() - started, finishedAt: new Date() })
          .where(eq(aiExecutions.id, exec.id)),
      actor.tenantId,
    );
    return rules("The AI service is unavailable right now. Showing a rule-based result.", exec.id);
  }
}
