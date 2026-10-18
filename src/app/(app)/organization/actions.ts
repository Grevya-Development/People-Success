"use server";

import { refresh } from "next/cache";
import { defineAction } from "@/server/lib/action";
import { createPositionSchema, updatePositionSchema } from "@/lib/validation/organization";
import { createPosition, updatePosition } from "@/server/services/organization/positions";

export const createPositionAction = defineAction(
  { input: createPositionSchema, permission: "org.manage", scope: "all" },
  async (ctx, input) => {
    const r = await createPosition(ctx, input);
    refresh();
    return r;
  },
);

export const updatePositionAction = defineAction(
  { input: updatePositionSchema, permission: "org.manage", scope: "all" },
  async (ctx, input) => {
    const r = await updatePosition(ctx, input);
    refresh();
    return r;
  },
);
