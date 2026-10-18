"use server";

import { refresh } from "next/cache";
import { defineAction } from "@/server/lib/action";
import { agentConfigSchema, saveAgentConfig } from "@/server/services/ai-admin";

export const saveAgentConfigAction = defineAction({ input: agentConfigSchema }, async (ctx, input) => {
  await saveAgentConfig(ctx, input);
  refresh();
  return null;
});
