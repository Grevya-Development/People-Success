import "server-only";
import { aliasedTable, and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { canAccessEmployee, type RequestContext } from "../../auth/context";
import type { Tx } from "../../db/client";
import { withSystem } from "../../db/tx";
import {
  approvalRequests,
  approvalSteps,
  departments,
  documents,
  employees,
  expenseCategories,
  expenseClaims,
  expenseItems,
  payrollInputs,
  payrollPeriods,
  users,
} from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { forbidden, invalidState, notFound, validation } from "../../lib/errors";
import { cancelApprovalForSubject, startApproval } from "../approvals/engine";
import { nextCounter } from "../employees/codes";
import { emitDomainEvent } from "../events";
import { notify } from "../notifications";
import { userIdForEmployee } from "../directory";
import { formatMoney, todayIn } from "@/lib/format";
import { MONTHS } from "@/lib/india";
import { toPaise, type CreateClaimInput, type ExpenseItemInput } from "@/lib/validation/expenses";
import { canManageExpenses } from "./categories";
import { discardAttachment, insertAttachmentRow, prepareAttachment, attachmentDownloadUrl, type PreparedAttachment } from "./attachments";
import { blockingOf, evaluateItem } from "./policy";

export const CLAIM_SUBJECT = "expense_claim";

type ClaimRow = typeof expenseClaims.$inferSelect;

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

export type ClaimAccess = "owner" | "finance" | "viewer" | "approver";

async function isPendingApprover(tx: Tx, claimId: string, userId: string) {
  const [row] = await tx
    .select({ id: approvalSteps.id })
    .from(approvalSteps)
    .innerJoin(approvalRequests, eq(approvalRequests.id, approvalSteps.requestId))
    .where(
      and(
        eq(approvalRequests.subjectType, CLAIM_SUBJECT),
        eq(approvalRequests.subjectId, claimId),
        eq(approvalSteps.status, "pending"),
        sql`${userId} = any(${approvalSteps.approverUserIds})`,
      ),
    )
    .limit(1);
  return !!row;
}

async function accessFor(ctx: RequestContext, tx: Tx, claim: ClaimRow): Promise<ClaimAccess | null> {
  if (ctx.employeeId && claim.employeeId === ctx.employeeId) return "owner";
  // Drafts are private to their author.
  if (claim.status === "draft" || (claim.status === "cancelled" && !claim.submittedAt)) return null;
  if (canManageExpenses(ctx)) return "finance";
  if (await canAccessEmployee(ctx, "expenses.view", claim.employeeId)) return "viewer";
  if (await isPendingApprover(tx, claim.id, ctx.userId)) return "approver";
  return null;
}

async function lockOwnDraft(ctx: RequestContext, tx: Tx, claimId: string) {
  const [claim] = await tx.select().from(expenseClaims).where(eq(expenseClaims.id, claimId)).for("update");
  if (!claim || !ctx.employeeId || claim.employeeId !== ctx.employeeId) throw notFound("Expense claim");
  if (claim.status !== "draft") throw invalidState("Only draft claims can be changed. Withdraw the claim first.");
  return claim;
}

const formatNumber = (n: number) => `EXP-${String(n).padStart(4, "0")}`;

async function recomputeTotal(tx: Tx, claimId: string) {
  const [row] = await tx
    .update(expenseClaims)
    .set({ total: sql`(select coalesce(sum(${expenseItems.amount}), 0) from ${expenseItems} where ${expenseItems.claimId} = ${claimId})` })
    .where(eq(expenseClaims.id, claimId))
    .returning({ total: expenseClaims.total });
  return row?.total ?? 0;
}

/* ------------------------------------------------------------------ */
/* Claims                                                              */
/* ------------------------------------------------------------------ */

export async function createClaim(ctx: RequestContext, input: CreateClaimInput) {
  const employeeId = ctx.employeeId;
  if (!employeeId) throw forbidden("Only employees can raise expense claims. Ask HR to link your login to your employee record.");
  return ctx.db(async (tx) => {
    const number = formatNumber(await nextCounter(tx, ctx.tenantId, "expense_claim"));
    const [claim] = await tx
      .insert(expenseClaims)
      .values({ tenantId: ctx.tenantId, number, employeeId, title: input.title, reimbursementMethod: input.reimbursementMethod })
      .returning({ id: expenseClaims.id, number: expenseClaims.number });
    await audit(tx, ctx, { action: "expense_claim.created", entityType: "expense_claim", entityId: claim.id, metadata: { number } });
    return claim;
  });
}

export async function updateClaim(ctx: RequestContext, input: CreateClaimInput & { id: string }) {
  return ctx.db(async (tx) => {
    const before = await lockOwnDraft(ctx, tx, input.id);
    const [after] = await tx
      .update(expenseClaims)
      .set({ title: input.title, reimbursementMethod: input.reimbursementMethod })
      .where(eq(expenseClaims.id, input.id))
      .returning();
    await audit(tx, ctx, {
      action: "expense_claim.updated",
      entityType: "expense_claim",
      entityId: input.id,
      changes: diff({ title: before.title, reimbursementMethod: before.reimbursementMethod }, { title: after.title, reimbursementMethod: after.reimbursementMethod }),
    });
    return { id: input.id };
  });
}

/** Add an item (with optional receipt) to a draft claim. Policy is evaluated and stored on the item. */
export async function addClaimItem(ctx: RequestContext, input: ExpenseItemInput, file: File | null) {
  // Check ownership before touching the bytes.
  await ctx.db((tx) => lockOwnDraft(ctx, tx, input.claimId));
  let prepared: PreparedAttachment | null = null;
  if (file) prepared = await prepareAttachment(ctx, file, { ownerType: "expense_claim", ownerId: input.claimId });
  try {
    return await ctx.db(async (tx) => {
      const claim = await lockOwnDraft(ctx, tx, input.claimId);
      const [category] = await tx.select().from(expenseCategories).where(eq(expenseCategories.id, input.categoryId));
      if (!category || !category.isActive) throw validation("Choose an active category.", { categoryId: ["Choose an active category"] });

      const receiptDocumentId = prepared
        ? await insertAttachmentRow(tx, ctx, prepared, {
            ownerType: "expense_claim",
            ownerId: claim.id,
            employeeId: claim.employeeId,
            title: `Receipt · ${input.merchant ?? input.description}`,
            category: "receipt",
          })
        : null;
      const amount = toPaise(input.amount);
      const violations = await evaluateItem(tx, {
        tenantId: ctx.tenantId,
        employeeId: claim.employeeId,
        claimId: claim.id,
        category,
        spentOn: input.spentOn,
        amount,
        receiptSha256: prepared?.sha256 ?? null,
        today: todayIn(),
      });
      const [item] = await tx
        .insert(expenseItems)
        .values({
          tenantId: ctx.tenantId,
          claimId: claim.id,
          categoryId: category.id,
          spentOn: input.spentOn,
          merchant: input.merchant,
          description: input.description,
          amount,
          receiptDocumentId,
          policyViolations: violations.map((v) => v.message),
        })
        .returning({ id: expenseItems.id });
      const total = await recomputeTotal(tx, claim.id);
      await audit(tx, ctx, {
        action: "expense_claim.item_added",
        entityType: "expense_claim",
        entityId: claim.id,
        metadata: { itemId: item.id, category: category.code, hasReceipt: !!receiptDocumentId, violations: violations.map((v) => v.code) },
      });
      return { id: item.id, total, violations: violations.map((v) => v.message) };
    });
  } catch (err) {
    await discardAttachment(prepared);
    throw err;
  }
}

export async function removeClaimItem(ctx: RequestContext, itemId: string) {
  return ctx.db(async (tx) => {
    const [item] = await tx.select().from(expenseItems).where(eq(expenseItems.id, itemId));
    if (!item) throw notFound("Expense item");
    await lockOwnDraft(ctx, tx, item.claimId);
    await tx.delete(expenseItems).where(eq(expenseItems.id, itemId));
    if (item.receiptDocumentId) {
      await tx.update(documents).set({ deletedAt: new Date(), isCurrent: false }).where(eq(documents.id, item.receiptDocumentId));
    }
    const total = await recomputeTotal(tx, item.claimId);
    await audit(tx, ctx, { action: "expense_claim.item_removed", entityType: "expense_claim", entityId: item.claimId, metadata: { itemId } });
    return { total };
  });
}

/**
 * Submit for approval. Totals and policy checks are recomputed server-side;
 * blocking violations (missing receipts, future dates) must be fixed first.
 */
export async function submitClaim(ctx: RequestContext, claimId: string) {
  return ctx.db(async (tx) => {
    const claim = await lockOwnDraft(ctx, tx, claimId);
    const items = await tx
      .select({ item: expenseItems, category: expenseCategories, sha: documents.sha256 })
      .from(expenseItems)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenseItems.categoryId))
      .leftJoin(documents, and(eq(documents.id, expenseItems.receiptDocumentId), isNull(documents.deletedAt)))
      .where(eq(expenseItems.claimId, claim.id))
      .orderBy(asc(expenseItems.spentOn));
    if (!items.length) throw invalidState("Add at least one expense before submitting.");

    const today = todayIn();
    const problems: string[] = [];
    for (const { item, category, sha } of items) {
      if (!category.isActive) problems.push(`${category.name} is no longer an active category.`);
      const v = await evaluateItem(tx, {
        tenantId: ctx.tenantId,
        employeeId: claim.employeeId,
        claimId: claim.id,
        itemId: item.id,
        category,
        spentOn: item.spentOn,
        amount: item.amount,
        receiptSha256: sha ?? null,
        today,
      });
      await tx.update(expenseItems).set({ policyViolations: v.map((x) => x.message) }).where(eq(expenseItems.id, item.id));
      for (const b of blockingOf(v)) problems.push(`${item.description}: ${b.message}`);
    }
    if (problems.length) throw validation(`Fix these before submitting: ${problems.slice(0, 3).join(" ")}`);

    const total = await recomputeTotal(tx, claim.id);
    await tx.update(expenseClaims).set({ status: "submitted", submittedAt: new Date(), decidedAt: null }).where(eq(expenseClaims.id, claim.id));
    await startApproval(tx, ctx, {
      subjectType: CLAIM_SUBJECT,
      subjectId: claim.id,
      title: `Expense claim ${claim.number} · ${formatMoney(total)}`,
      requestedBy: ctx.userId,
      subjectEmployeeId: claim.employeeId,
      // `amount` is whole rupees so policy conditions read naturally; paise for exact rules.
      context: { amount: Math.round(total / 100), amountPaise: total, reimbursementMethod: claim.reimbursementMethod },
    });
    await audit(tx, ctx, {
      action: "expense_claim.submitted",
      entityType: "expense_claim",
      entityId: claim.id,
      changes: diff({ status: claim.status }, { status: "submitted" }),
      metadata: { items: items.length },
    });
    await emitDomainEvent(tx, ctx.tenantId, "expense_claim.submitted", { claimId: claim.id, employeeId: claim.employeeId });
    return { id: claim.id, total };
  });
}

/** Withdraw a submitted claim back to draft (its pending approval is cancelled). */
export async function withdrawClaim(ctx: RequestContext, claimId: string) {
  return ctx.db(async (tx) => {
    const [claim] = await tx.select().from(expenseClaims).where(eq(expenseClaims.id, claimId)).for("update");
    if (!claim || claim.employeeId !== ctx.employeeId) throw notFound("Expense claim");
    if (claim.status !== "submitted") throw invalidState("Only claims waiting for approval can be withdrawn.");
    // Fires the approval handler's onCancelled, which returns the claim to draft.
    await cancelApprovalForSubject(tx, ctx, CLAIM_SUBJECT, claim.id);
    await tx.update(expenseClaims).set({ status: "draft", submittedAt: null }).where(and(eq(expenseClaims.id, claim.id), eq(expenseClaims.status, "submitted")));
    await audit(tx, ctx, { action: "expense_claim.withdrawn", entityType: "expense_claim", entityId: claim.id, changes: diff({ status: "submitted" }, { status: "draft" }) });
    return { id: claim.id };
  });
}

export async function cancelClaim(ctx: RequestContext, claimId: string) {
  return ctx.db(async (tx) => {
    const claim = await lockOwnDraft(ctx, tx, claimId);
    await tx.update(expenseClaims).set({ status: "cancelled" }).where(eq(expenseClaims.id, claim.id));
    await audit(tx, ctx, { action: "expense_claim.cancelled", entityType: "expense_claim", entityId: claim.id, changes: diff({ status: "draft" }, { status: "cancelled" }) });
    return { id: claim.id };
  });
}

/** Finance records a bank transfer for an approved claim. */
export async function markClaimReimbursed(ctx: RequestContext, input: { id: string; paymentReference: string }) {
  if (!canManageExpenses(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const [claim] = await tx.select().from(expenseClaims).where(eq(expenseClaims.id, input.id)).for("update");
    if (!claim || claim.status === "draft") throw notFound("Expense claim");
    if (claim.status !== "approved") throw invalidState("Only approved claims can be marked reimbursed.");
    if (claim.reimbursementMethod !== "bank_transfer") throw invalidState("This claim is paid through payroll.");
    await tx
      .update(expenseClaims)
      .set({ status: "reimbursed", reimbursedAt: new Date(), paymentReference: input.paymentReference })
      .where(eq(expenseClaims.id, claim.id));
    await audit(tx, ctx, {
      action: "expense_claim.reimbursed",
      entityType: "expense_claim",
      entityId: claim.id,
      changes: diff({ status: claim.status, paymentReference: claim.paymentReference }, { status: "reimbursed", paymentReference: input.paymentReference }),
    });
    const userId = await userIdForEmployee(tx, claim.employeeId);
    if (userId) {
      await notify(tx, {
        tenantId: ctx.tenantId,
        userIds: [userId],
        category: "expenses",
        title: `${claim.number} was reimbursed`,
        body: "Finance recorded the bank transfer for your claim.",
        href: `/expenses/${claim.id}`,
        dedupeKey: `expense:${claim.id}:reimbursed`,
      });
    }
    return { id: claim.id };
  });
}

/* ------------------------------------------------------------------ */
/* Approval outcomes (called by the approval handler in the decider's tx) */
/* ------------------------------------------------------------------ */

export async function settleClaim(
  tx: Tx,
  actor: { tenantId: string; userId: string },
  claimId: string,
  outcome: "approved" | "rejected" | "withdrawn",
) {
  const [claim] = await tx
    .select()
    .from(expenseClaims)
    .where(and(eq(expenseClaims.id, claimId), eq(expenseClaims.tenantId, actor.tenantId)))
    .for("update");
  // Idempotent: a repeated outcome for a settled claim changes nothing.
  if (!claim || claim.status !== "submitted") return claim ?? null;
  const next = outcome === "withdrawn" ? { status: "draft" as const, submittedAt: null } : { status: outcome, decidedAt: new Date() };
  await tx.update(expenseClaims).set(next).where(eq(expenseClaims.id, claim.id));
  await audit(tx, actor, {
    action: `expense_claim.${outcome}`,
    entityType: "expense_claim",
    entityId: claim.id,
    changes: diff({ status: claim.status }, { status: next.status }),
  });
  if (outcome === "approved") {
    await emitDomainEvent(tx, actor.tenantId, "expense_claim.approved", { claimId: claim.id, employeeId: claim.employeeId });
  }
  return { ...claim, ...next };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export type ClaimListItem = {
  id: string;
  number: string;
  title: string;
  status: ClaimRow["status"];
  total: number;
  currency: string;
  reimbursementMethod: string;
  items: number;
  violations: number;
  submittedAt: string | null;
  decidedAt: string | null;
  reimbursedAt: string | null;
  postedToPayroll: boolean;
  createdAt: string;
  employee?: { id: string; name: string; code: string; department: string | null };
};

const itemCount = sql<number>`(select count(*)::int from ${expenseItems} i where i.claim_id = "expense_claims"."id")`;
const violationCount = sql<number>`(select count(*)::int from ${expenseItems} i where i.claim_id = "expense_claims"."id" and jsonb_array_length(i.policy_violations) > 0)`;

function toListItem(c: ClaimRow, items: number, violations: number): ClaimListItem {
  return {
    id: c.id,
    number: c.number,
    title: c.title,
    status: c.status,
    total: c.total,
    currency: c.currency,
    reimbursementMethod: c.reimbursementMethod,
    items: Number(items),
    violations: Number(violations),
    submittedAt: c.submittedAt?.toISOString() ?? null,
    decidedAt: c.decidedAt?.toISOString() ?? null,
    reimbursedAt: c.reimbursedAt?.toISOString() ?? null,
    postedToPayroll: !!c.payrollInputId,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function listMyClaims(ctx: RequestContext): Promise<ClaimListItem[]> {
  const employeeId = ctx.employeeId;
  if (!employeeId) return [];
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ c: expenseClaims, items: itemCount, violations: violationCount })
      .from(expenseClaims)
      .where(eq(expenseClaims.employeeId, employeeId))
      .orderBy(desc(expenseClaims.createdAt))
      .limit(300);
    return rows.map((r) => toListItem(r.c, r.items, r.violations));
  });
}

export type ClaimDetail = ClaimListItem & {
  access: ClaimAccess;
  employee: { id: string; name: string; code: string; department: string | null };
  paymentReference: string | null;
  payrollPeriod: string | null;
  lineItems: {
    id: string;
    categoryId: string;
    categoryName: string;
    glCode: string | null;
    spentOn: string;
    merchant: string | null;
    description: string;
    amount: number;
    receipt: { id: string; fileName: string } | null;
    violations: string[];
  }[];
  approval: {
    requestId: string;
    status: string;
    steps: { stepNo: number; name: string; status: string; approvers: string[]; decidedBy: string | null; decidedAt: string | null; comment: string | null }[];
  } | null;
  canEdit: boolean;
  canSubmit: boolean;
  canWithdraw: boolean;
  canMarkReimbursed: boolean;
};

const decider = aliasedTable(users, "decider");

export async function getClaim(ctx: RequestContext, claimId: string): Promise<ClaimDetail> {
  const detail = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ c: expenseClaims, empName: employees.displayName, empCode: employees.employeeCode, dept: departments.name })
      .from(expenseClaims)
      .innerJoin(employees, eq(employees.id, expenseClaims.employeeId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(eq(expenseClaims.id, claimId));
    if (!row) throw notFound("Expense claim");
    const access = await accessFor(ctx, tx, row.c);
    if (!access) throw notFound("Expense claim");

    const items = await tx
      .select({ item: expenseItems, categoryName: expenseCategories.name, glCode: expenseCategories.glCode, docId: documents.id, fileName: documents.fileName })
      .from(expenseItems)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenseItems.categoryId))
      .leftJoin(documents, and(eq(documents.id, expenseItems.receiptDocumentId), isNull(documents.deletedAt)))
      .where(eq(expenseItems.claimId, claimId))
      .orderBy(asc(expenseItems.spentOn), asc(expenseItems.createdAt));

    const [request] = await tx
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.subjectType, CLAIM_SUBJECT), eq(approvalRequests.subjectId, claimId)))
      .orderBy(desc(approvalRequests.createdAt))
      .limit(1);
    let approval: ClaimDetail["approval"] = null;
    if (request) {
      const steps = await tx
        .select({ s: approvalSteps, deciderName: sql<string | null>`coalesce(${decider.fullName}, ${decider.email})` })
        .from(approvalSteps)
        .leftJoin(decider, eq(decider.id, approvalSteps.decidedBy))
        .where(eq(approvalSteps.requestId, request.id))
        .orderBy(asc(approvalSteps.stepNo));
      const approverIds = [...new Set(steps.flatMap((s) => s.s.approverUserIds))];
      const names = approverIds.length
        ? await tx.select({ id: users.id, name: sql<string>`coalesce(${users.fullName}, ${users.email})` }).from(users).where(inArray(users.id, approverIds))
        : [];
      const nameOf = new Map(names.map((n) => [n.id, n.name]));
      approval = {
        requestId: request.id,
        status: request.status,
        steps: steps.map(({ s, deciderName }) => ({
          stepNo: s.stepNo,
          name: s.name,
          status: s.status,
          approvers: s.approverUserIds.map((u) => nameOf.get(u) ?? "Approver"),
          decidedBy: deciderName,
          decidedAt: s.decidedAt?.toISOString() ?? null,
          comment: s.comment,
        })),
      };
    }

    const c = row.c;
    const isOwner = access === "owner";
    const base = toListItem(c, items.length, items.filter((i) => i.item.policyViolations.length).length);
    return {
      ...base,
      access,
      employee: { id: c.employeeId, name: row.empName, code: row.empCode, department: row.dept },
      paymentReference: c.paymentReference,
      payrollPeriod: null as string | null,
      lineItems: items.map(({ item, categoryName, glCode, docId, fileName }) => ({
        id: item.id,
        categoryId: item.categoryId,
        categoryName,
        glCode,
        spentOn: item.spentOn,
        merchant: item.merchant,
        description: item.description,
        amount: item.amount,
        receipt: docId && fileName ? { id: docId, fileName } : null,
        violations: item.policyViolations,
      })),
      approval,
      canEdit: isOwner && c.status === "draft",
      canSubmit: isOwner && c.status === "draft" && items.length > 0,
      canWithdraw: isOwner && c.status === "submitted",
      canMarkReimbursed: canManageExpenses(ctx) && c.status === "approved" && c.reimbursementMethod === "bank_transfer",
    };
  });
  if (detail.postedToPayroll) detail.payrollPeriod = await payrollPeriodLabel(ctx.tenantId, claimId);
  return detail;
}

/**
 * Month the reimbursement was posted to. Payroll tables are payroll-only
 * under RLS, so this narrow read (period month only, tenant-filtered) runs in
 * system context after getClaim has authorized the caller for the claim.
 */
async function payrollPeriodLabel(tenantId: string, claimId: string) {
  return withSystem(async (tx) => {
    const [p] = await tx
      .select({ year: payrollPeriods.year, month: payrollPeriods.month })
      .from(expenseClaims)
      .innerJoin(payrollInputs, eq(payrollInputs.id, expenseClaims.payrollInputId))
      .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollInputs.periodId))
      .where(and(eq(expenseClaims.id, claimId), eq(expenseClaims.tenantId, tenantId)));
    return p ? `${MONTHS[p.month - 1]} ${p.year}` : null;
  }, tenantId);
}

/** Receipt download: anyone who can see the claim may open its receipts. */
export async function receiptDownloadUrl(ctx: RequestContext, documentId: string, meta: { ip?: string | null } = {}) {
  return ctx.db(async (tx) => {
    const [doc] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.ownerType, "expense_claim"), isNull(documents.deletedAt)));
    if (!doc?.ownerId) throw notFound("Receipt");
    const [claim] = await tx.select().from(expenseClaims).where(eq(expenseClaims.id, doc.ownerId));
    if (!claim || !(await accessFor(ctx, tx, claim))) throw notFound("Receipt");
    return attachmentDownloadUrl(tx, ctx, doc, meta);
  });
}
