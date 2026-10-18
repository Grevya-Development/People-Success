import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { z } from "zod";
import type { Tx } from "../../db/client";
import type { RequestContext } from "../../auth/context";
import { authorize } from "../../auth/context";
import { employees, payComponents, payrollInputs, payrollPeriods, payrollRuns } from "../../db/schema";
import { audit } from "../../lib/audit";
import { AppError, invalidState, notFound } from "../../lib/errors";
import { sha256 } from "../../lib/crypto";
import { parseCsv } from "@/lib/csv";
import { DEDUCTION_INPUT_KINDS, type InputKind } from "@/lib/payroll/types";
import { INPUT_KINDS, toPaise, type importInputsSchema, type payrollInputSchema } from "@/lib/validation/payroll";
import { authorizePayrollRead, periodLabel } from "./shared";

export type InputRow = typeof payrollInputs.$inferSelect;

const PAID_KINDS = new Set(["earning", "reimbursement"]);
const DEDUCTING_KINDS = new Set(["deduction", "statutory_deduction"]);

export function componentAcceptsKind(componentKind: string, kind: InputKind) {
  return DEDUCTION_INPUT_KINDS.includes(kind) ? DEDUCTING_KINDS.has(componentKind) : PAID_KINDS.has(componentKind);
}

/** Inputs can change only while the period is open and no run awaits approval. */
async function assertPeriodAcceptsInputs(tx: Tx, periodId: string) {
  const [period] = await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId)).for("share");
  if (!period) throw notFound("Payroll period");
  if (period.status === "locked" || period.status === "closed") {
    throw invalidState(`${periodLabel(period.year, period.month)} is locked. Add the amount to the next period or an adjustment run.`);
  }
  const [frozen] = await tx
    .select({ status: payrollRuns.status })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.periodId, periodId), eq(payrollRuns.kind, "regular"), inArray(payrollRuns.status, ["pending_approval", "approved"])));
  if (frozen) throw invalidState("The regular run for this period is awaiting approval or approved. Withdraw it before changing inputs.");
  return period;
}

export type InputListRow = InputRow & { employeeName: string; employeeCode: string; componentName: string | null };

export async function listInputs(ctx: RequestContext, periodId: string): Promise<InputListRow[]> {
  authorizePayrollRead(ctx);
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ i: payrollInputs, name: employees.displayName, code: employees.employeeCode, componentName: payComponents.name })
      .from(payrollInputs)
      .innerJoin(employees, eq(employees.id, payrollInputs.employeeId))
      .leftJoin(payComponents, eq(payComponents.code, payrollInputs.componentCode))
      .where(eq(payrollInputs.periodId, periodId))
      .orderBy(asc(employees.displayName), asc(payrollInputs.createdAt));
    return rows.map((r) => ({ ...r.i, employeeName: r.name, employeeCode: r.code, componentName: r.componentName }));
  });
}

/** Inputs across open periods (configuration "Inputs" tab). */
export async function listOpenPeriodInputs(ctx: RequestContext) {
  authorizePayrollRead(ctx);
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ i: payrollInputs, name: employees.displayName, code: employees.employeeCode, year: payrollPeriods.year, month: payrollPeriods.month })
      .from(payrollInputs)
      .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollInputs.periodId))
      .innerJoin(employees, eq(employees.id, payrollInputs.employeeId))
      .where(ne(payrollPeriods.status, "locked"))
      .orderBy(desc(payrollInputs.createdAt))
      .limit(200);
    return rows.map((r) => ({ ...r.i, employeeName: r.name, employeeCode: r.code, periodLabel: periodLabel(r.year, r.month) }));
  });
}

type NewInput = {
  periodId: string;
  employeeId: string;
  kind: InputKind;
  componentCode: string;
  amount: number;
  isTaxable: boolean;
  note: string | null;
  sourceType: string;
  sourceId: string | null;
  createdBy: string | null;
};

async function validateInputRefs(tx: Tx, period: typeof payrollPeriods.$inferSelect, input: Pick<NewInput, "employeeId" | "componentCode" | "kind" | "amount">) {
  const errors: Record<string, string[]> = {};
  const [emp] = await tx
    .select({ id: employees.id, legalEntityId: employees.legalEntityId })
    .from(employees)
    .where(and(eq(employees.id, input.employeeId), isNull(employees.deletedAt)));
  if (!emp) errors.employeeId = ["Employee not found"];
  else if (emp.legalEntityId !== period.legalEntityId) errors.employeeId = ["The employee belongs to a different legal entity"];
  const [comp] = await tx.select().from(payComponents).where(and(eq(payComponents.code, input.componentCode), eq(payComponents.isActive, true)));
  if (!comp) errors.componentCode = ["Unknown or inactive component"];
  else if (comp.calculation === "statutory") errors.componentCode = ["Statutory components are calculated, not entered"];
  else if (!componentAcceptsKind(comp.kind, input.kind)) errors.componentCode = [`A ${input.kind.replace(/_/g, " ")} cannot be posted to ${comp.code} (${comp.kind.replace(/_/g, " ")})`];
  if (!Number.isInteger(input.amount) || input.amount <= 0) errors.amount = ["Enter an amount above zero"];
  return errors;
}

export async function createInput(ctx: RequestContext, input: z.output<typeof payrollInputSchema>) {
  authorize(ctx, "payroll.run", "all");
  return ctx.db(async (tx) => {
    const period = await assertPeriodAcceptsInputs(tx, input.periodId);
    const amount = toPaise(input.amount);
    const errors = await validateInputRefs(tx, period, { ...input, amount });
    if (Object.keys(errors).length) throw new AppError("VALIDATION", "Please correct the highlighted fields.", { fieldErrors: errors });
    const [row] = await tx
      .insert(payrollInputs)
      .values({
        tenantId: ctx.tenantId,
        periodId: input.periodId,
        employeeId: input.employeeId,
        kind: input.kind,
        componentCode: input.componentCode,
        amount,
        isTaxable: input.isTaxable,
        note: input.note,
        sourceType: "manual",
        createdBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, { action: "payroll.input_created", entityType: "payroll_input", entityId: row.id, metadata: { periodId: row.periodId, employeeId: row.employeeId, kind: row.kind, componentCode: row.componentCode } });
    return row;
  });
}

export async function deleteInput(ctx: RequestContext, id: string) {
  authorize(ctx, "payroll.run", "all");
  return ctx.db(async (tx) => {
    const [row] = await tx.select().from(payrollInputs).where(eq(payrollInputs.id, id)).for("update");
    if (!row) throw notFound("Payroll input");
    await assertPeriodAcceptsInputs(tx, row.periodId);
    if (row.sourceType !== "manual" && row.sourceType !== "csv_import") {
      throw invalidState(`This input was posted by ${row.sourceType.replace(/_/g, " ")}. Reverse it in that module instead.`);
    }
    await tx.delete(payrollInputs).where(eq(payrollInputs.id, id));
    await audit(tx, ctx, { action: "payroll.input_deleted", entityType: "payroll_input", entityId: id, metadata: { periodId: row.periodId, employeeId: row.employeeId, kind: row.kind, componentCode: row.componentCode } });
    return { id };
  });
}

/* ------------------------------------------------------------------ */
/* CSV import                                                          */
/* ------------------------------------------------------------------ */

export const INPUT_CSV_HEADERS = ["employee_code", "kind", "component_code", "amount", "taxable", "note", "reference"] as const;

export type ImportRowResult = { line: number; employeeCode: string; componentCode: string; amount: number | null; errors: string[]; duplicate?: boolean };

/**
 * Validate (and optionally commit) a CSV of one-off inputs. Each row's
 * idempotency key is `csv:<period>:<employee>:<component>:<reference or row hash>`,
 * so importing the same file twice never double-posts.
 */
export async function importInputsCsv(ctx: RequestContext, input: z.output<typeof importInputsSchema>) {
  authorize(ctx, "payroll.run", "all");
  const rows = parseCsv(input.csv);
  if (!rows.length) throw new AppError("VALIDATION", "The file is empty.");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missing = ["employee_code", "kind", "component_code", "amount"].filter((h) => !header.includes(h));
  if (missing.length) throw new AppError("VALIDATION", `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Expected: ${INPUT_CSV_HEADERS.join(", ")}.`);
  if (rows.length > 5001) throw new AppError("VALIDATION", "Import at most 5,000 rows at a time.");
  const col = (r: string[], name: string) => (header.indexOf(name) >= 0 ? (r[header.indexOf(name)] ?? "").trim() : "");

  return ctx.db(async (tx) => {
    const period = await assertPeriodAcceptsInputs(tx, input.periodId);
    const emps = await tx
      .select({ id: employees.id, code: employees.employeeCode, legalEntityId: employees.legalEntityId })
      .from(employees)
      .where(isNull(employees.deletedAt));
    const byCode = new Map(emps.map((e) => [e.code.toUpperCase(), e]));
    const comps = new Map((await tx.select().from(payComponents).where(eq(payComponents.isActive, true))).map((c) => [c.code, c]));
    const results: ImportRowResult[] = [];
    const prepared: (NewInput & { line: number })[] = [];
    const seenKeys = new Set<string>();
    rows.slice(1).forEach((r, idx) => {
      const line = idx + 2;
      const errors: string[] = [];
      const employeeCode = col(r, "employee_code").toUpperCase();
      const componentCode = col(r, "component_code").toUpperCase();
      const kind = col(r, "kind").toLowerCase() as InputKind;
      const amountText = col(r, "amount").replace(/,/g, "");
      const taxableText = col(r, "taxable").toLowerCase();
      const emp = byCode.get(employeeCode);
      if (!emp) errors.push(`Unknown employee code ${employeeCode || "(blank)"}`);
      else if (emp.legalEntityId !== period.legalEntityId) errors.push("Employee belongs to a different legal entity");
      if (!(INPUT_KINDS as readonly string[]).includes(kind)) errors.push(`Unknown kind "${kind}"`);
      const comp = comps.get(componentCode);
      if (!comp) errors.push(`Unknown component ${componentCode || "(blank)"}`);
      else if (comp.calculation === "statutory") errors.push(`${componentCode} is calculated by payroll`);
      else if ((INPUT_KINDS as readonly string[]).includes(kind) && !componentAcceptsKind(comp.kind, kind)) errors.push(`A ${kind} cannot be posted to ${componentCode}`);
      const amountNum = Number(amountText);
      const amount = /^\d+(\.\d{1,2})?$/.test(amountText) ? toPaise(amountNum) : null;
      if (amount == null || amount <= 0) errors.push("Amount must be a positive number with at most two decimals");
      if (taxableText && !["yes", "no", "true", "false", "y", "n", "1", "0"].includes(taxableText)) errors.push('Taxable must be "yes" or "no"');
      const reference = col(r, "reference") || sha256(r.join("\u001f")).slice(0, 16);
      const sourceId = `csv:${input.periodId}:${employeeCode}:${componentCode}:${reference}`;
      if (seenKeys.has(sourceId)) errors.push("Duplicate row in this file");
      seenKeys.add(sourceId);
      results.push({ line, employeeCode, componentCode, amount, errors });
      if (!errors.length && emp && comp && amount) {
        prepared.push({
          line,
          periodId: input.periodId,
          employeeId: emp.id,
          kind,
          componentCode,
          amount,
          isTaxable: taxableText ? ["yes", "true", "y", "1"].includes(taxableText) : comp.isTaxable,
          note: col(r, "note").slice(0, 300) || null,
          sourceType: "csv_import",
          sourceId,
          createdBy: ctx.userId,
        });
      }
    });
    const invalid = results.filter((r) => r.errors.length).length;
    if (!input.commit || invalid) return { committed: false, created: 0, duplicates: 0, invalid, rows: results };
    let created = 0;
    for (const p of prepared) {
      const { line, ...values } = p;
      const ins = await tx.insert(payrollInputs).values({ tenantId: ctx.tenantId, ...values }).onConflictDoNothing().returning({ id: payrollInputs.id });
      if (ins.length) created++;
      else results.find((r) => r.line === line)!.duplicate = true;
    }
    await audit(tx, ctx, { action: "payroll.inputs_imported", entityType: "payroll_period", entityId: input.periodId, metadata: { created, duplicates: prepared.length - created } });
    return { committed: true, created, duplicates: prepared.length - created, invalid: 0, rows: results };
  });
}

/* ------------------------------------------------------------------ */
/* Contract for other modules                                          */
/* ------------------------------------------------------------------ */

export type ExternalPayrollInput = {
  employeeId: string;
  kind: InputKind;
  componentCode: string;
  /** Positive paise. */
  amount: number;
  isTaxable: boolean;
  note?: string | null;
  /** e.g. "expense_claim", "referral_reward", "leave_encashment". */
  sourceType: string;
  /** Stable id of the source record; (sourceType, sourceId) is unique per tenant. */
  sourceId: string;
  /** Date the amount became payable; picks the first open period whose input cutoff is on or after it. */
  effectiveOn: string;
};

/**
 * Post a one-off amount from another module (expenses, referrals, leave).
 * Idempotent on (sourceType, sourceId). Must run in a transaction that may
 * write payroll inputs: a system job (`withSystem(fn, tenantId)`) or a user
 * holding payroll.run. Returns `no_open_period` when no period can take it
 * yet; callers should retry later (e.g. let the job fail and back off).
 */
export async function postPayrollInput(tx: Tx, tenantId: string, input: ExternalPayrollInput) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error("postPayrollInput: amount must be positive paise");
  if (!input.sourceType || input.sourceType === "manual" || input.sourceType === "csv_import") throw new Error("postPayrollInput: use a module-specific sourceType");
  const [existing] = await tx
    .select({ id: payrollInputs.id, periodId: payrollInputs.periodId })
    .from(payrollInputs)
    .where(and(eq(payrollInputs.tenantId, tenantId), eq(payrollInputs.sourceType, input.sourceType), eq(payrollInputs.sourceId, input.sourceId)));
  if (existing) return { status: "duplicate" as const, id: existing.id, periodId: existing.periodId };
  const [emp] = await tx
    .select({ legalEntityId: employees.legalEntityId })
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), eq(employees.id, input.employeeId)));
  if (!emp) throw new Error("postPayrollInput: employee not found");
  const [comp] = await tx
    .select()
    .from(payComponents)
    .where(and(eq(payComponents.tenantId, tenantId), eq(payComponents.code, input.componentCode), eq(payComponents.isActive, true)));
  if (!comp || !componentAcceptsKind(comp.kind, input.kind)) throw new Error(`postPayrollInput: component ${input.componentCode} cannot take a ${input.kind}`);
  const periods = await tx
    .select()
    .from(payrollPeriods)
    .where(and(eq(payrollPeriods.tenantId, tenantId), eq(payrollPeriods.legalEntityId, emp.legalEntityId), eq(payrollPeriods.status, "open")))
    .orderBy(asc(payrollPeriods.year), asc(payrollPeriods.month));
  const runs = periods.length
    ? await tx
        .select({ periodId: payrollRuns.periodId })
        .from(payrollRuns)
        .where(and(inArray(payrollRuns.periodId, periods.map((p) => p.id)), eq(payrollRuns.kind, "regular"), inArray(payrollRuns.status, ["pending_approval", "approved"])))
    : [];
  const frozen = new Set(runs.map((r) => r.periodId));
  const period = periods.find((p) => p.inputCutoffDate >= input.effectiveOn && !frozen.has(p.id));
  if (!period) return { status: "no_open_period" as const, id: null, periodId: null };
  const [row] = await tx
    .insert(payrollInputs)
    .values({
      tenantId,
      periodId: period.id,
      employeeId: input.employeeId,
      kind: input.kind,
      componentCode: input.componentCode,
      amount: input.amount,
      isTaxable: input.isTaxable,
      note: input.note ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    })
    .onConflictDoNothing()
    .returning({ id: payrollInputs.id });
  if (!row) return { status: "duplicate" as const, id: null, periodId: null };
  return { status: "created" as const, id: row.id, periodId: period.id };
}
