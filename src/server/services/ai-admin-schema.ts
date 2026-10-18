import { z } from "zod";

export const agentConfigSchema = z.object({
  key: z.string().min(1),
  enabled: z.boolean(),
  monthlyBudgetUsd: z.coerce.number().int().min(0).max(10_000),
  model: z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-z0-9.\-_]*$/i, "Use a model id like claude-opus-5-5")
    .optional()
    .default(""),
  instructions: z.string().trim().max(4000).optional().default(""),
});

