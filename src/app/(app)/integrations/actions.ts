"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/lib/action";
import {
  integrationEventsFor,
  removeIntegration,
  saveIntegration,
  saveIntegrationSchema,
  setIntegrationEnabled,
  verifyIntegration,
} from "@/server/services/integrations";

const provider = z.object({ provider: z.string().min(1).max(60) });

export const saveIntegrationAction = defineAction({ input: saveIntegrationSchema }, async (ctx, i) => {
  const r = await saveIntegration(ctx, i);
  refresh();
  return r;
});

export const verifyIntegrationAction = defineAction({ input: provider }, async (ctx, i) => {
  const r = await verifyIntegration(ctx, i.provider);
  refresh();
  return r;
});

export const setIntegrationEnabledAction = defineAction({ input: provider.extend({ enabled: z.boolean() }) }, async (ctx, i) => {
  await setIntegrationEnabled(ctx, i.provider, i.enabled);
  refresh();
  return null;
});

export const removeIntegrationAction = defineAction({ input: provider }, async (ctx, i) => {
  await removeIntegration(ctx, i.provider);
  refresh();
  return null;
});

export const integrationEventsAction = defineAction({ input: provider }, async (ctx, i) =>
  (await integrationEventsFor(ctx, i.provider)).map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
);
