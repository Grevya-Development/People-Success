import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { can, type RequestContext } from "../../auth/context";
import type { Tx } from "../../db/client";
import { benefitEnrollments, benefitPlans, dependents, employees, grades, legalEntities, locations } from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { forbidden, invalidState, notFound, validation } from "../../lib/errors";
import { todayIn } from "@/lib/format";
import { toPaise, type BenefitPlanInput, type CoverageOption, type EnrollInput } from "@/lib/validation/expenses";

export const canManageBenefits = (ctx: Pick<RequestContext, "grants">) => can(ctx, "benefits.manage", "all");

type PlanRow = typeof benefitPlans.$inferSelect;
type Eligibility = PlanRow["eligibility"];

/** Eligibility keys match employee attributes; an empty list means "everyone". */
const ELIGIBILITY_KEYS = {
  employmentType: "eligibleEmploymentTypes",
  locationId: "eligibleLocationIds",
  legalEntityId: "eligibleLegalEntityIds",
  gradeId: "eligibleGradeIds",
} as const;

function eligibilityFrom(input: BenefitPlanInput): Eligibility {
  const out: Eligibility = {};
  for (const [key, field] of Object.entries(ELIGIBILITY_KEYS)) {
    const values = input[field] as string[];
    if (values.length) out[key] = values;
  }
  return out;
}

export type EmployeeFacts = { employmentType: string; locationId: string | null; legalEntityId: string; gradeId: string | null };

export function isEligible(eligibility: Eligibility, emp: EmployeeFacts) {
  return Object.entries(eligibility).every(([key, allowed]) => {
    const list = Array.isArray(allowed) ? allowed : [allowed];
    if (!list.length) return true;
    const actual = emp[key as keyof EmployeeFacts];
    return actual != null && list.includes(actual);
  });
}

export function windowState(plan: Pick<PlanRow, "enrollmentOpensOn" | "enrollmentClosesOn">, today = todayIn()) {
  if (plan.enrollmentOpensOn && today < plan.enrollmentOpensOn) return "not_open" as const;
  if (plan.enrollmentClosesOn && today > plan.enrollmentClosesOn) return "closed" as const;
  return "open" as const;
}

function planValues(input: BenefitPlanInput) {
  return {
    name: input.name,
    kind: input.kind,
    description: input.description,
    provider: input.provider,
    eligibility: eligibilityFrom(input),
    employerContribution: toPaise(input.employerContribution),
    employeeContribution: toPaise(input.employeeContribution),
    deductFromSalary: input.deductFromSalary,
    coverageOptions: [...new Set(input.coverageOptions)],
    enrollmentOpensOn: input.enrollmentOpensOn,
    enrollmentClosesOn: input.enrollmentClosesOn,
    isActive: input.isActive,
  };
}

/* ------------------------------------------------------------------ */
/* HR: plans                                                           */
/* ------------------------------------------------------------------ */

export async function createBenefitPlan(ctx: RequestContext, input: BenefitPlanInput) {
  if (!canManageBenefits(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const values = planValues(input);
    const [plan] = await tx.insert(benefitPlans).values({ tenantId: ctx.tenantId, ...values }).returning({ id: benefitPlans.id });
    await audit(tx, ctx, { action: "benefit_plan.created", entityType: "benefit_plan", entityId: plan.id, changes: diff(null, values) });
    return plan;
  });
}

export async function updateBenefitPlan(ctx: RequestContext, input: BenefitPlanInput & { id: string }) {
  if (!canManageBenefits(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const [before] = await tx.select().from(benefitPlans).where(eq(benefitPlans.id, input.id)).for("update");
    if (!before) throw notFound("Benefit plan");
    const values = planValues(input);
    const [after] = await tx.update(benefitPlans).set(values).where(eq(benefitPlans.id, input.id)).returning();
    await audit(tx, ctx, { action: "benefit_plan.updated", entityType: "benefit_plan", entityId: input.id, changes: diff(before, after) });
    return { id: input.id };
  });
}

export type PlanSummary = PlanRow & {
  enrolled: number;
  waived: number;
  /** Employer cost per month for current enrollments, in paise. */
  monthlyEmployerCost: number;
  monthlyEmployeeDeductions: number;
};

export async function listBenefitPlans(ctx: RequestContext): Promise<PlanSummary[]> {
  if (!canManageBenefits(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        plan: benefitPlans,
        enrolled: sql<number>`count(${benefitEnrollments.id}) filter (where ${benefitEnrollments.status} = 'enrolled')::int`,
        waived: sql<number>`count(${benefitEnrollments.id}) filter (where ${benefitEnrollments.status} = 'waived')::int`,
      })
      .from(benefitPlans)
      .leftJoin(benefitEnrollments, and(eq(benefitEnrollments.planId, benefitPlans.id), isNull(benefitEnrollments.effectiveTo)))
      .groupBy(benefitPlans.id)
      .orderBy(asc(benefitPlans.name));
    return rows.map(({ plan, enrolled, waived }) => ({
      ...plan,
      enrolled: Number(enrolled),
      waived: Number(waived),
      monthlyEmployerCost: Number(enrolled) * plan.employerContribution,
      monthlyEmployeeDeductions: plan.deductFromSalary ? Number(enrolled) * plan.employeeContribution : 0,
    }));
  });
}

export async function getBenefitPlan(ctx: RequestContext, id: string) {
  if (!canManageBenefits(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const [plan] = await tx.select().from(benefitPlans).where(eq(benefitPlans.id, id));
    if (!plan) throw notFound("Benefit plan");
    const enrollments = await tx
      .select({
        id: benefitEnrollments.id,
        status: benefitEnrollments.status,
        coverage: benefitEnrollments.coverage,
        dependents: sql<number>`cardinality(${benefitEnrollments.dependentIds})`,
        effectiveFrom: benefitEnrollments.effectiveFrom,
        employeeId: employees.id,
        name: employees.displayName,
        code: employees.employeeCode,
      })
      .from(benefitEnrollments)
      .innerJoin(employees, eq(employees.id, benefitEnrollments.employeeId))
      .where(and(eq(benefitEnrollments.planId, id), isNull(benefitEnrollments.effectiveTo)))
      .orderBy(asc(employees.displayName))
      .limit(2000);
    return { plan, enrollments: enrollments.map((e) => ({ ...e, dependents: Number(e.dependents) })) };
  });
}

/** Options for the eligibility pickers. */
export async function eligibilityOptions(ctx: RequestContext) {
  if (!canManageBenefits(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const [loc, le, gr] = await Promise.all([
      tx.select({ value: locations.id, label: locations.name }).from(locations).orderBy(asc(locations.name)),
      tx.select({ value: legalEntities.id, label: legalEntities.name }).from(legalEntities).orderBy(asc(legalEntities.name)),
      tx.select({ value: grades.id, label: grades.name }).from(grades).orderBy(asc(grades.name)),
    ]);
    return { locations: loc, legalEntities: le, grades: gr };
  });
}

/* ------------------------------------------------------------------ */
/* Employees: enrollment                                               */
/* ------------------------------------------------------------------ */

async function myFacts(tx: Tx, employeeId: string): Promise<EmployeeFacts> {
  const [emp] = await tx
    .select({ employmentType: employees.employmentType, locationId: employees.locationId, legalEntityId: employees.legalEntityId, gradeId: employees.gradeId })
    .from(employees)
    .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)));
  if (!emp) throw notFound("Employee");
  return emp;
}

export type MyBenefitPlan = {
  id: string;
  name: string;
  kind: string;
  description: string | null;
  provider: string | null;
  employerContribution: number;
  employeeContribution: number;
  deductFromSalary: boolean;
  coverageOptions: CoverageOption[];
  window: "open" | "not_open" | "closed";
  enrollmentOpensOn: string | null;
  enrollmentClosesOn: string | null;
  current: { id: string; status: "enrolled" | "waived" | "ended"; coverage: string; dependentIds: string[]; effectiveFrom: string } | null;
};

export async function myBenefits(ctx: RequestContext) {
  const employeeId = ctx.employeeId;
  if (!employeeId) return { plans: [] as MyBenefitPlan[], dependents: [] as { id: string; name: string; relationship: string }[] };
  return ctx.db(async (tx) => {
    const facts = await myFacts(tx, employeeId);
    const [plans, current, deps] = await Promise.all([
      tx.select().from(benefitPlans).where(eq(benefitPlans.isActive, true)).orderBy(asc(benefitPlans.name)),
      tx
        .select()
        .from(benefitEnrollments)
        .where(and(eq(benefitEnrollments.employeeId, employeeId), isNull(benefitEnrollments.effectiveTo))),
      tx
        .select({ id: dependents.id, name: dependents.name, relationship: dependents.relationship })
        .from(dependents)
        .where(eq(dependents.employeeId, employeeId))
        .orderBy(asc(dependents.name)),
    ]);
    const byPlan = new Map(current.map((e) => [e.planId, e]));
    const today = todayIn();
    return {
      dependents: deps,
      plans: plans
        .filter((p) => isEligible(p.eligibility, facts) || byPlan.has(p.id))
        .map<MyBenefitPlan>((p) => {
          const e = byPlan.get(p.id);
          return {
            id: p.id,
            name: p.name,
            kind: p.kind,
            description: p.description,
            provider: p.provider,
            employerContribution: p.employerContribution,
            employeeContribution: p.employeeContribution,
            deductFromSalary: p.deductFromSalary,
            coverageOptions: p.coverageOptions as CoverageOption[],
            window: windowState(p, today),
            enrollmentOpensOn: p.enrollmentOpensOn,
            enrollmentClosesOn: p.enrollmentClosesOn,
            current: e ? { id: e.id, status: e.status, coverage: e.coverage, dependentIds: e.dependentIds, effectiveFrom: e.effectiveFrom } : null,
          };
        }),
    };
  });
}

/**
 * Record a choice (enrol or waive) effective today. Choices are
 * effective-dated with [from, to) ranges: a change closes the open record at
 * today and starts a new one today. A second change on the same day corrects
 * that day's record instead of creating an empty range.
 */
async function recordChoice(
  ctx: RequestContext,
  planId: string,
  choice: { status: "enrolled" | "waived"; coverage: string; dependentIds: string[] },
) {
  const employeeId = ctx.employeeId;
  if (!employeeId) throw forbidden("Only employees can enrol in benefits.");
  return ctx.db(async (tx) => {
    const [plan] = await tx.select().from(benefitPlans).where(eq(benefitPlans.id, planId));
    if (!plan || !plan.isActive) throw notFound("Benefit plan");
    const facts = await myFacts(tx, employeeId);
    if (!isEligible(plan.eligibility, facts)) throw forbidden("You are not eligible for this plan.");
    const today = todayIn();
    const w = windowState(plan, today);
    if (w !== "open") {
      throw invalidState(w === "not_open" ? "Enrollment for this plan has not opened yet." : "The enrollment window for this plan has closed.");
    }
    if (choice.status === "enrolled") {
      if (!plan.coverageOptions.includes(choice.coverage)) throw validation("Choose one of the plan's coverage options.", { coverage: ["Not offered by this plan"] });
      if (choice.coverage === "self" && choice.dependentIds.length) {
        throw validation("Self-only coverage cannot include dependents.", { dependentIds: ["Remove dependents or choose a wider coverage"] });
      }
      if (choice.dependentIds.length) {
        const mine = await tx
          .select({ id: dependents.id })
          .from(dependents)
          .where(and(eq(dependents.employeeId, employeeId), inArray(dependents.id, choice.dependentIds)));
        if (mine.length !== new Set(choice.dependentIds).size) throw validation("Choose dependents from your profile.", { dependentIds: ["Unknown dependent"] });
      }
    }

    const [open] = await tx
      .select()
      .from(benefitEnrollments)
      .where(and(eq(benefitEnrollments.planId, planId), eq(benefitEnrollments.employeeId, employeeId), isNull(benefitEnrollments.effectiveTo)))
      .for("update");
    const next = { status: choice.status, coverage: choice.coverage, dependentIds: [...new Set(choice.dependentIds)] };
    if (open && open.status === next.status && open.coverage === next.coverage && [...open.dependentIds].sort().join() === [...next.dependentIds].sort().join()) {
      return { id: open.id, changed: false };
    }

    let id: string;
    if (open && open.effectiveFrom >= today) {
      // Same-day correction: replace today's choice rather than create an empty range.
      await tx.update(benefitEnrollments).set(next).where(eq(benefitEnrollments.id, open.id));
      id = open.id;
    } else {
      if (open) await tx.update(benefitEnrollments).set({ effectiveTo: today }).where(eq(benefitEnrollments.id, open.id));
      const [row] = await tx
        .insert(benefitEnrollments)
        .values({ tenantId: ctx.tenantId, planId, employeeId, ...next, effectiveFrom: today })
        .returning({ id: benefitEnrollments.id });
      id = row.id;
    }
    await audit(tx, ctx, {
      action: choice.status === "enrolled" ? (open ? "benefit_enrollment.changed" : "benefit_enrollment.enrolled") : "benefit_enrollment.waived",
      entityType: "benefit_enrollment",
      entityId: id,
      changes: diff(open ? { status: open.status, coverage: open.coverage, dependents: open.dependentIds.length } : null, {
        status: next.status,
        coverage: next.coverage,
        dependents: next.dependentIds.length,
      }),
      metadata: { planId, previousId: open?.id ?? null, effectiveFrom: today },
    });
    return { id, changed: true };
  });
}

export const enrollInBenefit = (ctx: RequestContext, input: EnrollInput) =>
  recordChoice(ctx, input.planId, { status: "enrolled", coverage: input.coverage, dependentIds: input.dependentIds });

export const waiveBenefit = (ctx: RequestContext, planId: string) => recordChoice(ctx, planId, { status: "waived", coverage: "self", dependentIds: [] });
