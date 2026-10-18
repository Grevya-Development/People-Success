import "server-only";
import { and, desc, eq, ne } from "drizzle-orm";
import type { z } from "zod";
import type { RequestContext } from "../../auth/context";
import { authorize } from "../../auth/context";
import { legalEntities, payrollPeriods, payrollRuns } from "../../db/schema";
import { audit } from "../../lib/audit";
import { AppError, notFound } from "../../lib/errors";
import { emitDomainEvent } from "../events";
import { monthBounds } from "@/lib/payroll/dates";
import type { openPeriodSchema } from "@/lib/validation/payroll";
import { authorizePayrollRead, periodLabel } from "./shared";

export type PeriodSummary = {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  year: number;
  month: number;
  label: string;
  startDate: string;
  endDate: string;
  payDate: string;
  inputCutoffDate: string;
  status: string;
  regularRun: { id: string; status: string; totals: { employees: number; gross: number; net: number } | null; usesUnverifiedRules: boolean } | null;
  otherRuns: number;
};

export async function listPeriods(ctx: RequestContext): Promise<PeriodSummary[]> {
  authorizePayrollRead(ctx);
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ p: payrollPeriods, le: legalEntities.name })
      .from(payrollPeriods)
      .innerJoin(legalEntities, eq(legalEntities.id, payrollPeriods.legalEntityId))
      .orderBy(desc(payrollPeriods.year), desc(payrollPeriods.month), legalEntities.name)
      .limit(120);
    const runs = rows.length ? await tx.select().from(payrollRuns).where(ne(payrollRuns.status, "cancelled")) : [];
    return rows.map(({ p, le }) => {
      const mine = runs.filter((r) => r.periodId === p.id);
      const regular = mine.find((r) => r.kind === "regular") ?? null;
      return {
        id: p.id,
        legalEntityId: p.legalEntityId,
        legalEntityName: le,
        year: p.year,
        month: p.month,
        label: periodLabel(p.year, p.month),
        startDate: p.startDate,
        endDate: p.endDate,
        payDate: p.payDate,
        inputCutoffDate: p.inputCutoffDate,
        status: p.status,
        regularRun: regular
          ? {
              id: regular.id,
              status: regular.status,
              totals: regular.totals ? { employees: regular.totals.employees, gross: regular.totals.gross, net: regular.totals.net } : null,
              usesUnverifiedRules: regular.usesUnverifiedRules,
            }
          : null,
        otherRuns: mine.length - (regular ? 1 : 0),
      };
    });
  });
}

export async function getPeriod(ctx: RequestContext, periodId: string) {
  authorizePayrollRead(ctx);
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select({ p: payrollPeriods, le: legalEntities })
      .from(payrollPeriods)
      .innerJoin(legalEntities, eq(legalEntities.id, payrollPeriods.legalEntityId))
      .where(eq(payrollPeriods.id, periodId));
    if (!row) throw notFound("Payroll period");
    const runs = await tx.select().from(payrollRuns).where(eq(payrollRuns.periodId, periodId)).orderBy(desc(payrollRuns.createdAt));
    return { period: row.p, legalEntity: row.le, label: periodLabel(row.p.year, row.p.month), runs };
  });
}

export async function openPeriod(ctx: RequestContext, input: z.output<typeof openPeriodSchema>) {
  authorize(ctx, "payroll.run", "all");
  const { start, end } = monthBounds(input.year, input.month);
  if (input.payDate < start) {
    throw new AppError("VALIDATION", "The pay date cannot be before the period starts.", { fieldErrors: { payDate: [`On or after ${start}`] } });
  }
  return ctx.db(async (tx) => {
    const [le] = await tx.select({ id: legalEntities.id, isActive: legalEntities.isActive }).from(legalEntities).where(eq(legalEntities.id, input.legalEntityId));
    if (!le) throw notFound("Legal entity");
    if (!le.isActive) throw new AppError("VALIDATION", "This legal entity is inactive.");
    const [existing] = await tx
      .select({ id: payrollPeriods.id })
      .from(payrollPeriods)
      .where(and(eq(payrollPeriods.legalEntityId, input.legalEntityId), eq(payrollPeriods.year, input.year), eq(payrollPeriods.month, input.month)));
    if (existing) throw new AppError("CONFLICT", `${periodLabel(input.year, input.month)} is already open for this legal entity.`, { details: { periodId: existing.id } });
    const [row] = await tx
      .insert(payrollPeriods)
      .values({
        tenantId: ctx.tenantId,
        legalEntityId: input.legalEntityId,
        year: input.year,
        month: input.month,
        startDate: start,
        endDate: end,
        payDate: input.payDate,
        inputCutoffDate: input.inputCutoffDate,
      })
      .returning();
    await audit(tx, ctx, { action: "payroll.period_opened", entityType: "payroll_period", entityId: row.id, metadata: { year: row.year, month: row.month, legalEntityId: row.legalEntityId } });
    await emitDomainEvent(tx, ctx.tenantId, "payroll.period_opened", { periodId: row.id, legalEntityId: row.legalEntityId, year: row.year, month: row.month }, { dedupeKey: `payroll.period_opened:${row.id}` });
    return row;
  });
}
