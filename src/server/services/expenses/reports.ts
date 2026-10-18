import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { can, type RequestContext } from "../../auth/context";
import { auditLogs, departments, employees, expenseCategories, expenseClaims, expenseItems, users } from "../../db/schema";
import { audit } from "../../lib/audit";
import { forbidden } from "../../lib/errors";
import { toCsv } from "@/lib/csv";
import { todayIn } from "@/lib/format";
import type { ClaimFilter } from "@/lib/validation/expenses";
import { canManageExpenses } from "./categories";
import type { ClaimListItem } from "./claims";

export const canExportExpenses = (ctx: RequestContext) => canManageExpenses(ctx) && can(ctx, "reports.export", "all");
export const canSeeExpenseReports = (ctx: RequestContext) =>
  canManageExpenses(ctx) || (can(ctx, "reports.view", "all") && can(ctx, "expenses.view", "all"));

function claimFilters(filter: ClaimFilter) {
  const term = filter.q?.replace(/[%_]/g, "").trim();
  return and(
    // Finance never sees drafts that were never submitted.
    isNotNull(expenseClaims.submittedAt),
    filter.status ? eq(expenseClaims.status, filter.status) : undefined,
    filter.month ? sql`to_char(${expenseClaims.submittedAt} at time zone 'Asia/Kolkata', 'YYYY-MM') = ${filter.month}` : undefined,
    term
      ? or(
          ilike(expenseClaims.number, `%${term}%`),
          ilike(expenseClaims.title, `%${term}%`),
          ilike(employees.displayName, `%${term}%`),
          ilike(employees.employeeCode, `%${term}%`),
        )
      : undefined,
  );
}

/** Finance view: every submitted claim in the tenant. */
export async function listAllClaims(ctx: RequestContext, filter: ClaimFilter): Promise<ClaimListItem[]> {
  if (!canManageExpenses(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        c: expenseClaims,
        name: employees.displayName,
        code: employees.employeeCode,
        dept: departments.name,
        items: sql<number>`(select count(*)::int from ${expenseItems} i where i.claim_id = ${expenseClaims.id})`,
        violations: sql<number>`(select count(*)::int from ${expenseItems} i where i.claim_id = ${expenseClaims.id} and jsonb_array_length(i.policy_violations) > 0)`,
      })
      .from(expenseClaims)
      .innerJoin(employees, eq(employees.id, expenseClaims.employeeId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(claimFilters(filter))
      .orderBy(desc(expenseClaims.submittedAt))
      .limit(500);
    return rows.map(({ c, name, code, dept, items, violations }) => ({
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
      employee: { id: c.employeeId, name, code, department: dept },
    }));
  });
}

export async function financeSummary(ctx: RequestContext) {
  if (!canManageExpenses(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        pending: sql<number>`count(*) filter (where ${expenseClaims.status} = 'submitted')::int`,
        pendingAmount: sql<number>`coalesce(sum(${expenseClaims.total}) filter (where ${expenseClaims.status} = 'submitted'), 0)`.mapWith(Number),
        toPay: sql<number>`count(*) filter (where ${expenseClaims.status} = 'approved' and ${expenseClaims.reimbursementMethod} = 'bank_transfer')::int`,
        toPayAmount: sql<number>`coalesce(sum(${expenseClaims.total}) filter (where ${expenseClaims.status} = 'approved' and ${expenseClaims.reimbursementMethod} = 'bank_transfer'), 0)`.mapWith(Number),
        awaitingPayroll: sql<number>`count(*) filter (where ${expenseClaims.status} = 'approved' and ${expenseClaims.reimbursementMethod} = 'payroll' and ${expenseClaims.payrollInputId} is null)::int`,
        postedToPayroll: sql<number>`count(*) filter (where ${expenseClaims.status} = 'approved' and ${expenseClaims.payrollInputId} is not null)::int`,
      })
      .from(expenseClaims);
    return row;
  });
}

/** Line-level CSV of submitted claims for finance (requires reports.export). */
export async function exportClaimsCsv(ctx: RequestContext, filter: ClaimFilter) {
  if (!canExportExpenses(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        number: expenseClaims.number,
        title: expenseClaims.title,
        status: expenseClaims.status,
        method: expenseClaims.reimbursementMethod,
        paymentReference: expenseClaims.paymentReference,
        submittedAt: expenseClaims.submittedAt,
        decidedAt: expenseClaims.decidedAt,
        reimbursedAt: expenseClaims.reimbursedAt,
        code: employees.employeeCode,
        name: employees.displayName,
        dept: departments.name,
        spentOn: expenseItems.spentOn,
        category: expenseCategories.name,
        glCode: expenseCategories.glCode,
        taxable: expenseCategories.isTaxable,
        merchant: expenseItems.merchant,
        description: expenseItems.description,
        amount: expenseItems.amount,
        violations: expenseItems.policyViolations,
      })
      .from(expenseItems)
      .innerJoin(expenseClaims, eq(expenseClaims.id, expenseItems.claimId))
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenseItems.categoryId))
      .innerJoin(employees, eq(employees.id, expenseClaims.employeeId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(claimFilters(filter))
      .orderBy(desc(expenseClaims.submittedAt), asc(expenseItems.spentOn))
      .limit(50_000);
    await audit(tx, ctx, { action: "expense_claim.exported", entityType: "expense_claim", metadata: { rows: rows.length, filter } });
    const iso = (d: Date | null) => (d ? d.toISOString() : "");
    return toCsv([
      [
        "Claim", "Title", "Employee code", "Employee", "Department", "Claim status", "Expense date", "Category", "GL code", "Taxable",
        "Merchant", "Description", "Amount (INR)", "Policy flags", "Reimbursement", "Payment reference", "Submitted at", "Decided at", "Reimbursed at",
      ],
      ...rows.map((r) => [
        r.number, r.title, r.code, r.name, r.dept ?? "", r.status, r.spentOn, r.category, r.glCode ?? "", r.taxable ? "yes" : "no",
        r.merchant ?? "", r.description, (r.amount / 100).toFixed(2), r.violations.join(" | "), r.method, r.paymentReference ?? "",
        iso(r.submittedAt), iso(r.decidedAt), iso(r.reimbursedAt),
      ]),
    ]);
  });
}

/** Audit trail of expense records (requires audit.view + reports.export; RLS enforces audit.view). */
export async function exportExpenseAuditCsv(ctx: RequestContext) {
  if (!canExportExpenses(ctx) || !can(ctx, "audit.view", "all")) throw forbidden();
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        at: auditLogs.createdAt,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        actor: sql<string | null>`coalesce(${users.fullName}, ${users.email})`,
        actorType: auditLogs.actorType,
        number: expenseClaims.number,
        changes: auditLogs.changes,
        metadata: auditLogs.metadata,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .leftJoin(expenseClaims, sql`${expenseClaims.id}::text = ${auditLogs.entityId}::text`)
      .where(and(eq(auditLogs.tenantId, ctx.tenantId), inArray(auditLogs.entityType, ["expense_claim", "expense_category"])))
      .orderBy(desc(auditLogs.createdAt))
      .limit(50_000);
    await audit(tx, ctx, { action: "expense_claim.audit_exported", entityType: "expense_claim", metadata: { rows: rows.length } });
    return toCsv([
      ["Timestamp", "Action", "Entity", "Entity id", "Claim", "Actor", "Actor type", "Changes", "Details"],
      ...rows.map((r) => [
        r.at.toISOString(), r.action, r.entityType, r.entityId ?? "", r.number ?? "", r.actor ?? "", r.actorType,
        r.changes ? JSON.stringify(r.changes) : "", r.metadata ? JSON.stringify(r.metadata) : "",
      ]),
    ]);
  });
}

export type SpendReport = {
  since: string;
  total: number;
  byCategory: { name: string; amount: number; items: number }[];
  byDepartment: { name: string; amount: number; claims: number }[];
  byMonth: { month: string; amount: number }[];
};

/** Approved and reimbursed spend over the last 12 months, by expense date. */
export async function spendReport(ctx: RequestContext): Promise<SpendReport> {
  if (!canSeeExpenseReports(ctx)) throw forbidden();
  const today = todayIn();
  const since = `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-01`;
  return ctx.db(async (tx) => {
    const where = and(inArray(expenseClaims.status, ["approved", "reimbursed"]), gte(expenseItems.spentOn, since));
    const [byCategory, byDepartment, byMonth] = await Promise.all([
      tx
        .select({ name: expenseCategories.name, amount: sql<number>`sum(${expenseItems.amount})`.mapWith(Number), items: sql<number>`count(*)::int` })
        .from(expenseItems)
        .innerJoin(expenseClaims, eq(expenseClaims.id, expenseItems.claimId))
        .innerJoin(expenseCategories, eq(expenseCategories.id, expenseItems.categoryId))
        .where(where)
        .groupBy(expenseCategories.name)
        .orderBy(sql`2 desc`),
      tx
        .select({
          name: sql<string>`coalesce(${departments.name}, 'No department')`,
          amount: sql<number>`sum(${expenseItems.amount})`.mapWith(Number),
          claims: sql<number>`count(distinct ${expenseClaims.id})::int`,
        })
        .from(expenseItems)
        .innerJoin(expenseClaims, eq(expenseClaims.id, expenseItems.claimId))
        .innerJoin(employees, eq(employees.id, expenseClaims.employeeId))
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .where(where)
        .groupBy(sql`1`)
        .orderBy(sql`2 desc`),
      tx
        .select({ month: sql<string>`to_char(${expenseItems.spentOn}, 'YYYY-MM')`, amount: sql<number>`sum(${expenseItems.amount})`.mapWith(Number) })
        .from(expenseItems)
        .innerJoin(expenseClaims, eq(expenseClaims.id, expenseItems.claimId))
        .where(where)
        .groupBy(sql`1`)
        .orderBy(sql`1`),
    ]);
    return {
      since,
      total: byCategory.reduce((s, r) => s + r.amount, 0),
      byCategory: byCategory.map((r) => ({ ...r, items: Number(r.items) })),
      byDepartment: byDepartment.map((r) => ({ ...r, claims: Number(r.claims) })),
      byMonth,
    };
  });
}
