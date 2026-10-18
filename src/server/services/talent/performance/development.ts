import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { can, canAccessEmployee, getTeamEmployeeIds, scopeOf, type RequestContext } from "../../../auth/context";
import { careerPlans, courses, designations, grades, improvementPlans, promotionRecommendations, reviewCycles, reviews } from "../../../db/schema";
import { audit, diff } from "../../../lib/audit";
import { forbidden, invalidState, notFound, validation } from "../../../lib/errors";
import { userIdsWithPermission } from "../../directory";
import { notify } from "../../notifications";
import { todayIn } from "@/lib/format";
import type { pipSchema, pipUpdateSchema, promotionDecisionSchema, promotionSchema } from "@/lib/validation/talent";
import { employeeBasics } from "../shared";
import { reviewKeys } from "./reviews";

/* ------------------------------------------------------------------ */
/* Development plan from a closed review (end of Flow E)               */
/* ------------------------------------------------------------------ */

/**
 * Turn the development areas agreed in a shared manager review into
 * career-plan actions. Lines matching an active course title become course
 * actions. Existing actions with the same title are left as they are.
 */
export async function updateDevelopmentPlanFromReview(ctx: RequestContext, reviewId: string) {
  return ctx.db(async (tx) => {
    const [r] = await tx.select().from(reviews).where(eq(reviews.id, reviewId));
    if (!r || r.kind !== "manager") throw notFound("Review");
    const isSubject = r.employeeId === ctx.employeeId;
    const allowed =
      can(ctx, "performance.manage", "all") ||
      r.reviewerEmployeeId === ctx.employeeId ||
      (isSubject && (r.status === "shared" || r.status === "acknowledged")) ||
      (!isSubject && (await canAccessEmployee(ctx, "performance.review", r.employeeId)));
    if (!allowed) throw forbidden();
    const [cycle] = await tx.select().from(reviewCycles).where(eq(reviewCycles.id, r.cycleId));
    if (cycle?.status !== "closed") throw invalidState("Development plans are updated after the cycle closes.");
    if (r.status !== "shared" && r.status !== "acknowledged") throw invalidState("The review has not been shared with the employee.");
    const areas = (r.responses[reviewKeys.DEVELOPMENT_KEY]?.text ?? "")
      .split(/\n|;/)
      .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
      .filter((l) => l.length >= 3)
      .slice(0, 20);
    if (!areas.length) throw invalidState("This review has no development areas recorded.");

    const courseRows = await tx
      .select({ title: courses.title })
      .from(courses)
      .where(and(eq(courses.isActive, true), inArray(sql`lower(${courses.title})`, areas.map((a) => a.toLowerCase()))));
    const courseTitles = new Set(courseRows.map((c) => c.title.toLowerCase()));

    const [existing] = await tx.select().from(careerPlans).where(eq(careerPlans.employeeId, r.employeeId));
    const actions = [...(existing?.actions ?? [])];
    let added = 0;
    for (const area of areas) {
      if (actions.some((a) => a.title.toLowerCase() === area.toLowerCase())) continue;
      actions.push({ title: area, kind: courseTitles.has(area.toLowerCase()) ? "course" : "other", done: false });
      added++;
    }
    const today = todayIn();
    if (existing) {
      await tx.update(careerPlans).set({ actions, reviewedOn: today }).where(eq(careerPlans.id, existing.id));
    } else {
      await tx.insert(careerPlans).values({ tenantId: ctx.tenantId, employeeId: r.employeeId, actions, reviewedOn: today });
    }
    await audit(tx, ctx, { action: "career_plan.updated_from_review", entityType: "career_plan", entityId: existing?.id ?? null, metadata: { reviewId, employeeId: r.employeeId, added } });
    return { added, total: actions.length };
  });
}

/* ------------------------------------------------------------------ */
/* Promotion recommendations                                           */
/* ------------------------------------------------------------------ */

/** Proposed CTC is visible only to compensation.view:all and performance.manage. */
const canSeeProposedCtc = (ctx: RequestContext) => can(ctx, "performance.manage", "all") || can(ctx, "compensation.view", "all");

export async function recommendPromotion(ctx: RequestContext, input: z.output<typeof promotionSchema>) {
  const isHr = can(ctx, "performance.manage", "all");
  if (!isHr && (input.employeeId === ctx.employeeId || !(await canAccessEmployee(ctx, "performance.review", input.employeeId)))) throw forbidden();
  return ctx.db(async (tx) => {
    const emp = (await employeeBasics(tx, [input.employeeId])).get(input.employeeId);
    if (!emp) throw notFound("Employee");
    if (input.cycleId) {
      const [c] = await tx.select({ id: reviewCycles.id }).from(reviewCycles).where(eq(reviewCycles.id, input.cycleId));
      if (!c) throw validation("Choose a valid cycle.", { cycleId: ["Not found"] });
    }
    if (input.toDesignationId) {
      const [d] = await tx.select({ id: designations.id }).from(designations).where(eq(designations.id, input.toDesignationId));
      if (!d) throw validation("Choose a valid designation.", { toDesignationId: ["Not found"] });
    }
    if (input.toGradeId) {
      const [g] = await tx.select({ id: grades.id }).from(grades).where(eq(grades.id, input.toGradeId));
      if (!g) throw validation("Choose a valid grade.", { toGradeId: ["Not found"] });
    }
    const paise = input.proposedAnnualCtc != null ? Math.round(input.proposedAnnualCtc * 100) : null;
    if (paise != null && paise <= 0) throw validation("Enter a positive amount.", { proposedAnnualCtc: ["Must be positive"] });
    const [row] = await tx
      .insert(promotionRecommendations)
      .values({
        tenantId: ctx.tenantId,
        cycleId: input.cycleId,
        employeeId: input.employeeId,
        recommendedBy: ctx.userId,
        toDesignationId: input.toDesignationId,
        toGradeId: input.toGradeId,
        proposedAnnualCtc: paise,
        justification: input.justification,
      })
      .returning({ id: promotionRecommendations.id });
    // Amounts never go to audit logs or notifications.
    await audit(tx, ctx, { action: "promotion.recommended", entityType: "promotion_recommendation", entityId: row.id, metadata: { employeeId: input.employeeId, cycleId: input.cycleId, hasProposedCtc: paise != null } });
    await notify(tx, {
      tenantId: ctx.tenantId,
      userIds: (await userIdsWithPermission(tx, ctx.tenantId, "performance.manage")).filter((u) => u !== ctx.userId),
      category: "performance",
      title: `Promotion recommended for ${emp.name}`,
      href: "/performance?tab=calibration",
      dedupeKey: `promotion:${row.id}`,
    });
    return row;
  });
}

export async function listPromotions(ctx: RequestContext, opts: { cycleId?: string } = {}) {
  const isHr = can(ctx, "performance.manage", "all");
  const team = isHr ? [] : await getTeamEmployeeIds(ctx);
  if (!isHr && !team.length && !can(ctx, "compensation.edit", "all")) return [];
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ p: promotionRecommendations, designation: designations.title, grade: grades.name })
      .from(promotionRecommendations)
      .leftJoin(designations, eq(designations.id, promotionRecommendations.toDesignationId))
      .leftJoin(grades, eq(grades.id, promotionRecommendations.toGradeId))
      .where(and(opts.cycleId ? eq(promotionRecommendations.cycleId, opts.cycleId) : undefined, isHr || can(ctx, "compensation.edit", "all") ? undefined : inArray(promotionRecommendations.employeeId, team)))
      .orderBy(desc(promotionRecommendations.createdAt))
      .limit(300);
    const people = await employeeBasics(tx, rows.map((r) => r.p.employeeId));
    const showCtc = canSeeProposedCtc(ctx);
    return rows.map(({ p, designation, grade }) => ({
      id: p.id,
      cycleId: p.cycleId,
      employeeId: p.employeeId,
      employeeName: people.get(p.employeeId)?.name ?? "Unknown",
      toDesignation: designation,
      toGrade: grade,
      proposedAnnualCtc: showCtc ? p.proposedAnnualCtc : null,
      hasProposedCtc: p.proposedAnnualCtc != null,
      justification: p.justification,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
    }));
  });
}

/** HR records a decision. This does not change the employee's job; HR does that in the employee record. */
export async function decidePromotion(ctx: RequestContext, input: z.output<typeof promotionDecisionSchema>) {
  if (!can(ctx, "performance.manage", "all")) throw forbidden();
  return ctx.db(async (tx) => {
    const [p] = await tx.select().from(promotionRecommendations).where(eq(promotionRecommendations.id, input.id)).for("update");
    if (!p) throw notFound("Recommendation");
    if (p.status !== "proposed" && p.status !== "deferred") throw invalidState("This recommendation was already decided.");
    await tx.update(promotionRecommendations).set({ status: input.decision, decidedBy: ctx.userId }).where(eq(promotionRecommendations.id, p.id));
    await audit(tx, ctx, { action: "promotion.decided", entityType: "promotion_recommendation", entityId: p.id, changes: { status: { from: p.status, to: input.decision } } });
    return { status: input.decision };
  });
}

/* ------------------------------------------------------------------ */
/* Performance improvement plans                                       */
/* ------------------------------------------------------------------ */

export async function createPip(ctx: RequestContext, input: z.output<typeof pipSchema>) {
  const isHr = can(ctx, "performance.manage", "all");
  if (!isHr && (input.employeeId === ctx.employeeId || !(await canAccessEmployee(ctx, "performance.review", input.employeeId)))) throw forbidden();
  return ctx.db(async (tx) => {
    const emp = (await employeeBasics(tx, [input.employeeId])).get(input.employeeId);
    if (!emp) throw notFound("Employee");
    const managerEmployeeId = isHr ? (emp.managerId ?? ctx.employeeId) : ctx.employeeId;
    if (!managerEmployeeId) throw validation("This employee has no manager. Assign a manager first.");
    const [open] = await tx
      .select({ id: improvementPlans.id })
      .from(improvementPlans)
      .where(and(eq(improvementPlans.employeeId, input.employeeId), eq(improvementPlans.status, "active")));
    if (open) throw invalidState("This employee already has an active improvement plan.");
    const [row] = await tx
      .insert(improvementPlans)
      .values({
        tenantId: ctx.tenantId,
        employeeId: input.employeeId,
        managerEmployeeId,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        objectives: input.objectives.map((o) => ({ ...o, status: "open" })),
        createdBy: ctx.userId,
      })
      .returning({ id: improvementPlans.id });
    await audit(tx, ctx, { action: "pip.created", entityType: "improvement_plan", entityId: row.id, metadata: { employeeId: input.employeeId, startsOn: input.startsOn, endsOn: input.endsOn } });
    if (emp.userId) {
      await notify(tx, {
        tenantId: ctx.tenantId,
        userIds: [emp.userId],
        category: "performance",
        title: "An improvement plan was shared with you",
        body: "Your manager will discuss the objectives with you.",
        href: "/performance?tab=reviews",
        dedupeKey: `pip:${row.id}`,
      });
    }
    return row;
  });
}

export async function listPips(ctx: RequestContext) {
  const viewScope = scopeOf(ctx, "performance.view");
  if (!viewScope && !can(ctx, "performance.manage", "all")) return [];
  return ctx.db(async (tx) => {
    // RLS limits rows to HR, the plan's manager and the employee.
    const rows = await tx.select().from(improvementPlans).orderBy(desc(improvementPlans.createdAt)).limit(300);
    const people = await employeeBasics(tx, [...rows.map((r) => r.employeeId), ...rows.map((r) => r.managerEmployeeId)]);
    return rows.map((r) => ({
      ...r,
      employeeName: people.get(r.employeeId)?.name ?? "Unknown",
      managerName: people.get(r.managerEmployeeId)?.name ?? "Unknown",
      canEdit: r.status === "active" && (can(ctx, "performance.manage", "all") || r.managerEmployeeId === ctx.employeeId),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function updatePip(ctx: RequestContext, input: z.output<typeof pipUpdateSchema>) {
  return ctx.db(async (tx) => {
    const [p] = await tx.select().from(improvementPlans).where(eq(improvementPlans.id, input.id)).for("update");
    if (!p) throw notFound("Improvement plan");
    if (!can(ctx, "performance.manage", "all") && p.managerEmployeeId !== ctx.employeeId) throw forbidden();
    if (p.status !== "active") throw invalidState("This plan is closed.");
    const objectives = p.objectives.map((o, i) => ({ ...o, status: input.objectiveStatuses?.[i] ?? o.status }));
    const after = {
      objectives,
      ...(input.outcome ? { status: "closed", outcome: [input.outcome, input.outcomeNote].filter(Boolean).join(": ") } : {}),
    };
    await tx.update(improvementPlans).set(after).where(eq(improvementPlans.id, p.id));
    await audit(tx, ctx, { action: input.outcome ? "pip.closed" : "pip.updated", entityType: "improvement_plan", entityId: p.id, changes: diff(p, after) });
    return { status: input.outcome ? "closed" : "active" };
  });
}
