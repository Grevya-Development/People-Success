import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { db } from "@/server/db/client";
import { withSystem } from "@/server/db/tx";
import {
  approvalRequests,
  approvalSteps,
  documents,
  employees,
  expenseClaims,
  expenseItems,
  legalEntities,
  payrollInputs,
  payrollPeriods,
} from "@/server/db/schema";
import type { RequestContext } from "@/server/auth/context";
import "@/server/services/approvals/handlers";
import { decideApproval } from "@/server/services/approvals/engine";
import {
  addClaimItem,
  cancelClaim,
  createClaim,
  getClaim,
  listMyClaims,
  markClaimReimbursed,
  receiptDownloadUrl,
  removeClaimItem,
  submitClaim,
  withdrawClaim,
} from "@/server/services/expenses/claims";
import { createExpenseCategory, listExpenseCategories, seedStandardExpenseCategories } from "@/server/services/expenses/categories";
import { postPendingReimbursements, postReimbursement } from "@/server/services/expenses/reimbursement";
import { exportClaimsCsv, listAllClaims, spendReport } from "@/server/services/expenses/reports";
import { expenseCategorySchema, expenseItemSchema } from "@/lib/validation/expenses";
import { todayIn } from "@/lib/format";
import { addMember, contextFor, createOwnedTenant } from "../helpers/fixtures";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
const png = (name = "receipt.png", salt = 0) => new File([new Uint8Array([...PNG, salt]) as BlobPart], name, { type: "image/png" });

type Org = Awaited<ReturnType<typeof createOwnedTenant>>;

async function employee(tenantId: string, code: string, name: string, managerId: string | null = null) {
  const [le] = await db.select().from(legalEntities).where(eq(legalEntities.tenantId, tenantId));
  const [e] = await db
    .insert(employees)
    .values({ tenantId, legalEntityId: le.id, employeeCode: code, firstName: name, displayName: name, joiningDate: "2025-04-01", status: "active", managerId })
    .returning();
  return e;
}

async function openPeriod(tenantId: string, legalEntityId: string, opts: { year?: number; month?: number } = {}) {
  const today = todayIn();
  const year = opts.year ?? Number(today.slice(0, 4));
  const month = opts.month ?? Number(today.slice(5, 7));
  const mm = String(month).padStart(2, "0");
  const [p] = await db
    .insert(payrollPeriods)
    .values({
      tenantId,
      legalEntityId,
      year,
      month,
      startDate: `${year}-${mm}-01`,
      endDate: `${year}-${mm}-28`,
      payDate: `${year}-${mm}-28`,
      inputCutoffDate: "2099-12-31",
      status: "open",
    })
    .returning();
  return p;
}

/** Same as the inbox's decide action. */
const decide = (ctx: RequestContext, input: { requestId: string; decision: "approve" | "reject"; comment?: string }) =>
  ctx.db((tx) => decideApproval(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, input.requestId, input.decision, input.comment ?? null));

const item = (claimId: string, categoryId: string, rupees: string, description: string, over: Partial<Record<string, string>> = {}) =>
  expenseItemSchema.parse({ claimId, categoryId, spentOn: todayIn(), merchant: "Vendor", description, amount: rupees, ...over });

async function pendingRequest(claimId: string) {
  const [r] = await db
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.subjectType, "expense_claim"), eq(approvalRequests.subjectId, claimId), eq(approvalRequests.status, "pending")));
  return r;
}

describe("expense claims", () => {
  let org: Org;
  let le: string;
  let finance: RequestContext;
  let manager: RequestContext;
  let emp: RequestContext;
  let outsider: RequestContext;
  let empId: string;
  let managerUserId: string;
  let financeUserId: string;
  let cab: string;
  let meals: string;
  const stored: string[] = [];

  beforeAll(async () => {
    org = await createOwnedTenant();
    [{ id: le }] = await db.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.tenantId, org.tenant.id));
    const mgr = await employee(org.tenant.id, "E1", "Meera Manager");
    const e = await employee(org.tenant.id, "E2", "Ravi Kumar", mgr.id);
    const other = await employee(org.tenant.id, "E3", "Other Person");
    empId = e.id;
    const m = await addMember(org.tenant.id, ["people_manager"], { employeeId: mgr.id });
    const u = await addMember(org.tenant.id, ["employee"], { employeeId: e.id });
    const o = await addMember(org.tenant.id, ["employee"], { employeeId: other.id });
    const f = await addMember(org.tenant.id, ["finance_manager"]);
    managerUserId = m.user.id;
    financeUserId = f.user.id;
    manager = await contextFor(org.tenant.id, m.user.id);
    emp = await contextFor(org.tenant.id, u.user.id);
    outsider = await contextFor(org.tenant.id, o.user.id);
    finance = await contextFor(org.tenant.id, f.user.id);
  });

  afterAll(async () => {
    const rows = await db.select({ path: documents.storagePath }).from(documents).where(eq(documents.tenantId, org.tenant.id));
    stored.push(...rows.map((r) => r.path));
    if (stored.length) {
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
      await admin.storage.from("documents").remove(stored);
    }
  });

  it("seeds standard categories idempotently and only for expense managers", async () => {
    await expect(seedStandardExpenseCategories(emp)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const first = await seedStandardExpenseCategories(finance);
    const second = await seedStandardExpenseCategories(finance);
    expect(first.added).toBe(8);
    expect(second).toEqual({ added: 0, skipped: 8 });
    const cats = await listExpenseCategories(emp);
    expect(cats.map((c) => c.name)).toContain("Local conveyance");
    meals = cats.find((c) => c.code === "MEALS")!.id;
    ({ id: cab } = await createExpenseCategory(
      finance,
      expenseCategorySchema.parse({ name: "Cab rides", code: "cab", maxPerItem: "1000", maxPerMonth: "1500", receiptRequiredAbove: "2000", glCode: "6111" }),
    ));
  });

  it("validates items, submits, routes manager → finance and posts to payroll exactly once", async () => {
    const period = await openPeriod(org.tenant.id, le);
    const claim = await createClaim(emp, { title: "Client visit to Pune", reimbursementMethod: "payroll" });
    expect(claim.number).toMatch(/^EXP-\d{4}$/);

    const a = await addClaimItem(emp, item(claim.id, cab, "800", "Airport cab"), null);
    expect(a.violations).toEqual([]);
    const b = await addClaimItem(emp, item(claim.id, cab, "900", "Return cab"), null);
    expect(b.violations.join(" ")).toMatch(/monthly limit/);
    const c = await addClaimItem(emp, item(claim.id, meals, "2000", "Team dinner"), png("dinner.png"));
    expect(c.violations.join(" ")).toMatch(/per-item limit/);
    const d = await addClaimItem(emp, item(claim.id, meals, "400", "Lunch"), png("same-receipt.png"));
    expect(d.violations.join(" ")).toMatch(new RegExp(`same receipt was already used on ${claim.number}`));
    const e = await addClaimItem(emp, item(claim.id, meals, "800", "Snacks"), null);
    expect(e.violations.join(" ")).toMatch(/receipt is required/i);
    const f = await addClaimItem(emp, item(claim.id, cab, "100", "Tomorrow's cab", { spentOn: "2099-01-01" }), null);
    expect(f.violations.join(" ")).toMatch(/future/);

    // Others cannot add to someone else's claim; drafts are private.
    await expect(addClaimItem(outsider, item(claim.id, cab, "100", "Sneaky"), null)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getClaim(manager, claim.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Blocking violations stop submission.
    await expect(submitClaim(emp, claim.id)).rejects.toMatchObject({ code: "VALIDATION" });
    await removeClaimItem(emp, e.id);
    await removeClaimItem(emp, f.id);
    const submitted = await submitClaim(emp, claim.id);
    expect(submitted.total).toBe(410_000);

    const detail = await getClaim(emp, claim.id);
    expect(detail.status).toBe("submitted");
    expect(detail.lineItems).toHaveLength(4);
    // Re-evaluated at submission: both cab rides now share the monthly overrun; dinner and lunch share a receipt.
    const flags = Object.fromEntries(detail.lineItems.map((i) => [i.description, i.violations.join(" ")]));
    expect(flags["Airport cab"]).toMatch(/monthly limit/);
    expect(flags["Return cab"]).toMatch(/monthly limit/);
    expect(flags["Team dinner"]).toMatch(/per-item limit/);
    expect(flags["Lunch"]).toMatch(/same receipt/);
    expect(detail.canEdit).toBe(false);
    await expect(addClaimItem(emp, item(claim.id, cab, "10", "Late add"), null)).rejects.toMatchObject({ code: "INVALID_STATE" });

    // Receipts are downloadable by people who can see the claim, not others.
    const receipt = detail.lineItems.find((i) => i.receipt)!.receipt!;
    expect(await receiptDownloadUrl(emp, receipt.id)).toMatch(/^http/);
    await expect(receiptDownloadUrl(outsider, receipt.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Step 1: the reporting manager.
    const req = await pendingRequest(claim.id);
    const [step1] = await db.select().from(approvalSteps).where(and(eq(approvalSteps.requestId, req.id), eq(approvalSteps.stepNo, 1)));
    expect(step1.approverUserIds).toEqual([managerUserId]);
    expect((await getClaim(manager, claim.id)).access).toBe("viewer");
    await expect(decide(emp, { requestId: req.id, decision: "approve" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await decide(manager, { requestId: req.id, decision: "approve" });
    expect((await getClaim(emp, claim.id)).status).toBe("submitted");

    // Step 2: finance. Approval posts the reimbursement into the open period.
    const [step2] = await db.select().from(approvalSteps).where(and(eq(approvalSteps.requestId, req.id), eq(approvalSteps.stepNo, 2)));
    expect(step2.approverUserIds).toContain(financeUserId);
    await decide(finance, { requestId: req.id, decision: "approve" });

    const inputs = await db.select().from(payrollInputs).where(and(eq(payrollInputs.tenantId, org.tenant.id), eq(payrollInputs.sourceId, claim.id)));
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ periodId: period.id, employeeId: empId, kind: "reimbursement", componentCode: "REIMB", amount: 410_000, isTaxable: false, sourceType: "expense_claim" });
    const [row] = await db.select().from(expenseClaims).where(eq(expenseClaims.id, claim.id));
    expect(row).toMatchObject({ status: "approved", payrollInputId: inputs[0].id });

    // Re-running the posting (handler retries, daily job) never double-posts.
    expect(await withSystem((tx) => postReimbursement(tx, org.tenant.id, claim.id, null), org.tenant.id)).toEqual({ status: "already_posted" });
    await db.update(expenseClaims).set({ payrollInputId: null }).where(eq(expenseClaims.id, claim.id));
    await postPendingReimbursements(org.tenant.id);
    const again = await db.select().from(payrollInputs).where(and(eq(payrollInputs.tenantId, org.tenant.id), eq(payrollInputs.sourceType, "expense_claim")));
    expect(again).toHaveLength(1);
    expect((await getClaim(emp, claim.id)).payrollPeriod).toBeTruthy();

    // Approved claims cannot be withdrawn or edited.
    await expect(withdrawClaim(emp, claim.id)).rejects.toMatchObject({ code: "INVALID_STATE" });

    // Finance sees it; the list and CSV export include it.
    const all = await listAllClaims(finance, {});
    expect(all.find((x) => x.id === claim.id)?.employee?.name).toBe("Ravi Kumar");
    await expect(listAllClaims(emp, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    const csv = await exportClaimsCsv(finance, {});
    expect(csv).toContain(claim.number);
    expect(csv).toContain("2000.00"); // line amounts are exported in rupees
    const report = await spendReport(finance);
    expect(report.total).toBe(410_000);
    expect(report.byCategory.map((r) => r.name).sort()).toEqual(["Cab rides", "Meals"]);
  });

  it("enforces withdraw and cancel rules", async () => {
    const claim = await createClaim(emp, { title: "Conference", reimbursementMethod: "payroll" });
    await addClaimItem(emp, item(claim.id, cab, "300", "Cab to venue"), null);
    await submitClaim(emp, claim.id);
    const req = await pendingRequest(claim.id);
    await expect(withdrawClaim(outsider, claim.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await withdrawClaim(emp, claim.id);
    const [after] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, req.id));
    expect(after.status).toBe("cancelled");
    expect((await getClaim(emp, claim.id)).status).toBe("draft");
    await expect(withdrawClaim(emp, claim.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await cancelClaim(emp, claim.id);
    expect((await listMyClaims(emp)).find((c) => c.id === claim.id)?.status).toBe("cancelled");
    await expect(submitClaim(emp, claim.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("rejects, and pays bank transfers when finance records the payment", async () => {
    const rejected = await createClaim(emp, { title: "Personal shopping", reimbursementMethod: "payroll" });
    await addClaimItem(emp, item(rejected.id, cab, "200", "Mall"), null);
    await submitClaim(emp, rejected.id);
    const rq = await pendingRequest(rejected.id);
    await expect(decide(manager, { requestId: rq.id, decision: "reject" })).rejects.toMatchObject({ code: "VALIDATION" });
    await decide(manager, { requestId: rq.id, decision: "reject", comment: "Not business related" });
    expect((await getClaim(emp, rejected.id)).status).toBe("rejected");

    const bank = await createClaim(emp, { title: "Training course", reimbursementMethod: "bank_transfer" });
    await addClaimItem(emp, item(bank.id, cab, "500", "Course travel"), null);
    await submitClaim(emp, bank.id);
    const bq = await pendingRequest(bank.id);
    await decide(manager, { requestId: bq.id, decision: "approve" });
    await decide(finance, { requestId: bq.id, decision: "approve" });
    const approved = await getClaim(finance, bank.id);
    expect(approved).toMatchObject({ status: "approved", postedToPayroll: false, canMarkReimbursed: true });
    await expect(markClaimReimbursed(emp, { id: bank.id, paymentReference: "UTR123456" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await markClaimReimbursed(finance, { id: bank.id, paymentReference: "UTR123456" });
    expect(await getClaim(emp, bank.id)).toMatchObject({ status: "reimbursed", paymentReference: "UTR123456" });
    await expect(markClaimReimbursed(finance, { id: bank.id, paymentReference: "UTR999" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("keeps approved claims awaiting a payroll period and posts them when one opens", async () => {
    await db.update(payrollPeriods).set({ status: "locked" }).where(eq(payrollPeriods.tenantId, org.tenant.id));
    const claim = await createClaim(emp, { title: "Late cab", reimbursementMethod: "payroll" });
    await addClaimItem(emp, item(claim.id, cab, "150", "Cab"), null);
    await submitClaim(emp, claim.id);
    const req = await pendingRequest(claim.id);
    await decide(manager, { requestId: req.id, decision: "approve" });
    await decide(finance, { requestId: req.id, decision: "approve" });
    expect(await getClaim(emp, claim.id)).toMatchObject({ status: "approved", postedToPayroll: false });

    const next = await openPeriod(org.tenant.id, le, { year: 2099, month: 1 });
    const r1 = await postPendingReimbursements(org.tenant.id);
    const r2 = await postPendingReimbursements(org.tenant.id);
    expect(r1.posted).toBe(1);
    expect(r2.posted).toBe(0);
    const inputs = await db.select().from(payrollInputs).where(eq(payrollInputs.sourceId, claim.id));
    expect(inputs).toHaveLength(1);
    expect(inputs[0].periodId).toBe(next.id);
  });

  it("isolates claims across tenants", async () => {
    const other = await createOwnedTenant();
    const otherOwner = await contextFor(other.tenant.id, other.user.id);
    const [mine] = await listMyClaims(emp);
    await expect(getClaim(otherOwner, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listAllClaims(otherOwner, {})).length).toBe(0);
    const leaked = await otherOwner.db((tx) => tx.select().from(expenseItems));
    expect(leaked).toHaveLength(0);
  });
});

describe("expense approvals by a fallback approver without payroll rights", () => {
  it("still posts the reimbursement (elevated only for the payroll input)", async () => {
    const org = await createOwnedTenant();
    const [{ id: le }] = await db.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.tenantId, org.tenant.id));
    const e = await employee(org.tenant.id, "E1", "No Manager");
    const u = await addMember(org.tenant.id, ["employee"], { employeeId: e.id });
    const hr = await addMember(org.tenant.id, ["hr_admin"]);
    const fin = await addMember(org.tenant.id, ["payroll_admin"]);
    const emp = await contextFor(org.tenant.id, u.user.id);
    const hrCtx = await contextFor(org.tenant.id, hr.user.id);
    const finCtx = await contextFor(org.tenant.id, fin.user.id);
    await seedStandardExpenseCategories(finCtx);
    const [cat] = (await listExpenseCategories(emp)).filter((c) => c.code === "OTHER");
    await openPeriod(org.tenant.id, le);

    const claim = await createClaim(emp, { title: "Stationery", reimbursementMethod: "payroll" });
    await addClaimItem(emp, item(claim.id, cat.id, "250", "Notebooks"), png("stationery.png", 7));
    await submitClaim(emp, claim.id);
    const req = await pendingRequest(claim.id);
    // No manager and no finance_manager: both steps fall back to HR admins / the owner.
    await decide(hrCtx, { requestId: req.id, decision: "approve" });
    const [s2] = await db.select().from(approvalSteps).where(and(eq(approvalSteps.requestId, req.id), eq(approvalSteps.stepNo, 2)));
    expect(s2.approverUserIds).toContain(hr.user.id);
    await decide(hrCtx, { requestId: req.id, decision: "approve" });
    const inputs = await db.select().from(payrollInputs).where(eq(payrollInputs.sourceId, claim.id));
    expect(inputs).toHaveLength(1);
    // The elevation did not leak: the HR admin still cannot read payroll inputs.
    expect(await hrCtx.db((tx) => tx.select().from(payrollInputs))).toHaveLength(0);
    const docs = await db.select({ path: documents.storagePath }).from(documents).where(eq(documents.tenantId, org.tenant.id));
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    if (docs.length) await admin.storage.from("documents").remove(docs.map((d) => d.path));
  });
});
