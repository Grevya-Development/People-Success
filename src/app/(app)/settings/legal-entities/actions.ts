"use server";

import { refresh } from "next/cache";
import { defineAction } from "@/server/lib/action";
import { saveLegalEntity } from "@/server/services/settings/legal-entities";
import { legalEntitySchema } from "@/lib/validation/settings";

export const saveLegalEntityAction = defineAction(
  { input: legalEntitySchema, permission: "settings.manage", scope: "all" },
  async (ctx, input) => {
    const row = await saveLegalEntity(ctx, input);
    refresh();
    return { id: row.id };
  },
);
