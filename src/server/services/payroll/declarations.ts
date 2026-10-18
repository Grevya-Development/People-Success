import "server-only";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import type { RequestContext } from "../../auth/context";
import { authorize } from "../../auth/context";
import { employees, taxDeclarations } from "../../db/schema";
import { audit } from "../../lib/audit";
import { AppError, invalidState, notFound } from "../../lib/errors";
import { fyStartYearOf } from "@/lib/payroll/dates";
import { todayIn } from "@/lib/format";
import { toPaise, type taxDeclarationSchema } from "@/lib/validation/payroll";

export const currentFyStartYear = () => {
  const [y, m] = todayIn().split("-").map(Number);
  return fyStartYearOf(y, m);
};

export type DeclarationView = {
  id: string | null;
  fyStartYear: number;
  regime: "new" | "old";
  status: string;
  /** Rupees for the form. */
  declarations: Record<string, number>;
  metroCity: boolean;
  previousEmployerIncome: number;
  previousEmployerTds: number;
  editable: boolean;
};

/** The signed-in employee's declaration for the current financial year (or a blank draft). */
export async function getMyDeclaration(ctx: RequestContext): Promise<DeclarationView | null> {
  if (!ctx.employeeId) return null;
  const fy = currentFyStartYear();
  return ctx.db(async (tx) => {
    const [row] = await tx.select().from(taxDeclarations).where(and(eq(taxDeclarations.employeeId, ctx.employeeId!), eq(taxDeclarations.fyStartYear, fy)));
    if (!row) return { id: null, fyStartYear: fy, regime: "new", status: "draft", declarations: {}, metroCity: false, previousEmployerIncome: 0, previousEmployerTds: 0, editable: true };
    const { metro, ...rest } = row.declarations;
    return {
      id: row.id,
      fyStartYear: row.fyStartYear,
      regime: row.regime === "old" ? "old" : "new",
      status: row.status,
      declarations: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v / 100])),
      metroCity: (metro ?? 0) > 0,
      previousEmployerIncome: (row.previousEmployerIncome ?? 0) / 100,
      previousEmployerTds: (row.previousEmployerTds ?? 0) / 100,
      editable: row.status === "draft",
    };
  });
}

/**
 * Employees edit their own declaration while it is a draft, for the current
 * financial year only. Submitting makes it count in TDS projections; payroll
 * can return it to draft or verify it.
 */
export async function saveMyDeclaration(ctx: RequestContext, input: z.output<typeof taxDeclarationSchema>) {
  if (!ctx.employeeId) throw invalidState("Your login is not linked to an employee record.");
  const fy = currentFyStartYear();
  if (input.fyStartYear !== fy) throw new AppError("VALIDATION", "You can only edit the declaration for the current financial year.");
  const declarations: Record<string, number> = {};
  for (const [k, v] of Object.entries(input.declarations)) if (v > 0) declarations[k] = toPaise(v);
  if (input.metroCity) declarations.metro = 1;
  const employeeId = ctx.employeeId;
  return ctx.db(async (tx) => {
    const [emp] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId));
    if (!emp) throw notFound("Employee");
    const [existing] = await tx.select().from(taxDeclarations).where(and(eq(taxDeclarations.employeeId, employeeId), eq(taxDeclarations.fyStartYear, fy))).for("update");
    if (existing && existing.status !== "draft") throw invalidState("Your declaration was submitted. Ask payroll to return it if you need to change it.");
    const values = {
      regime: input.regime,
      declarations,
      previousEmployerIncome: toPaise(input.previousEmployerIncome),
      previousEmployerTds: toPaise(input.previousEmployerTds),
      status: input.submit ? "submitted" : "draft",
    };
    const [row] = existing
      ? await tx.update(taxDeclarations).set(values).where(eq(taxDeclarations.id, existing.id)).returning()
      : await tx.insert(taxDeclarations).values({ tenantId: ctx.tenantId, employeeId, fyStartYear: fy, ...values }).returning();
    await audit(tx, ctx, { action: input.submit ? "payroll.declaration_submitted" : "payroll.declaration_saved", entityType: "tax_declaration", entityId: row.id, metadata: { fyStartYear: fy, regime: input.regime, keys: Object.keys(declarations) } });
    return { id: row.id, status: row.status };
  });
}

/** Payroll verifies a submitted declaration, or returns it to the employee as a draft. */
export async function reviewDeclaration(ctx: RequestContext, id: string, decision: "verify" | "return") {
  authorize(ctx, "payroll.run", "all");
  return ctx.db(async (tx) => {
    const [row] = await tx.select().from(taxDeclarations).where(eq(taxDeclarations.id, id)).for("update");
    if (!row) throw notFound("Tax declaration");
    if (row.status !== "submitted") throw invalidState("Only submitted declarations can be reviewed.");
    await tx
      .update(taxDeclarations)
      .set(decision === "verify" ? { status: "verified", verifiedBy: ctx.userId } : { status: "draft" })
      .where(eq(taxDeclarations.id, id));
    await audit(tx, ctx, { action: decision === "verify" ? "payroll.declaration_verified" : "payroll.declaration_returned", entityType: "tax_declaration", entityId: id });
    return { id };
  });
}

/** Submitted and verified declarations for a financial year (payroll review list). */
export async function listDeclarations(ctx: RequestContext, fyStartYear = currentFyStartYear()) {
  authorize(ctx, "payroll.view", "all");
  return ctx.db(async (tx) =>
    tx
      .select({ d: taxDeclarations, name: employees.displayName, code: employees.employeeCode })
      .from(taxDeclarations)
      .innerJoin(employees, eq(employees.id, taxDeclarations.employeeId))
      .where(eq(taxDeclarations.fyStartYear, fyStartYear))
      .orderBy(employees.displayName)
      .limit(500),
  );
}
