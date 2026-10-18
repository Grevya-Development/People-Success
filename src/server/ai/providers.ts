import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { env } from "../env";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type LlmMessage = { role: "user" | "assistant"; content: string };

export type LlmRequest = {
  system: string;
  messages: LlmMessage[];
  /** When set, the reply is constrained to and validated against this schema. */
  schema?: z.ZodType;
  schemaName?: string;
  maxTokens?: number;
  effort?: Effort;
  model?: string;
};

export type LlmResult = {
  provider: "anthropic" | "openai";
  model: string;
  text: string;
  /** Provider-parsed output; callers re-validate against their schema. */
  parsed: unknown;
  inputTokens: number;
  outputTokens: number;
  /** True when the model declined (safety classifiers) after any fallbacks. */
  refused: boolean;
  refusalCategory: string | null;
  stopReason: string | null;
  /** True when a server-side fallback model produced the answer. */
  fellBack: boolean;
};

export interface LlmProvider {
  readonly name: "anthropic" | "openai";
  readonly defaultModel: string;
  complete(req: LlmRequest): Promise<LlmResult>;
}

/* ------------------------------------------------------------------ */
/* Anthropic (Claude)                                                  */
/* ------------------------------------------------------------------ */

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";

class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly defaultModel: string;
  private client: Anthropic;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
    this.defaultModel = model || DEFAULT_CLAUDE_MODEL;
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const model = req.model ?? this.defaultModel;
    const response = await this.client.beta.messages.parse({
      model,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      messages: req.messages,
      // Opus 5.5 always uses adaptive thinking; effort is the depth control (its default is "medium").
      output_config: {
        effort: req.effort ?? "medium",
        ...(req.schema ? { format: betaZodOutputFormat(req.schema) } : {}),
      },
      // Retry classifier refusals on Anthropic's recommended fallback model, server-side.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    const refused = response.stop_reason === "refusal";
    const text = refused
      ? ""
      : response.content
          .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
          .map((b) => b.text)
          .join("");
    const fellBack = response.content.some((b) => b.type === "fallback");
    return {
      provider: this.name,
      model: response.model,
      text,
      parsed: refused ? null : (response.parsed_output ?? null),
      inputTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
      refused,
      refusalCategory: refused ? (response.stop_details?.category ?? null) : null,
      stopReason: response.stop_reason ?? null,
      fellBack,
    };
  }
}

/* ------------------------------------------------------------------ */
/* OpenAI                                                              */
/* ------------------------------------------------------------------ */

class OpenAIProvider implements LlmProvider {
  readonly name = "openai" as const;
  readonly defaultModel: string;
  private client: OpenAI;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey, maxRetries: 2, timeout: 120_000 });
    this.defaultModel = model;
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const model = req.model ?? this.defaultModel;
    const messages = [{ role: "system" as const, content: req.system }, ...req.messages];
    const completion = req.schema
      ? await this.client.chat.completions.parse({
          model,
          messages,
          response_format: zodResponseFormat(req.schema as never, req.schemaName ?? "result"),
        })
      : await this.client.chat.completions.create({ model, messages });
    const choice = completion.choices[0];
    const refusal = (choice?.message as { refusal?: string | null })?.refusal ?? null;
    return {
      provider: this.name,
      model: completion.model,
      text: choice?.message?.content ?? "",
      parsed: (choice?.message as { parsed?: unknown })?.parsed ?? null,
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
      refused: !!refusal,
      refusalCategory: refusal ? "provider_refusal" : null,
      stopReason: choice?.finish_reason ?? null,
      fellBack: false,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

let cached: LlmProvider | null | undefined;

/**
 * The configured provider, or null when AI is disabled / not configured.
 * Callers then use their deterministic, rule-based fallback.
 */
export function getProvider(): LlmProvider | null {
  if (cached !== undefined) return cached;
  let next: LlmProvider | null;
  const e = env();
  if (e.AI_PROVIDER === "anthropic" && e.ANTHROPIC_API_KEY) next = new AnthropicProvider(e.ANTHROPIC_API_KEY, e.AI_MODEL);
  else if (e.AI_PROVIDER === "openai" && e.OPENAI_API_KEY && e.AI_MODEL) next = new OpenAIProvider(e.OPENAI_API_KEY, e.AI_MODEL);
  else next = null;
  cached = next;
  return next;
}

export function providerStatus() {
  const e = env();
  const p = getProvider();
  return {
    configured: !!p,
    provider: p?.name ?? null,
    model: p?.defaultModel ?? null,
    reason: p
      ? null
      : e.AI_PROVIDER === "none"
        ? "AI_PROVIDER is set to none"
        : e.AI_PROVIDER === "openai" && !e.AI_MODEL
          ? "AI_MODEL is required for OpenAI"
          : "API key missing",
  };
}

/** Test hook. */
export function setProviderForTests(p: LlmProvider | null) {
  cached = p;
}
