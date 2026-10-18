import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  attendanceDays,
  disbursements,
  documents,
  employees,
  legalEntities,
  payrollLineItems,
  payrollPeriods,
  payrollRunEmployees,
  payrollRuns,
  payslips,
  statutoryRuleSets,
} from "@/server/db/schema";
import { createEmployee } from "@/server/services/employees/mutations";
import { updateSensitive } from "@/server/services/employees/sensitive";
import { decide, pendingApprovalsFor } from "@/server/services/inbox";
import { seedDefaultComponents } from "@/server/services/payroll/config";
import { listRuleSets, markRuleSetVerified, seedDefaultRuleSets } from "@/server/services/payroll/rules";
import { openPeriod } from "@/server/services/payroll/periods";
import { createInput, importInputsCsv, postPayrollInput } from "@/server/services/payroll/inputs";
import { periodReadiness } from "@/server/services/payroll/readiness";
import { calculateRun } from "@/server/services/payroll/calculate";
import { createAdjustmentRun, createFnfRun, createRegularRun, getRunDetail, getRunEmployeeDetail, lockPayrollRun, submitRun } from "@/server/services/payroll/runs";
import { applyBankResponse, generateDisbursementFile } from "@/server/services/payroll/disbursement";
import { listPayslips, publishPayslips } from "@/server/services/payroll/payslips";
import { payrollRegisterCsv, runSummaries } from "@/server/services/payroll/reports";
import { explainRun } from "@/server/services/payroll/explain";
import { createDownloadLink } from "@/server/services/documents/documents";
import { withSystem } from "@/server/db/tx";
import { createEmployeeSchema } from "@/lib/validation/employees";
import { LOCK_CONFIRMATION } from "@/lib/validation/payroll";
import { addMember, contextFor, createOwnedTenant } from "../helpers/fixtures";

const employeeInput = (over: Record<string, unknown>) =>
  createEmployeeSchema.parse({
    firstName: "Asha",
    lastName: "Rao",
    workEmail: "",
    personalEmail: "",
    phone: "",
    dateOfBirth: "1990-05-10",
    employeeCode: "",
    employmentType: "full_time",
    workerType: "employee",
    workMode: "onsite",
    joiningDate: "2024-04-01",
    probationMonths: 6,
    noticePeriodDays: 30,
    annualCtc: 1200000,
    ...over,
  });

/** The Postgres error message behind a rejected query (drizzle wraps it in `cause`). */
async function dbError(p: Promise<unknown>) {
  try {
    await p;
    return "no error";
  } catch (err) {
    const e = err as { message?: string; cause?: { message?: string } };
    return e.cause?.message ?? e.message ?? String(err);
  }
}

const sensitive = (employeeId: string, account: string) => ({
  employeeId,
  pan: "ABCDE1234F",
  aadhaar: null,
  passport: null,
  uan: "100200300400",
  esicNumber: null,
  bankAccount: account,
  bankIfsc: "HDFC0001234",
  bankName: "HDFC",
  accountHolderName: null,
  taxRegime: "new" as const,
});

describe("payroll end to end", () => {
  let org: Awaited<ReturnType<typeof createOwnedTenant>>;
  let other: Awaited<ReturnType<typeof createOwnedTenant>>;
  let le: string;
  let e1: string;
  let e2: string;
  let e3: string;
  let payroll: Awaited<ReturnType<typeof contextFor>>;
  let hr: Awaited<ReturnType<typeof contextFor>>;
  let finance: Awaited<ReturnType<typeof contextFor>>;
  let emp1: Awaited<ReturnType<typeof contextFor>>;
  let emp2: Awaited<ReturnType<typeof contextFor>>;
  let periodId: string;
  let runId: string;

  beforeAll(async () => {
    org = await createOwnedTenant();
    other = await createOwnedTenant();
    [{ id: le }] = await db.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.tenantId, org.tenant.id));
    const owner = await contextFor(org.tenant.id, org.user.id);
    e1 = (await createEmployee(owner, employeeInput({ legalEntityId: le, firstName: "Asha" }))).id;
    e2 = (await createEmployee(owner, employeeInput({ legalEntityId: le, firstName: "Ravi", gender: "male" }))).id;
    e3 = (await createEmployee(owner, employeeInput({ legalEntityId: le, firstName: "Meera", joiningDate: "2015-01-01" }))).id;
    await updateSensitive(owner, sensitive(e1, "50100123456789"));
    await updateSensitive(owner, sensitive(e2, "50100987654321"));
    await updateSensitive(owner, sensitive(e3, "50100555566667"));
    // Meera leaves mid-October 2025.
    await db.update(employees).set({ status: "exited", lastWorkingDate: "2025-10-15", exitDate: "2025-10-15" }).where(eq(employees.id, e3));
    payroll = await contextFor(org.tenant.id, (await addMember(org.tenant.id, ["payroll_admin"])).user.id);
    hr = await contextFor(org.tenant.id, (await addMember(org.tenant.id, ["hr_admin"])).user.id);
    finance = await contextFor(org.tenant.id, (await addMember(org.tenant.id, ["finance_manager"])).user.id);
    emp1 = await contextFor(org.tenant.id, (await addMember(org.tenant.id, ["employee"], { employeeId: e1 })).user.id);
    emp2 = await contextFor(org.tenant.id, (await addMember(org.tenant.id, ["employee"], { employeeId: e2 })).user.id);
  });

  it("seeds components and unverified statutory rule sets idempotently", async () => {
    const a = await seedDefaultComponents(payroll);
    const b = await seedDefaultComponents(payroll);
    expect(a.created).toBeGreaterThan(20);
    expect(b.created).toBe(0);
    const r1 = await seedDefaultRuleSets(payroll);
    const r2 = await seedDefaultRuleSets(payroll);
    expect(r1.created).toBe(13);
    expect(r2.created).toBe(0);
    const sets = await listRuleSets(payroll);
    expect(sets.every((s) => !s.verified && !!s.sourceReference && /verified by a qualified payroll professional/.test(s.notes ?? ""))).toBe(true);
    await expect(seedDefaultRuleSets(hr)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("opens a period, records inputs idempotently and reports readiness", async () => {
    const p = await openPeriod(payroll, { legalEntityId: le, year: 2025, month: 10, payDate: "2025-10-31", inputCutoffDate: "2025-10-25" });
    periodId = p.id;
    await expect(openPeriod(payroll, { legalEntityId: le, year: 2025, month: 10, payDate: "2025-10-31", inputCutoffDate: "2025-10-25" })).rejects.toMatchObject({ code: "CONFLICT" });
    await createInput(payroll, { periodId, employeeId: e1, kind: "bonus", componentCode: "BONUS", amount: 10000, isTaxable: true, note: "Festival bonus" });
    await expect(createInput(payroll, { periodId, employeeId: e1, kind: "deduction", componentCode: "BONUS", amount: 10, isTaxable: false, note: null })).rejects.toMatchObject({ code: "VALIDATION" });
    const [emp2Row] = await db.select({ code: employees.employeeCode }).from(employees).where(eq(employees.id, e2));
    const csv = `employee_code,kind,component_code,amount,taxable,note,reference\n${emp2Row.code},reimbursement,REIMB,1500.50,no,Internet,R-1\n`;
    const preview = await importInputsCsv(payroll, { periodId, csv, commit: false });
    expect(preview.invalid).toBe(0);
    const first = await importInputsCsv(payroll, { periodId, csv, commit: true });
    const again = await importInputsCsv(payroll, { periodId, csv, commit: true });
    expect([first.created, again.created, again.duplicates]).toEqual([1, 0, 1]);
    // Contract for other modules: idempotent on (sourceType, sourceId).
    const ext = await withSystem((tx) => postPayrollInput(tx, org.tenant.id, { employeeId: e2, kind: "referral_reward", componentCode: "REFERRAL", amount: 500000, isTaxable: true, sourceType: "referral_reward", sourceId: "ref-1", effectiveOn: "2025-10-20" }), org.tenant.id);
    const dup = await withSystem((tx) => postPayrollInput(tx, org.tenant.id, { employeeId: e2, kind: "referral_reward", componentCode: "REFERRAL", amount: 500000, isTaxable: true, sourceType: "referral_reward", sourceId: "ref-1", effectiveOn: "2025-10-20" }), org.tenant.id);
    expect([ext.status, dup.status]).toEqual(["created", "duplicate"]);
    const ready = await periodReadiness(payroll, periodId);
    expect(ready.eligible).toBe(3);
    expect(ready.items.some((i) => i.code === "rule_set_unverified")).toBe(true);
    expect(ready.items.some((i) => i.code === "no_attendance")).toBe(true);
    expect(ready.items.some((i) => i.code === "exit" && i.employeeId === e3)).toBe(true);
  });

  it("calculates a full and final settlement with gratuity and leave encashment", async () => {
    const run = await createFnfRun(payroll, { periodId, employeeId: e3, leaveEncashmentDays: 10, encashmentDivisor: 30, noticePayDays: 0, noticeRecoveryDays: 0, includeGratuity: true });
    const res = await calculateRun(payroll, { runId: run.id, idempotencyKey: randomUUID(), varianceThresholdPct: 10 });
    expect(res.reused).toBe(false);
    const detail = await getRunDetail(payroll, run.id);
    const emp = detail.employees[0];
    const lines = (await getRunEmployeeDetail(payroll, emp.id)).lines;
    // Salary 1–15 Oct: Basic 50,000 × 15/31 = 24,193.55. Leave encashment 50,000 ÷ 30 × 10 = 16,666.67.
    // Gratuity: 01-01-2015 to 15-10-2025 = 10y 9m 15d -> 11 years; 50,000 × 15/26 × 11 = 3,17,307.69 -> 3,17,308.
    expect(lines.find((l) => l.componentCode === "BASIC")?.amount).toBe(2419355);
    expect(lines.find((l) => l.componentCode === "LEAVE_ENC")?.amount).toBe(1666667);
    expect(lines.find((l) => l.componentCode === "GRATUITY")?.amount).toBe(31730800);
  });

  it("calculates the regular run idempotently and excludes the settled employee", async () => {
    const { run } = await createRegularRun(payroll, periodId);
    runId = run.id;
    expect((await createRegularRun(payroll, periodId)).created).toBe(false);
    const key = randomUUID();
    const first = await calculateRun(payroll, { runId, idempotencyKey: key, varianceThresholdPct: 10 });
    const same = await calculateRun(payroll, { runId, idempotencyKey: key, varianceThresholdPct: 10 });
    expect(first.reused).toBe(false);
    expect(same.reused).toBe(true);
    const again = await calculateRun(payroll, { runId, idempotencyKey: randomUUID(), varianceThresholdPct: 10 });
    expect(again.reused).toBe(false);
    const rows = await db.select().from(payrollRunEmployees).where(eq(payrollRunEmployees.runId, runId));
    expect(rows.map((r) => r.employeeId).sort()).toEqual([e1, e2].sort());
    const asha = rows.find((r) => r.employeeId === e1)!;
    // Gross 98,200 + bonus 10,000 = 1,08,200; PF 1,800 + PT 200 = 2,000 deducted (TDS rebated to 0).
    expect([asha.grossEarnings, asha.totalDeductions, asha.netPay]).toEqual([10820000, 200000, 10620000]);
    const ravi = rows.find((r) => r.employeeId === e2)!;
    // Ravi: 98,200 + reimbursement 1,500.50 + referral 5,000 = 1,04,700.50 gross.
    expect(ravi.grossEarnings).toBe(10470050);
    const [r] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
    expect(r.status).toBe("calculated");
    expect(r.usesUnverifiedRules).toBe(true);
    expect(r.calculationBasis?.ruleSets.length).toBeGreaterThanOrEqual(4);
    const explanation = await explainRun(payroll, runId);
    expect(explanation.source).toBe("rules");
    const summary = await runSummaries(payroll, runId);
    expect(summary.statutory.pf.members).toBe(2);
    expect(summary.statutory.pt.find((p) => p.state === "KA")?.amount).toBe(40000);
    const register = await payrollRegisterCsv(payroll, runId);
    expect(register.csv.split("\r\n").length).toBeGreaterThan(3);
  });

  it("submits, needs both approval steps, and freezes results once approved", async () => {
    await expect(submitRun(emp1, runId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { snapshotHash } = await submitRun(payroll, runId);
    expect(snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    const hrQueue = await pendingApprovalsFor(hr);
    const req = hrQueue.find((a) => a.subjectType === "payroll_run")!;
    expect(req).toBeTruthy();
    await decide(hr, { requestId: req.requestId, decision: "approve", comment: null });
    expect((await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)))[0].status).toBe("pending_approval");
    const finQueue = await pendingApprovalsFor(finance);
    await decide(finance, { requestId: finQueue.find((a) => a.requestId === req.requestId)!.requestId, decision: "approve", comment: null });
    expect((await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)))[0].status).toBe("approved");
    // Results are frozen by the database once approved.
    const [anyLine] = await db
      .select({ id: payrollLineItems.id })
      .from(payrollLineItems)
      .innerJoin(payrollRunEmployees, eq(payrollRunEmployees.id, payrollLineItems.runEmployeeId))
      .where(eq(payrollRunEmployees.runId, runId))
      .limit(1);
    expect(await dbError(payroll.db((tx) => tx.update(payrollLineItems).set({ amount: 1 }).where(eq(payrollLineItems.id, anyLine.id))))).toMatch(/frozen once the run is approved/);
    await expect(calculateRun(payroll, { runId, idempotencyKey: randomUUID(), varianceThresholdPct: 10 })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("blocks locking with unverified rules unless explicitly overridden", async () => {
    await expect(lockPayrollRun(payroll, { runId, overrideUnverified: true, confirmation: LOCK_CONFIRMATION })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(lockPayrollRun(finance, { runId, overrideUnverified: false })).rejects.toMatchObject({ code: "PRECONDITION" });
    await db.insert(attendanceDays).values({ tenantId: org.tenant.id, employeeId: e1, date: "2025-10-03", status: "present", payableFraction: 1 }).onConflictDoNothing();
    const res = await lockPayrollRun(finance, { runId, overrideUnverified: true, confirmation: LOCK_CONFIRMATION });
    expect(res.attendanceLocked).toBe(1);
    const [r] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
    expect([r.status, r.unverifiedOverrideBy]).toEqual(["locked", finance.userId]);
    const [p] = await db.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId));
    expect(p.status).toBe("locked");
    const [att] = await db.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, e1), eq(attendanceDays.date, "2025-10-03")));
    expect(att.lockedByRunId).toBe(runId);
    expect(await dbError(payroll.db((tx) => tx.update(payrollRuns).set({ snapshotHash: "tampered" }).where(eq(payrollRuns.id, runId))))).toMatch(/run is locked/);
  });

  it("generates one bank payment per employee and applies bank responses idempotently", async () => {
    const first = await generateDisbursementFile(payroll, { runId, format: "neft_bulk" });
    const second = await generateDisbursementFile(payroll, { runId, format: "generic_csv" });
    expect([first.created, first.count]).toEqual([true, 2]);
    expect([second.created, second.count, second.alreadyIncluded]).toEqual([false, 0, 2]);
    const rows = await db.select().from(disbursements).where(eq(disbursements.runId, runId));
    expect(rows).toHaveLength(2);
    const [doc] = await db.select().from(documents).where(and(eq(documents.ownerType, "payroll_run"), eq(documents.ownerId, runId)));
    expect([doc.isSensitive, doc.employeeVisible, doc.mimeType]).toEqual([true, false, "text/csv"]);
    const csv = `payment_reference,status,utr,failure_reason\n${rows[0].id},paid,UTR12345678,\n${rows[1].id},failed,,Account closed\n`;
    const applied = await applyBankResponse(payroll, { batchId: first.batchId!, csv });
    const reapplied = await applyBankResponse(payroll, { batchId: first.batchId!, csv });
    expect([applied.paid, applied.failed]).toEqual([1, 1]);
    expect([reapplied.paid, reapplied.failed, reapplied.unchanged]).toEqual([0, 0, 2]);
    // The failed payment can be re-issued in a new batch; the paid one never is.
    const retry = await generateDisbursementFile(payroll, { runId, format: "generic_csv" });
    expect([retry.created, retry.count]).toEqual([true, 1]);
    expect(await db.select().from(disbursements).where(eq(disbursements.runId, runId))).toHaveLength(2);
  });

  it("publishes payslips once; employees see only their own after publishing", async () => {
    expect(await listPayslips(emp1)).toEqual([]);
    const pub = await publishPayslips(finance, runId);
    const again = await publishPayslips(finance, runId);
    expect([pub.created, again.created, again.skippedExisting]).toEqual([2, 0, 2]);
    expect(await db.select().from(payslips).where(eq(payslips.runId, runId))).toHaveLength(2);
    const mine = await listPayslips(emp1);
    expect(mine).toHaveLength(1);
    expect(mine[0].periodLabel).toBe("October 2025");
    const link = await createDownloadLink(emp1, mine[0].documentId!);
    expect(link.url).toMatch(/^http/);
    await expect(createDownloadLink(emp2, mine[0].documentId!)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listPayslips(emp2, e1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const leaked = await emp2.db((tx) => tx.select().from(payslips).where(eq(payslips.employeeId, e1)));
    expect(leaked).toHaveLength(0);
    const leakedResults = await emp2.db((tx) => tx.select().from(payrollRunEmployees).where(eq(payrollRunEmployees.employeeId, e1)));
    expect(leakedResults).toHaveLength(0);
    expect((await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)))[0].status).toBe("published");
  });

  it("corrects a locked run only through an adjustment run", async () => {
    const adj = await createAdjustmentRun(payroll, { parentRunId: runId, employeeIds: [e1], notes: "Check" });
    await calculateRun(payroll, { runId: adj.id, idempotencyKey: randomUUID(), varianceThresholdPct: 10 });
    const detail = await getRunDetail(payroll, adj.id);
    expect(detail.employees[0].messages.some((m) => m.code === "no_difference")).toBe(true);
    expect(detail.employees[0].net).toBe(0);
  });

  it("isolates payroll data between tenants and from non-payroll users", async () => {
    const outsider = await contextFor(other.tenant.id, other.user.id);
    await expect(getRunDetail(outsider, runId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const seen = await outsider.db((tx) => tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId)));
    expect(seen).toHaveLength(0);
    const rules = await outsider.db((tx) => tx.select().from(statutoryRuleSets).where(eq(statutoryRuleSets.tenantId, org.tenant.id)));
    expect(rules).toHaveLength(0);
    await expect(getRunDetail(emp1, runId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("records rule-set verification", async () => {
    const [set] = (await listRuleSets(payroll)).filter((s) => s.kind === "pf");
    await expect(markRuleSetVerified(hr, { id: set.id, attest: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await markRuleSetVerified(payroll, { id: set.id, attest: true });
    const [after] = await db.select().from(statutoryRuleSets).where(eq(statutoryRuleSets.id, set.id));
    expect(after.verifiedBy).toBe(payroll.userId);
    expect(after.verifiedAt).not.toBeNull();
  });
});
