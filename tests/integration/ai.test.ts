import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { aiAgents, aiExecutions } from "@/server/db/schema";
import { runAi } from "@/server/ai/run";
import { setProviderForTests, type LlmProvider, type LlmResult } from "@/server/ai/providers";
import { createOwnedTenant } from "../helpers/fixtures";

const schema = z.object({ summary: z.string(), score: z.number().int().min(0).max(5) });

function stub(result: Partial<LlmResult>): LlmProvider & { calls: number } {
  const p = {
    name: "anthropic" as const,
    defaultModel: "claude-opus-5-5",
    calls: 0,
    async complete() {
      p.calls++;
      return {
        provider: "anthropic" as const,
        model: "claude-opus-5-5",
        text: "",
        parsed: null,
        inputTokens: 1000,
        outputTokens: 200,
        refused: false,
        refusalCategory: null,
        stopReason: "end_turn",
        fellBack: false,
        ...result,
      };
    },
  };
  return p;
}

describe("governed AI calls", () => {
  let tenantId: string;
  let userId: string;
  beforeAll(async () => {
    const t = await createOwnedTenant();
    tenantId = t.tenant.id;
    userId = t.user.id;
  });
  afterEach(() => setProviderForTests(undefined as never));

  const run = () =>
    runAi({ tenantId, userId }, {
      agentKey: "recruitment",
      task: "test.summary",
      system: "Summarize.",
      messages: [{ role: "user", content: "Candidate text" }],
      schema,
      fallback: () => ({ summary: "rule-based", score: 0 }),
    });

  it("uses the model, validates output and records tokens and cost", async () => {
    setProviderForTests(stub({ parsed: { summary: "Strong backend experience", score: 4 } }));
    const out = await run();
    expect(out.source).toBe("ai");
    expect(out.data).toEqual({ summary: "Strong backend experience", score: 4 });
    const [exec] = await db.select().from(aiExecutions).where(eq(aiExecutions.id, out.executionId!));
    expect(exec.status).toBe("succeeded");
    expect(exec.promptVersion).toMatch(/^recruitment@/);
    // 1000 in × $4 + 200 out × $20 per MTok = 4000 + 4000 micro-USD
    expect(exec.costMicros).toBe(8000);
    expect(JSON.stringify(exec.input)).not.toContain("Candidate text");
  });

  it("falls back to rules on refusal or invalid output", async () => {
    setProviderForTests(stub({ refused: true, refusalCategory: "cyber", stopReason: "refusal" }));
    const refused = await run();
    expect(refused.source).toBe("rules");
    expect(refused.data.summary).toBe("rule-based");

    setProviderForTests(stub({ parsed: { summary: "x", score: 99 } }));
    const invalid = await run();
    expect(invalid.source).toBe("rules");
  });

  it("works without a provider and stops at the monthly budget", async () => {
    setProviderForTests(null);
    expect((await run()).source).toBe("rules");

    await db.insert(aiAgents).values({ tenantId, key: "recruitment", name: "Recruitment agent", monthlyBudgetUsd: 0 }).onConflictDoNothing();
    await db.update(aiAgents).set({ monthlyBudgetUsd: 0 }).where(eq(aiAgents.tenantId, tenantId));
    const p = stub({ parsed: { summary: "should not run", score: 1 } });
    setProviderForTests(p);
    const out = await run();
    expect(out.source).toBe("rules");
    expect(p.calls).toBe(0);
  });
});
