"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/lib/action";
import { deleteSavedReport, saveReport, saveReportSchema } from "@/server/services/reports/service";

export const saveReportAction = defineAction({ input: saveReportSchema }, async (ctx, input) => {
  const r = await saveReport(ctx, input);
  refresh();
  return r;
});

export const deleteSavedReportAction = defineAction({ input: z.object({ id: z.uuid() }) }, async (ctx, { id }) => {
  await deleteSavedReport(ctx, id);
  refresh();
  return null;
});
