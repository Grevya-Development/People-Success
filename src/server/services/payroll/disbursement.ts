import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import type { RequestContext } from "../../auth/context";
import { authorize, can } from "../../auth/context";
import { disbursementBatches, disbursements, employeeSensitive, employees, payrollPeriods, payrollRunEmployees, payrollRuns } from "../../db/schema";
import { audit } from "../../lib/audit";
import { decryptField } from "../../lib/crypto";
import { AppError, forbidden, invalidState, notFound } from "../../lib/errors";
import { parseCsv, toCsv } from "@/lib/csv";
import type { bankResponseSchema, disbursementSchema } from "@/lib/validation/payroll";
import { payrollFileUrl, storeGeneratedFile } from "./files";
import { lockRun, periodLabel, POSTED_STATUSES, verifySnapshot } from "./shared";

const amountText = (paise: number) => `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Generate a bank transfer file for a locked run. One disbursement row per
 * employee per run (unique index); employees already in a non-failed
 * disbursement are never included again. Failed payments are re-issued in the
 * new batch. Account numbers are decrypted only in memory for the file.
 */
export async function generateDisbursementFile(ctx: RequestContext, input: z.output<typeof disbursementSchema>) {
  authorize(ctx, "payroll.run", "all");
  if (!can(ctx, "employees.sensitive.view", "all")) throw forbidden("Generating bank files requires access to employees' bank details.");
  return ctx.db(async (tx) => {
    const run = await lockRun(tx, input.runId);
    if (!POSTED_STATUSES.includes(run.status)) throw invalidState("Lock the run before generating a bank file.");
    await verifySnapshot(tx, run);
    const [period] = await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, run.periodId));
    const results = await tx
      .select({ re: payrollRunEmployees, code: employees.employeeCode, name: employees.displayName })
      .from(payrollRunEmployees)
      .innerJoin(employees, eq(employees.id, payrollRunEmployees.employeeId))
      .where(eq(payrollRunEmployees.runId, run.id))
      .orderBy(asc(employees.employeeCode));
    const payable = results.filter((r) => r.re.netPay > 0 && !["error", "on_hold", "excluded"].includes(r.re.status));
    const existing = await tx.select().from(disbursements).where(eq(disbursements.runId, run.id));
    const byEmployee = new Map(existing.map((d) => [d.employeeId, d]));
    const candidates = payable.filter((r) => {
      const d = byEmployee.get(r.re.employeeId);
      return !d || d.status === "failed";
    });
    const alreadyIncluded = payable.length - candidates.length;
    if (!candidates.length) {
      return { created: false as const, batchId: null, count: 0, skippedNoBank: [] as string[], alreadyIncluded };
    }
    const bank = await tx
      .select({ employeeId: employeeSensitive.employeeId, enc: employeeSensitive.bankAccountEnc, last4: employeeSensitive.bankAccountLast4, ifsc: employeeSensitive.bankIfsc, holder: employeeSensitive.accountHolderName })
      .from(employeeSensitive)
      .where(inArray(employeeSensitive.employeeId, candidates.map((c) => c.re.employeeId)));
    const bankBy = new Map(bank.map((b) => [b.employeeId, b]));
    const withBank = candidates.filter((c) => bankBy.get(c.re.employeeId)?.enc && bankBy.get(c.re.employeeId)?.ifsc);
    const skippedNoBank = candidates.filter((c) => !withBank.includes(c)).map((c) => c.code);
    if (!withBank.length) return { created: false as const, batchId: null, count: 0, skippedNoBank, alreadyIncluded };

    const [batch] = await tx
      .insert(disbursementBatches)
      .values({ tenantId: ctx.tenantId, runId: run.id, format: input.format, totalAmount: 0, count: 0, createdBy: ctx.userId })
      .returning();
    for (const c of withBank) {
      const b = bankBy.get(c.re.employeeId)!;
      const prior = byEmployee.get(c.re.employeeId);
      if (prior) {
        await tx
          .update(disbursements)
          .set({ batchId: batch.id, status: "file_generated", amount: c.re.netPay, bankAccountLast4: b.last4, bankIfsc: b.ifsc, utr: null, failureReason: null, paidAt: null })
          .where(and(eq(disbursements.id, prior.id), eq(disbursements.status, "failed")));
      } else {
        await tx
          .insert(disbursements)
          .values({ tenantId: ctx.tenantId, runId: run.id, runEmployeeId: c.re.id, employeeId: c.re.employeeId, batchId: batch.id, amount: c.re.netPay, bankAccountLast4: b.last4, bankIfsc: b.ifsc, status: "file_generated" })
          .onConflictDoNothing();
      }
    }
    const lines = await tx.select().from(disbursements).where(eq(disbursements.batchId, batch.id));
    if (!lines.length) {
      await tx.delete(disbursementBatches).where(eq(disbursementBatches.id, batch.id));
      return { created: false as const, batchId: null, count: 0, skippedNoBank, alreadyIncluded };
    }
    const info = new Map(withBank.map((c) => [c.re.employeeId, c]));
    const label = periodLabel(period.year, period.month);
    const rows: (string | number)[][] = [];
    if (input.format === "neft_bulk") {
      rows.push(["Transaction type", "Beneficiary account number", "Beneficiary IFSC", "Beneficiary name", "Amount", "Value date", "Payment reference", "Remarks"]);
    } else {
      rows.push(["Payment reference", "Employee code", "Beneficiary name", "Account number", "IFSC", "Amount", "Currency", "Narration"]);
    }
    for (const l of lines.sort((a, b) => (info.get(a.employeeId)!.code < info.get(b.employeeId)!.code ? -1 : 1))) {
      const c = info.get(l.employeeId)!;
      const b = bankBy.get(l.employeeId)!;
      const account = decryptField(b.enc!);
      const name = (b.holder || c.name).slice(0, 60);
      if (input.format === "neft_bulk") rows.push(["NEFT", account, b.ifsc!, name, amountText(l.amount), ddmmyyyy(period.payDate), l.id, `Salary ${label}`]);
      else rows.push([l.id, c.code, name, account, b.ifsc!, amountText(l.amount), "INR", `Salary ${label}`]);
    }
    const csv = toCsv(rows);
    const total = lines.reduce((a, l) => a + l.amount, 0);
    const doc = await storeGeneratedFile(tx, {
      tenantId: ctx.tenantId,
      bytes: new TextEncoder().encode(csv),
      mimeType: "text/csv",
      extension: "csv",
      ownerType: "payroll_run",
      ownerId: run.id,
      title: `Bank transfer ${label} (${input.format === "neft_bulk" ? "NEFT bulk" : "CSV"})`,
      fileName: `salary-${period.year}-${String(period.month).padStart(2, "0")}-${input.format}-${batch.id.slice(0, 8)}.csv`,
      createdBy: ctx.userId,
    });
    await tx.update(disbursementBatches).set({ documentId: doc.id, totalAmount: total, count: lines.length }).where(eq(disbursementBatches.id, batch.id));
    if (run.status === "locked") await tx.update(payrollRuns).set({ status: "disbursed" }).where(eq(payrollRuns.id, run.id));
    await audit(tx, ctx, {
      action: "payroll.bank_file_generated",
      entityType: "payroll_run",
      entityId: run.id,
      metadata: { batchId: batch.id, format: input.format, count: lines.length, skippedNoBank: skippedNoBank.length, alreadyIncluded },
    });
    return { created: true as const, batchId: batch.id, count: lines.length, skippedNoBank, alreadyIncluded };
  });
}

export async function batchFileUrl(ctx: RequestContext, batchId: string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  authorize(ctx, "payroll.run", "all");
  return ctx.db(async (tx) => {
    const [batch] = await tx.select().from(disbursementBatches).where(eq(disbursementBatches.id, batchId));
    if (!batch || !batch.documentId) throw notFound("Bank file");
    const { url, doc } = await payrollFileUrl(tx, batch.documentId);
    await audit(tx, ctx, { action: "payroll.bank_file_downloaded", entityType: "disbursement_batch", entityId: batch.id, metadata: { documentId: doc.id }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null });
    return url;
  });
}

type ResponseRow = { line: number; reference: string; outcome: "paid" | "failed" | "unchanged" | "error"; message?: string };

/**
 * Apply a bank response file: columns payment_reference, status (paid|failed),
 * utr, failure_reason. Idempotent: re-applying the same file changes nothing.
 */
export async function applyBankResponse(ctx: RequestContext, input: z.output<typeof bankResponseSchema>) {
  authorize(ctx, "payroll.run", "all");
  const rows = parseCsv(input.csv);
  if (rows.length < 2) throw new AppError("VALIDATION", "The file has no data rows.");
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const idx = (n: string) => header.indexOf(n);
  if (idx("payment_reference") < 0 || idx("status") < 0) throw new AppError("VALIDATION", "Expected columns: payment_reference, status, utr, failure_reason.");
  return ctx.db(async (tx) => {
    const [batch] = await tx.select().from(disbursementBatches).where(eq(disbursementBatches.id, input.batchId)).for("update");
    if (!batch) throw notFound("Disbursement batch");
    const lines = await tx.select().from(disbursements).where(eq(disbursements.batchId, batch.id)).for("update");
    const byId = new Map(lines.map((l) => [l.id, l]));
    const out: ResponseRow[] = [];
    const now = new Date();
    for (const [i, r] of rows.slice(1).entries()) {
      const reference = (r[idx("payment_reference")] ?? "").trim();
      const statusRaw = (r[idx("status")] ?? "").trim().toLowerCase();
      const utr = idx("utr") >= 0 ? (r[idx("utr")] ?? "").trim().replace(/^'/, "") : "";
      const reason = idx("failure_reason") >= 0 ? (r[idx("failure_reason")] ?? "").trim().slice(0, 300) : "";
      const line = i + 2;
      const d = byId.get(reference);
      if (!d) {
        out.push({ line, reference, outcome: "error", message: "Not a payment in this batch" });
        continue;
      }
      const status = ["paid", "success", "processed", "credited"].includes(statusRaw) ? "paid" : ["failed", "rejected", "returned"].includes(statusRaw) ? "failed" : null;
      if (!status) {
        out.push({ line, reference, outcome: "error", message: `Unknown status "${statusRaw}"` });
        continue;
      }
      if (status === "paid" && !/^[A-Za-z0-9]{6,30}$/.test(utr)) {
        out.push({ line, reference, outcome: "error", message: "A paid row needs a valid UTR" });
        continue;
      }
      if (d.status === "cancelled") {
        out.push({ line, reference, outcome: "error", message: "This payment was cancelled" });
        continue;
      }
      if (d.status === "paid") {
        out.push(status === "paid" && d.utr === utr ? { line, reference, outcome: "unchanged" } : { line, reference, outcome: "error", message: `Already paid with UTR ${d.utr}` });
        continue;
      }
      if (d.status === "failed" && status === "failed") {
        out.push({ line, reference, outcome: "unchanged" });
        continue;
      }
      await tx
        .update(disbursements)
        .set(status === "paid" ? { status: "paid", utr, paidAt: now, failureReason: null } : { status: "failed", failureReason: reason || "Rejected by bank" })
        .where(eq(disbursements.id, d.id));
      byId.set(d.id, { ...d, status, utr: status === "paid" ? utr : d.utr });
      out.push({ line, reference, outcome: status });
    }
    const after = [...byId.values()];
    if (after.length && after.every((l) => l.status === "paid") && batch.status !== "paid") {
      await tx.update(disbursementBatches).set({ status: "paid" }).where(eq(disbursementBatches.id, batch.id));
    } else if (batch.status === "file_generated" && out.some((o) => o.outcome === "paid" || o.outcome === "failed")) {
      await tx.update(disbursementBatches).set({ status: "submitted" }).where(eq(disbursementBatches.id, batch.id));
    }
    const summary = { paid: out.filter((o) => o.outcome === "paid").length, failed: out.filter((o) => o.outcome === "failed").length, unchanged: out.filter((o) => o.outcome === "unchanged").length, errors: out.filter((o) => o.outcome === "error").length };
    await audit(tx, ctx, { action: "payroll.bank_response_applied", entityType: "disbursement_batch", entityId: batch.id, metadata: summary });
    return { ...summary, rows: out };
  });
}

export async function listDisbursements(ctx: RequestContext, runId: string) {
  authorize(ctx, "payroll.view", "all");
  return ctx.db(async (tx) => {
    const run = await tx.select({ id: payrollRuns.id }).from(payrollRuns).where(eq(payrollRuns.id, runId));
    if (!run.length) throw notFound("Payroll run");
    return tx
      .select({ d: disbursements, name: employees.displayName, code: employees.employeeCode })
      .from(disbursements)
      .innerJoin(employees, eq(employees.id, disbursements.employeeId))
      .where(eq(disbursements.runId, runId))
      .orderBy(asc(employees.employeeCode));
  });
}
