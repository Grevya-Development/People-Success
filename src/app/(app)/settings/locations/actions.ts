"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/lib/action";
import { removeLocation, saveLocation } from "@/server/services/settings/locations";
import { locationSchema } from "@/lib/validation/settings";

export const saveLocationAction = defineAction({ input: locationSchema, permission: "org.manage", scope: "all" }, async (ctx, input) => {
  const row = await saveLocation(ctx, input);
  refresh();
  return { id: row.id };
});

export const removeLocationAction = defineAction(
  { input: z.object({ id: z.uuid() }), permission: "org.manage", scope: "all" },
  async (ctx, { id }) => {
    const res = await removeLocation(ctx, id);
    refresh();
    return res;
  },
);
