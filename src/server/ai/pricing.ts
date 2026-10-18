/**
 * Per-million-token prices in USD for cost tracking. Anthropic first-party
 * API rates (verify against current pricing before relying on these for
 * billing). Unknown models fall back to AI_PRICE_*_PER_MTOK env overrides,
 * else zero (and a warning in the execution record).
 */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export function priceFor(model: string) {
  const known = PRICES[model];
  if (known) return { ...known, known: true };
  const input = Number(process.env.AI_PRICE_INPUT_PER_MTOK ?? 0);
  const output = Number(process.env.AI_PRICE_OUTPUT_PER_MTOK ?? 0);
  return { input, output, known: false };
}

/** Cost in micro-USD (integer) for a call. */
export function costMicros(model: string, inputTokens: number, outputTokens: number) {
  const p = priceFor(model);
  return Math.round(inputTokens * p.input + outputTokens * p.output);
}
