import "server-only";
import { asc, eq } from "drizzle-orm";
import { can, type RequestContext } from "../../auth/context";
import { expenseCategories } from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { forbidden, notFound } from "../../lib/errors";
import { toPaise, toPaiseOrNull, type ExpenseCategoryInput } from "@/lib/validation/expenses";

export const canManageExpenses = (ctx: Pick<RequestContext, "grants">) => can(ctx, "expenses.manage", "all");

export type ExpenseCategory = typeof expenseCategories.$inferSelect;

/** Form input is in rupees; the table stores paise. */
const toRow = (input: ExpenseCategoryInput) => ({
  ...input,
  maxPerItem: toPaiseOrNull(input.maxPerItem),
  maxPerMonth: toPaiseOrNull(input.maxPerMonth),
  receiptRequiredAbove: toPaise(input.receiptRequiredAbove),
});

/** Categories for the item form (active only) or the settings page (all). */
export async function listExpenseCategories(ctx: RequestContext, opts: { includeInactive?: boolean } = {}) {
  if (opts.includeInactive && !canManageExpenses(ctx)) throw forbidden();
  return ctx.db((tx) =>
    tx
      .select()
      .from(expenseCategories)
      .where(opts.includeInactive ? undefined : eq(expenseCategories.isActive, true))
      .orderBy(asc(expenseCategories.name)),
  );
}

export async function createExpenseCategory(ctx: RequestContext, input: ExpenseCategoryInput) {
  if (!canManageExpenses(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const [row] = await tx
      .insert(expenseCategories)
      .values({ tenantId: ctx.tenantId, ...toRow(input) })
      .returning();
    await audit(tx, ctx, { action: "expense_category.created", entityType: "expense_category", entityId: row.id, changes: diff(null, toRow(input)) });
    return { id: row.id };
  });
}

export async function updateExpenseCategory(ctx: RequestContext, input: ExpenseCategoryInput & { id: string }) {
  if (!canManageExpenses(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const [before] = await tx.select().from(expenseCategories).where(eq(expenseCategories.id, input.id)).for("update");
    if (!before) throw notFound("Expense category");
    const { id, ...fields } = input;
    const [after] = await tx.update(expenseCategories).set(toRow(fields)).where(eq(expenseCategories.id, id)).returning();
    await audit(tx, ctx, { action: "expense_category.updated", entityType: "expense_category", entityId: id, changes: diff(before, after) });
    return { id };
  });
}

/** Common Indian reimbursement heads (amounts in rupees). Limits are starting points for admins to adjust. */
export const STANDARD_EXPENSE_CATEGORIES: ExpenseCategoryInput[] = [
  { code: "TRAVEL", name: "Travel", maxPerItem: null, maxPerMonth: null, receiptRequiredAbove: 0, glCode: "6100", isTaxable: false, isActive: true },
  { code: "LOCAL", name: "Local conveyance", maxPerItem: 2000, maxPerMonth: 5000, receiptRequiredAbove: 500, glCode: "6110", isTaxable: false, isActive: true },
  { code: "MEALS", name: "Meals", maxPerItem: 1500, maxPerMonth: 6000, receiptRequiredAbove: 500, glCode: "6120", isTaxable: false, isActive: true },
  { code: "STAY", name: "Accommodation", maxPerItem: 8000, maxPerMonth: null, receiptRequiredAbove: 0, glCode: "6130", isTaxable: false, isActive: true },
  { code: "TELECOM", name: "Internet & phone", maxPerItem: null, maxPerMonth: 1500, receiptRequiredAbove: 0, glCode: "6140", isTaxable: false, isActive: true },
  { code: "LEARNING", name: "Learning", maxPerItem: 25000, maxPerMonth: null, receiptRequiredAbove: 0, glCode: "6150", isTaxable: false, isActive: true },
  { code: "CLIENT", name: "Client entertainment", maxPerItem: 10000, maxPerMonth: null, receiptRequiredAbove: 0, glCode: "6160", isTaxable: false, isActive: true },
  { code: "OTHER", name: "Other", maxPerItem: null, maxPerMonth: null, receiptRequiredAbove: 0, glCode: "6199", isTaxable: false, isActive: true },
];

/** Idempotent: categories whose code already exists are left untouched. */
export async function seedStandardExpenseCategories(ctx: RequestContext) {
  if (!canManageExpenses(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const inserted = await tx
      .insert(expenseCategories)
      .values(STANDARD_EXPENSE_CATEGORIES.map((c) => ({ tenantId: ctx.tenantId, ...toRow(c) })))
      .onConflictDoNothing()
      .returning({ id: expenseCategories.id, code: expenseCategories.code });
    if (inserted.length) {
      await audit(tx, ctx, {
        action: "expense_category.seeded",
        entityType: "expense_category",
        metadata: { codes: inserted.map((i) => i.code) },
      });
    }
    return { added: inserted.length, skipped: STANDARD_EXPENSE_CATEGORIES.length - inserted.length };
  });
}
