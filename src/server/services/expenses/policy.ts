import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { documents, expenseCategories, expenseClaims, expenseItems } from "../../db/schema";
import { formatMoney } from "@/lib/format";

export type ViolationCode = "over_item_limit" | "over_monthly_limit" | "receipt_required" | "future_date" | "duplicate_receipt";

export type Violation = { code: ViolationCode; message: string; /** Blocks submission until fixed. */ blocking: boolean };

type Category = typeof expenseCategories.$inferSelect;

export type ItemFacts = {
  tenantId: string;
  employeeId: string;
  claimId: string;
  /** Existing item being re-evaluated (excluded from duplicate / monthly sums). */
  itemId?: string | null;
  category: Pick<Category, "id" | "name" | "maxPerItem" | "maxPerMonth" | "receiptRequiredAbove">;
  spentOn: string;
  amount: number;
  receiptSha256: string | null;
  today: string;
};

/** Claim states whose items count toward monthly limits and duplicate checks. */
const COUNTED_STATUSES = ["submitted", "approved", "reimbursed"] as const;

/**
 * Evaluate the expense policy for one item. Results are stored on the item
 * (policyViolations) and shown to the employee and approvers. Missing
 * receipts and future dates block submission; limits and duplicates are
 * flagged for the approvers to decide.
 */
export async function evaluateItem(tx: Tx, f: ItemFacts): Promise<Violation[]> {
  const out: Violation[] = [];
  const c = f.category;

  if (f.spentOn > f.today) {
    out.push({ code: "future_date", message: "The expense date is in the future.", blocking: true });
  }
  if (c.maxPerItem != null && f.amount > c.maxPerItem) {
    out.push({
      code: "over_item_limit",
      message: `Above the ${formatMoney(c.maxPerItem)} per-item limit for ${c.name}.`,
      blocking: false,
    });
  }
  if (!f.receiptSha256 && f.amount > c.receiptRequiredAbove) {
    out.push({
      code: "receipt_required",
      message:
        c.receiptRequiredAbove > 0
          ? `A receipt is required for ${c.name} above ${formatMoney(c.receiptRequiredAbove)}.`
          : `A receipt is required for ${c.name}.`,
      blocking: true,
    });
  }

  if (c.maxPerMonth != null) {
    const month = f.spentOn.slice(0, 7);
    const [row] = await tx
      .select({ total: sql<number>`coalesce(sum(${expenseItems.amount}), 0)`.mapWith(Number) })
      .from(expenseItems)
      .innerJoin(expenseClaims, eq(expenseClaims.id, expenseItems.claimId))
      .where(
        and(
          eq(expenseItems.tenantId, f.tenantId),
          eq(expenseClaims.employeeId, f.employeeId),
          eq(expenseItems.categoryId, c.id),
          sql`to_char(${expenseItems.spentOn}, 'YYYY-MM') = ${month}`,
          or(inArray(expenseClaims.status, [...COUNTED_STATUSES]), eq(expenseClaims.id, f.claimId)),
          f.itemId ? ne(expenseItems.id, f.itemId) : undefined,
        ),
      );
    const monthTotal = (row?.total ?? 0) + f.amount;
    if (monthTotal > c.maxPerMonth) {
      out.push({
        code: "over_monthly_limit",
        message: `${c.name} spend for ${month} would be ${formatMoney(monthTotal)}, above the ${formatMoney(c.maxPerMonth)} monthly limit.`,
        blocking: false,
      });
    }
  }

  if (f.receiptSha256) {
    const dupes = await tx
      .select({ number: expenseClaims.number })
      .from(expenseItems)
      .innerJoin(expenseClaims, eq(expenseClaims.id, expenseItems.claimId))
      .innerJoin(documents, eq(documents.id, expenseItems.receiptDocumentId))
      .where(
        and(
          eq(expenseItems.tenantId, f.tenantId),
          eq(expenseClaims.employeeId, f.employeeId),
          ne(expenseClaims.status, "cancelled"),
          eq(documents.sha256, f.receiptSha256),
          isNull(documents.deletedAt),
          f.itemId ? ne(expenseItems.id, f.itemId) : undefined,
        ),
      )
      .limit(3);
    if (dupes.length) {
      const numbers = [...new Set(dupes.map((d) => d.number))].join(", ");
      out.push({ code: "duplicate_receipt", message: `The same receipt was already used on ${numbers}.`, blocking: false });
    }
  }
  return out;
}

export const blockingOf = (v: Violation[]) => v.filter((x) => x.blocking);
