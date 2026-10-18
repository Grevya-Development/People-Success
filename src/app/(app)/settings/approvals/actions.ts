"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/lib/action";
import { saveApprovalPolicy, setApprovalPolicyActive } from "@/server/services/settings/approval-policies";
import { approvalPolicySchema } from "@/lib/validation/settings";

// workflows.manage OR settings.manage: enforced by the service.
export const saveApprovalPolicyAction = defineAction({ input: approvalPolicySchema }, async (ctx, input) => {
  const res = await saveApprovalPolicy(ctx, input);
  refresh();
  return res;
});

export const setApprovalPolicyActiveAction = defineAction(
  { input: z.object({ id: z.uuid(), isActive: z.boolean() }) },
  async (ctx, { id, isActive }) => {
    const res = await setApprovalPolicyActive(ctx, id, isActive);
    refresh();
    return res;
  },
);
