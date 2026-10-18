"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { defineAction, zodFieldErrors } from "@/server/lib/action";
import { AppError } from "@/server/lib/errors";
import { decideReward, saveRewardPolicy, submitReferral } from "@/server/services/recruitment/referrals";
import { referralSchema, rewardDecisionSchema, rewardPolicySchema } from "@/lib/validation/recruitment";

export const submitReferralAction = defineAction({ input: z.instanceof(FormData, { message: "Invalid submission" }) }, async (ctx, form) => {
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
  const parsed = referralSchema.safeParse(fields);
  if (!parsed.success) throw new AppError("VALIDATION", "Please correct the highlighted fields.", { fieldErrors: zodFieldErrors(parsed.error) });
  const file = form.get("resume");
  const r = await submitReferral(ctx, parsed.data, file instanceof File && file.size > 0 ? file : null);
  refresh();
  return r;
});

export const saveRewardPolicyAction = defineAction({ input: rewardPolicySchema, permission: "referrals.manage", scope: "all" }, async (ctx, i) => {
  const r = await saveRewardPolicy(ctx, i);
  refresh();
  return r;
});

export const decideRewardAction = defineAction({ input: rewardDecisionSchema, permission: "referrals.manage", scope: "all" }, async (ctx, i) => {
  const r = await decideReward(ctx, i.referralId, i.action);
  refresh();
  return r;
});
