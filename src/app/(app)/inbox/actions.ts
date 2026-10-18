"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/lib/action";
import { decide, decideInput, updateTaskInput, updateTaskStatus, withdraw } from "@/server/services/inbox";

export const decideAction = defineAction({ input: decideInput }, async (ctx, input) => {
  const r = await decide(ctx, input);
  refresh();
  return { status: r.status };
});

export const withdrawAction = defineAction({ input: z.object({ requestId: z.uuid() }) }, async (ctx, { requestId }) => {
  await withdraw(ctx, requestId);
  refresh();
  return null;
});

export const updateTaskAction = defineAction({ input: updateTaskInput }, async (ctx, input) => {
  await updateTaskStatus(ctx, input);
  refresh();
  return null;
});
