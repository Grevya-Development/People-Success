import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Tx } from "../../db/client";
import type { RequestContext } from "../../auth/context";
import { authorize, can } from "../../auth/context";
import { compensationRecords, employees, payComponents, payrollPeriods, payrollRunEmployees, payrollRuns, salaryStructures } from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { AppError, forbidden, invalidState, notFound } from "../../lib/errors";
import { emitDomainEvent } from "../events";
import { DEFAULT_COMPONENTS, DEFAULT_STRUCTURE } from "@/lib/payroll/defaults";
import { PayrollValidationError, resolveStructure, validateStructureLines } from "@/lib/payroll/structure";
import { addDays } from "@/lib/payroll/dates";
import type { ComponentDef, StructureLine } from "@/lib/payroll/types";
import type { PfParams } from "@/lib/payroll/params";
import { todayIn } from "@/lib/format";
import { toPaise, type assignStructureSchema, type componentSchema, type structurePreviewSchema, type structureSchema } from "@/lib/validation/payroll";
import { resolveRuleSets } from "./rules";
import { authorizePayrollRead } from "./shared";

export type ComponentRow = typeof payComponents.$inferSelect;
export type StructureRow = typeof salaryStructures.$inferSelect;

export const toComponentDef = (c: ComponentRow): ComponentDef => ({
  code: c.code,
  name: c.name,
  kind: c.kind,
  calculation: c.calculation,
  isTaxable: c.isTaxable,
  isPartOfCtc: c.isPartOfCtc,
  pfWage: c.pfWage,
  esiWage: c.esiWage,
  ptWage: c.ptWage,
  prorate: c.prorate,
  payslipLabel: c.payslipLabel,
  sortOrder: c.sortOrder,
});

export async function activeComponents(tx: Tx) {
  return tx.select().from(payComponents).where(eq(payComponents.isActive, true)).orderBy(asc(payComponents.sortOrder), asc(payComponents.code));
}

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

export async function listComponents(ctx: RequestContext) {
  authorizePayrollRead(ctx);
  return ctx.db((tx) => tx.select().from(payComponents).orderBy(asc(payComponents.sortOrder), asc(payComponents.code)));
}

/** Idempotent: inserts missing standard components (by code) and a default structure if none exists. */
export async function seedDefaultComponents(ctx: RequestContext) {
  authorize(ctx, "payroll.config", "all");
  return ctx.db(async (tx) => {
    const inserted = await tx
      .insert(payComponents)
      .values(DEFAULT_COMPONENTS.map((c) => ({ tenantId: ctx.tenantId, ...c, isActive: true })))
      .onConflictDoNothing()
      .returning({ code: payComponents.code });
    let structureCreated = false;
    const [anyStructure] = await tx.select({ id: salaryStructures.id }).from(salaryStructures).limit(1);
    if (!anyStructure) {
      await tx.insert(salaryStructures).values({ tenantId: ctx.tenantId, name: DEFAULT_STRUCTURE.name, description: DEFAULT_STRUCTURE.description, lines: DEFAULT_STRUCTURE.lines, isDefault: true });
      structureCreated = true;
    }
    await audit(tx, ctx, { action: "payroll.components_seeded", entityType: "pay_component", metadata: { created: inserted.map((i) => i.code), structureCreated } });
    return { created: inserted.length, skipped: DEFAULT_COMPONENTS.length - inserted.length, structureCreated };
  });
}

export async function saveComponent(ctx: RequestContext, input: z.output<typeof componentSchema>) {
  authorize(ctx, "payroll.config", "all");
  const value = input.value == null ? null : input.calculation === "fixed" ? toPaise(input.value) : input.value;
  return ctx.db(async (tx) => {
    const values = {
      name: input.name,
      kind: input.kind,
      calculation: input.calculation,
      value,
      isTaxable: input.isTaxable,
      isPartOfCtc: input.isPartOfCtc,
      pfWage: input.pfWage,
      esiWage: input.esiWage,
      ptWage: input.ptWage,
      prorate: input.prorate,
      payslipLabel: input.payslipLabel,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
    };
    if (input.id) {
      const [before] = await tx.select().from(payComponents).where(eq(payComponents.id, input.id)).for("update");
      if (!before) throw notFound("Component");
      if (before.code !== input.code) throw new AppError("VALIDATION", "Component codes cannot be changed.", { fieldErrors: { code: ["Codes are permanent"] } });
      if (before.isSystem && (before.kind !== input.kind || before.calculation !== input.calculation)) {
        throw invalidState("The type and calculation of built-in statutory components cannot be changed.");
      }
      if (!input.isActive && before.isActive) await assertComponentUnused(tx, before.code);
      const [after] = await tx.update(payComponents).set(values).where(eq(payComponents.id, input.id)).returning();
      await audit(tx, ctx, { action: "payroll.component_updated", entityType: "pay_component", entityId: after.id, changes: diff(before, after) });
      return after;
    }
    const [row] = await tx.insert(payComponents).values({ tenantId: ctx.tenantId, code: input.code, ...values }).returning();
    await audit(tx, ctx, { action: "payroll.component_created", entityType: "pay_component", entityId: row.id, metadata: { code: row.code } });
    return row;
  });
}

async function assertComponentUnused(tx: Tx, code: string) {
  const structures = await tx.select({ name: salaryStructures.name, lines: salaryStructures.lines }).from(salaryStructures).where(eq(salaryStructures.isActive, true));
  const using = structures.filter((s) => s.lines.some((l) => l.componentCode === code)).map((s) => s.name);
  if (using.length) throw invalidState(`${code} is used by active structures (${using.join(", ")}). Remove it from them first.`);
}

/* ------------------------------------------------------------------ */
/* Structures                                                          */
/* ------------------------------------------------------------------ */

export async function listStructures(ctx: RequestContext) {
  authorizePayrollRead(ctx);
  return ctx.db(async (tx) => {
    const rows = await tx.select().from(salaryStructures).orderBy(desc(salaryStructures.isDefault), asc(salaryStructures.name));
    const counts = await tx
      .select({ id: compensationRecords.salaryStructureId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(compensationRecords)
      .where(isNull(compensationRecords.effectiveTo))
      .groupBy(compensationRecords.salaryStructureId);
    const byId = new Map(counts.map((c) => [c.id, c.n]));
    return rows.map((r) => ({ ...r, assignedCount: byId.get(r.id) ?? 0 }));
  });
}

/** Form lines (rupees for fixed values) → stored lines (paise). */
const toStoredLines = (lines: z.output<typeof structureSchema>["lines"]): StructureLine[] =>
  lines.map((l) => ({
    componentCode: l.componentCode,
    calculation: l.calculation,
    value: l.calculation === "balancing" ? null : l.value == null ? null : l.calculation === "fixed" ? toPaise(l.value) : l.value,
  }));

export async function saveStructure(ctx: RequestContext, input: z.output<typeof structureSchema>) {
  authorize(ctx, "payroll.config", "all");
  const lines = toStoredLines(input.lines);
  return ctx.db(async (tx) => {
    const comps = await activeComponents(tx);
    const issues = validateStructureLines(lines, new Map(comps.map((c) => [c.code, toComponentDef(c)])));
    if (issues.length) throw new AppError("VALIDATION", issues.join(" "), { fieldErrors: { lines: issues } });
    if (input.isDefault) {
      await tx.update(salaryStructures).set({ isDefault: false }).where(input.id ? and(eq(salaryStructures.isDefault, true), ne(salaryStructures.id, input.id)) : eq(salaryStructures.isDefault, true));
    }
    if (input.id) {
      const [before] = await tx.select().from(salaryStructures).where(eq(salaryStructures.id, input.id)).for("update");
      if (!before) throw notFound("Salary structure");
      const linesChanged = JSON.stringify(before.lines) !== JSON.stringify(lines);
      const [after] = await tx
        .update(salaryStructures)
        .set({ name: input.name, description: input.description, isDefault: input.isDefault, isActive: input.isActive, lines, version: linesChanged ? before.version + 1 : before.version })
        .where(eq(salaryStructures.id, input.id))
        .returning();
      await audit(tx, ctx, { action: "payroll.structure_updated", entityType: "salary_structure", entityId: after.id, changes: diff(before, after) });
      return after;
    }
    const [row] = await tx.insert(salaryStructures).values({ tenantId: ctx.tenantId, name: input.name, description: input.description, isDefault: input.isDefault, isActive: input.isActive, lines }).returning();
    await audit(tx, ctx, { action: "payroll.structure_created", entityType: "salary_structure", entityId: row.id, metadata: { name: row.name } });
    return row;
  });
}

export type StructurePreview =
  | { ok: true; lines: { code: string; name: string; kind: string; monthly: number; annual: number; basis: string }[]; grossMonthly: number; employerPfMonthly: number; messages: string[] }
  | { ok: false; issues: string[] };

/** Breakdown for a sample CTC using the PF rule set effective today. */
export async function previewStructure(ctx: RequestContext, input: z.output<typeof structurePreviewSchema>): Promise<StructurePreview> {
  authorizePayrollRead(ctx);
  return ctx.db(async (tx) => {
    const comps = (await activeComponents(tx)).map(toComponentDef);
    const pf = (await resolveRuleSets(tx, todayIn(), [{ kind: "pf", jurisdiction: "IN" }])).get("pf|IN");
    try {
      const s = resolveStructure(toPaise(input.annualCtc), toStoredLines(input.lines), comps, {
        pf: (pf?.params as PfParams | null | undefined) ?? null,
        pfApplicable: true,
        pfWageBasis: "capped",
        epsEligible: true,
        ageYears: null,
      });
      return {
        ok: true,
        lines: s.lines.map((l) => ({ code: l.code, name: l.name, kind: l.component.kind, monthly: l.monthly, annual: l.annual, basis: l.basis })),
        grossMonthly: s.grossMonthly,
        employerPfMonthly: s.employerPfInCtcMonthly,
        messages: s.messages,
      };
    } catch (err) {
      if (err instanceof PayrollValidationError) return { ok: false, issues: err.issues };
      throw err;
    }
  });
}

/**
 * Assign a salary structure to an employee's current compensation.
 *
 * If no locked/disbursed/published run has used the open compensation record,
 * the record's structure is updated in place. Otherwise history is preserved:
 * the open record is closed and a new record with the same CTC starts on
 * `effectiveFrom`, which must be after the last posted payroll period.
 */
export async function assignStructure(ctx: RequestContext, input: z.output<typeof assignStructureSchema>) {
  authorize(ctx, "payroll.config", "all");
  if (!can(ctx, "compensation.edit", "all")) throw forbidden("Assigning salary structures also requires permission to change compensation.");
  return ctx.db(async (tx) => {
    const [structure] = await tx.select().from(salaryStructures).where(eq(salaryStructures.id, input.structureId));
    if (!structure) throw notFound("Salary structure");
    if (!structure.isActive) throw invalidState("This structure is inactive.");
    const [emp] = await tx.select({ id: employees.id, status: employees.status }).from(employees).where(and(eq(employees.id, input.employeeId), isNull(employees.deletedAt)));
    if (!emp) throw notFound("Employee");
    const [open] = await tx
      .select()
      .from(compensationRecords)
      .where(and(eq(compensationRecords.employeeId, input.employeeId), isNull(compensationRecords.effectiveTo)))
      .for("update");
    if (!open) throw invalidState("The employee has no current compensation record. Add compensation first.");
    if (open.salaryStructureId === input.structureId) return { mode: "unchanged" as const, recordId: open.id };

    const posted = await tx
      .select({ endDate: payrollPeriods.endDate, recordId: sql<string | null>`${payrollRunEmployees.snapshot} -> 'compensation' ->> 'recordId'` })
      .from(payrollRunEmployees)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunEmployees.runId))
      .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
      .where(and(eq(payrollRunEmployees.employeeId, input.employeeId), inArray(payrollRuns.status, ["locked", "disbursed", "published"])));
    const usedByPosted = posted.some((p) => p.recordId === open.id);

    if (!usedByPosted) {
      await tx.update(compensationRecords).set({ salaryStructureId: input.structureId }).where(eq(compensationRecords.id, open.id));
      await audit(tx, ctx, { action: "payroll.structure_assigned", entityType: "employee", entityId: input.employeeId, metadata: { recordId: open.id, structureId: input.structureId, mode: "updated_in_place" } });
      return { mode: "updated" as const, recordId: open.id };
    }
    const lastPostedEnd = posted.map((p) => p.endDate).sort().at(-1)!;
    const earliest = addDays(lastPostedEnd, 1);
    if (input.effectiveFrom < earliest || input.effectiveFrom <= open.effectiveFrom) {
      const min = earliest > open.effectiveFrom ? earliest : addDays(open.effectiveFrom, 1);
      throw new AppError("VALIDATION", `Payroll for this salary is already locked. Choose a date on or after ${min}.`, { fieldErrors: { effectiveFrom: [`On or after ${min}`] } });
    }
    await tx.update(compensationRecords).set({ effectiveTo: input.effectiveFrom }).where(eq(compensationRecords.id, open.id));
    const [record] = await tx
      .insert(compensationRecords)
      .values({
        tenantId: ctx.tenantId,
        employeeId: input.employeeId,
        effectiveFrom: input.effectiveFrom,
        annualCtc: open.annualCtc,
        currency: open.currency,
        salaryStructureId: input.structureId,
        components: open.components,
        reason: "correction",
        notes: `Salary structure changed to ${structure.name}`,
        createdBy: ctx.userId,
        approvedBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, { action: "payroll.structure_assigned", entityType: "employee", entityId: input.employeeId, metadata: { recordId: record.id, previousRecordId: open.id, structureId: input.structureId, effectiveFrom: input.effectiveFrom, mode: "new_record" } });
    await emitDomainEvent(tx, ctx.tenantId, "employee.compensation_changed", { employeeId: input.employeeId, effectiveFrom: input.effectiveFrom });
    return { mode: "new_record" as const, recordId: record.id };
  });
}
