"use server";

import { refresh, updateTag } from "next/cache";
import { defineAction } from "@/server/lib/action";
import { accessTag, tenantUserIds } from "@/server/auth/access";
import { updateGeneralSettings } from "@/server/services/settings/general";
import { generalSettingsSchema } from "@/lib/validation/settings";

export const updateGeneralSettingsAction = defineAction(
  { input: generalSettingsSchema, permission: "settings.manage", scope: "all" },
  async (ctx, input) => {
    const res = await updateGeneralSettings(ctx, input);
    // The organization name is part of every member's cached access (shell, switcher).
    if (res.nameChanged) for (const userId of await tenantUserIds(ctx.tenantId)) updateTag(accessTag(userId));
    refresh();
    return null;
  },
);
