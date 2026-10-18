"use server";

import { cookies } from "next/headers";
import { refresh, updateTag } from "next/cache";
import { z } from "zod";
import { getSession, TENANT_COOKIE } from "@/server/auth/context";
import { accessTag, tenantUserIds } from "@/server/auth/access";
import { createOrganization } from "@/server/services/tenancy/provision";
import { createOrganizationInput } from "@/lib/validation/tenancy";
import { AppError } from "@/server/lib/errors";
import { defineAction, failure, zodFieldErrors, type ActionResult } from "@/server/lib/action";
import { completeSetup, markSetupStep } from "@/server/services/settings/setup";
import { setupStepSchema } from "@/lib/validation/settings";
import { rateLimit } from "@/server/lib/rate-limit";

export async function createOrganizationAction(
  raw: z.input<typeof createOrganizationInput>,
): Promise<ActionResult<{ tenantId: string }>> {
  try {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHENTICATED", "Please sign in again.");
    const parsed = createOrganizationInput.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("VALIDATION", "Please correct the highlighted fields.", { fieldErrors: zodFieldErrors(parsed.error) });
    }
    await rateLimit(`org-create:${session.userId}`, 5, 3600);
    const tenant = await createOrganization(session.userId, parsed.data);
    (await cookies()).set(TENANT_COOKIE, tenant.id, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365 });
    updateTag(accessTag(session.userId));
    return { ok: true, data: { tenantId: tenant.id } };
  } catch (err) {
    return failure(err);
  }
}

/* ------------------------------------------------------------------ */
/* Setup wizard                                                        */
/* ------------------------------------------------------------------ */

export const markSetupStepAction = defineAction(
  { input: setupStepSchema, permission: "settings.manage", scope: "all" },
  async (ctx, { step }) => {
    const res = await markSetupStep(ctx, step);
    refresh();
    return res;
  },
);

export const completeSetupAction = defineAction(
  { input: z.object({}), permission: "settings.manage", scope: "all" },
  async (ctx) => {
    const res = await completeSetup(ctx);
    // Tenant status is part of every member's cached access.
    if (res.statusChanged) for (const userId of await tenantUserIds(ctx.tenantId)) updateTag(accessTag(userId));
    refresh();
    return res;
  },
);
