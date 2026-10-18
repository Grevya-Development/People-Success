"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/lib/action";
import { authorize } from "@/server/auth/context";
import { withSystem } from "@/server/db/tx";
import { AppError } from "@/server/lib/errors";
import { audit } from "@/server/lib/audit";
import { saveWorkflow, saveWorkflowSchema, seedStarterWorkflows, setWorkflowActive } from "@/server/services/workflows/definitions";
import { cancelRun, retryRun, startManualRun } from "@/server/services/workflows/engine";

const wrap = async <T>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("INVALID_STATE", err instanceof Error ? err.message : "Operation failed");
  }
};

export const saveWorkflowAction = defineAction({ input: saveWorkflowSchema }, async (ctx, input) => {
  const r = await saveWorkflow(ctx, input);
  refresh();
  return r;
});

export const setWorkflowActiveAction = defineAction({ input: z.object({ id: z.uuid(), active: z.boolean() }) }, async (ctx, i) => {
  await setWorkflowActive(ctx, i.id, i.active);
  refresh();
  return null;
});

export const seedStartersAction = defineAction({ input: z.object({}), permission: "workflows.manage", scope: "all" }, async (ctx) => {
  const created = await withSystem((tx) => seedStarterWorkflows(tx, ctx.tenantId, ctx.userId), ctx.tenantId);
  refresh();
  return { created };
});

export const runNowAction = defineAction(
  { input: z.object({ id: z.uuid(), employeeId: z.uuid().nullish() }), permission: "workflows.manage", scope: "all" },
  async (ctx, i) => {
    const runId = await wrap(() => startManualRun(ctx.tenantId, i.id, i.employeeId ?? null, ctx.userId));
    await ctx.db((tx) => audit(tx, ctx, { action: "workflow.run_started", entityType: "workflow", entityId: i.id, metadata: { runId } }));
    return { runId };
  },
);

export const retryRunAction = defineAction({ input: z.object({ runId: z.uuid() }) }, async (ctx, i) => {
  authorize(ctx, "workflows.manage", "all");
  await wrap(() => retryRun(ctx.tenantId, i.runId));
  await ctx.db((tx) => audit(tx, ctx, { action: "workflow.run_retried", entityType: "workflow_run", entityId: i.runId }));
  refresh();
  return null;
});

export const cancelRunAction = defineAction({ input: z.object({ runId: z.uuid() }) }, async (ctx, i) => {
  authorize(ctx, "workflows.manage", "all");
  await wrap(() => cancelRun(ctx.tenantId, i.runId, ctx.userId));
  await ctx.db((tx) => audit(tx, ctx, { action: "workflow.run_cancelled", entityType: "workflow_run", entityId: i.runId }));
  refresh();
  return null;
});
