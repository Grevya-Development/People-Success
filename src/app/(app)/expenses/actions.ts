"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { defineAction, zodFieldErrors } from "@/server/lib/action";
import { AppError } from "@/server/lib/errors";
import {
  addClaimItem,
  cancelClaim,
  createClaim,
  markClaimReimbursed,
  removeClaimItem,
  submitClaim,
  updateClaim,
  withdrawClaim,
} from "@/server/services/expenses/claims";
import { createExpenseCategory, seedStandardExpenseCategories, updateExpenseCategory } from "@/server/services/expenses/categories";
import { createBenefitPlan, enrollInBenefit, updateBenefitPlan, waiveBenefit } from "@/server/services/benefits/plans";
import {
  benefitPlanSchema,
  claimIdSchema,
  createClaimSchema,
  enrollSchema,
  expenseCategorySchema,
  expenseItemSchema,
  itemIdSchema,
  markReimbursedSchema,
  updateBenefitPlanSchema,
  updateClaimSchema,
  updateExpenseCategorySchema,
  waiveSchema,
} from "@/lib/validation/expenses";

/* ------------------------------------------------------------------ */
/* Claims                                                              */
/* ------------------------------------------------------------------ */

export const createClaimAction = defineAction({ input: createClaimSchema, permission: "expenses.view" }, async (ctx, input) => createClaim(ctx, input));

export const updateClaimAction = defineAction({ input: updateClaimSchema, permission: "expenses.view" }, async (ctx, input) => {
  const r = await updateClaim(ctx, input);
  refresh();
  return r;
});

/** Item form posts FormData so a receipt file can travel with the fields. */
export const addClaimItemAction = defineAction(
  { input: z.instanceof(FormData, { message: "Invalid form" }), permission: "expenses.view" },
  async (ctx, form) => {
    const fields: Record<string, string> = {};
    for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
    const parsed = expenseItemSchema.safeParse(fields);
    if (!parsed.success) throw new AppError("VALIDATION", "Please correct the highlighted fields.", { fieldErrors: zodFieldErrors(parsed.error) });
    const file = form.get("receipt");
    const r = await addClaimItem(ctx, parsed.data, file instanceof File && file.size > 0 ? file : null);
    refresh();
    return r;
  },
);

export const removeClaimItemAction = defineAction({ input: itemIdSchema, permission: "expenses.view" }, async (ctx, { id }) => {
  const r = await removeClaimItem(ctx, id);
  refresh();
  return r;
});

export const submitClaimAction = defineAction({ input: claimIdSchema, permission: "expenses.view" }, async (ctx, { id }) => {
  const r = await submitClaim(ctx, id);
  refresh();
  return r;
});

export const withdrawClaimAction = defineAction({ input: claimIdSchema, permission: "expenses.view" }, async (ctx, { id }) => {
  const r = await withdrawClaim(ctx, id);
  refresh();
  return r;
});

export const cancelClaimAction = defineAction({ input: claimIdSchema, permission: "expenses.view" }, async (ctx, { id }) => {
  const r = await cancelClaim(ctx, id);
  refresh();
  return r;
});

export const markReimbursedAction = defineAction(
  { input: markReimbursedSchema, permission: "expenses.manage", scope: "all" },
  async (ctx, input) => {
    const r = await markClaimReimbursed(ctx, input);
    refresh();
    return r;
  },
);

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

export const createExpenseCategoryAction = defineAction(
  { input: expenseCategorySchema, permission: "expenses.manage", scope: "all" },
  async (ctx, input) => {
    const r = await createExpenseCategory(ctx, input);
    refresh();
    return r;
  },
);

export const updateExpenseCategoryAction = defineAction(
  { input: updateExpenseCategorySchema, permission: "expenses.manage", scope: "all" },
  async (ctx, input) => {
    const r = await updateExpenseCategory(ctx, input);
    refresh();
    return r;
  },
);

export const seedExpenseCategoriesAction = defineAction(
  { input: z.object({}), permission: "expenses.manage", scope: "all" },
  async (ctx) => {
    const r = await seedStandardExpenseCategories(ctx);
    refresh();
    return r;
  },
);

/* ------------------------------------------------------------------ */
/* Benefits                                                            */
/* ------------------------------------------------------------------ */

export const createBenefitPlanAction = defineAction(
  { input: benefitPlanSchema, permission: "benefits.manage", scope: "all" },
  async (ctx, input) => {
    const r = await createBenefitPlan(ctx, input);
    refresh();
    return r;
  },
);

export const updateBenefitPlanAction = defineAction(
  { input: updateBenefitPlanSchema, permission: "benefits.manage", scope: "all" },
  async (ctx, input) => {
    const r = await updateBenefitPlan(ctx, input);
    refresh();
    return r;
  },
);

export const enrollBenefitAction = defineAction({ input: enrollSchema }, async (ctx, input) => {
  const r = await enrollInBenefit(ctx, input);
  refresh();
  return r;
});

export const waiveBenefitAction = defineAction({ input: waiveSchema }, async (ctx, { planId }) => {
  const r = await waiveBenefit(ctx, planId);
  refresh();
  return r;
});
