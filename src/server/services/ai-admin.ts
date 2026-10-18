import { desc, eq, gte, sql } from "drizzle-orm";
import type { z } from "zod";
import { authorize, type RequestContext } from "../auth/context";
import { aiAgents, aiExecutions, users } from "../db/schema";
import { audit } from "../lib/audit";
import { AppError } from "../lib/errors";
import { AGENTS, agentDefinition } from "../ai/agents";
import { providerStatus } from "../ai/providers";

function monthStart() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function aiOverview(ctx: RequestContext) {
  authorize(ctx, "ai.manage", "all");
  const since = monthStart();
  return ctx.db(async (tx) => {
    const [configs, usage, recent] = await Promise.all([
      tx.select().from(aiAgents),
      tx
        .select({
          agentKey: aiExecutions.agentKey,
          runs: sql<number>`count(*)`.mapWith(Number),
          failed: sql<number>`count(*) filter (where ${aiExecutions.status} in ('failed','blocked'))`.mapWith(Number),
          inputTokens: sql<number>`coalesce(sum(${aiExecutions.inputTokens}),0)`.mapWith(Number),
          outputTokens: sql<number>`coalesce(sum(${aiExecutions.outputTokens}),0)`.mapWith(Number),
          costMicros: sql<number>`coalesce(sum(${aiExecutions.costMicros}),0)`.mapWith(Number),
          p50Latency: sql<number | null>`percentile_cont(0.5) within group (order by ${aiExecutions.latencyMs})`.mapWith((v) => (v == null ? null : Number(v))),
        })
        .from(aiExecutions)
        .where(gte(aiExecutions.createdAt, since))
        .groupBy(aiExecutions.agentKey),
      tx
        .select({
          id: aiExecutions.id,
          agentKey: aiExecutions.agentKey,
          status: aiExecutions.status,
          model: aiExecutions.model,
          promptVersion: aiExecutions.promptVersion,
          task: sql<string>`${aiExecutions.input} ->> 'task'`,
          inputTokens: aiExecutions.inputTokens,
          outputTokens: aiExecutions.outputTokens,
          costMicros: aiExecutions.costMicros,
          latencyMs: aiExecutions.latencyMs,
          error: aiExecutions.error,
          createdAt: aiExecutions.createdAt,
          userName: users.fullName,
        })
        .from(aiExecutions)
        .leftJoin(users, eq(users.id, aiExecutions.userId))
        .orderBy(desc(aiExecutions.createdAt))
        .limit(50),
    ]);
    return {
      provider: providerStatus(),
      agents: AGENTS.map((a) => {
        const c = configs.find((x) => x.key === a.key);
        const u = usage.find((x) => x.agentKey === a.key);
        return {
          key: a.key,
          name: a.name,
          description: a.description,
          permission: a.permission,
          promptVersion: a.promptVersion,
          tools: a.defaultTools,
          approvalTools: a.approvalTools,
          enabled: c?.isEnabled ?? true,
          instructions: c?.instructions ?? "",
          model: c?.model ?? "",
          monthlyBudgetUsd: c?.monthlyBudgetUsd ?? 25,
          usage: {
            runs: u?.runs ?? 0,
            failed: u?.failed ?? 0,
            inputTokens: u?.inputTokens ?? 0,
            outputTokens: u?.outputTokens ?? 0,
            costUsd: (u?.costMicros ?? 0) / 1_000_000,
            p50LatencyMs: u?.p50Latency ?? null,
          },
        };
      }),
      recent: recent.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), costUsd: r.costMicros / 1_000_000 })),
    };
  });
}

export { agentConfigSchema } from "./ai-admin-schema";
import { agentConfigSchema } from "./ai-admin-schema";

export async function saveAgentConfig(ctx: RequestContext, input: z.infer<typeof agentConfigSchema>) {
  authorize(ctx, "ai.manage", "all");
  const def = agentDefinition(input.key);
  if (!def) throw new AppError("VALIDATION", "Unknown agent.");
  return ctx.db(async (tx) => {
    const values = {
      isEnabled: input.enabled,
      monthlyBudgetUsd: input.monthlyBudgetUsd,
      model: input.model || null,
      instructions: input.instructions || null,
    };
    await tx
      .insert(aiAgents)
      .values({ tenantId: ctx.tenantId, key: def.key, name: def.name, description: def.description, ...values })
      .onConflictDoUpdate({ target: [aiAgents.tenantId, aiAgents.key], set: values });
    await audit(tx, ctx, { action: "ai.agent_configured", entityType: "ai_agent", entityId: def.key, metadata: { enabled: input.enabled, budget: input.monthlyBudgetUsd, model: input.model || null } });
  });
}

