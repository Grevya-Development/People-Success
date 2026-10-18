import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { authorize, can, canAccessEmployee, type RequestContext } from "../../../auth/context";
import { careerPlans, departments, engagementActionPlans, jobOpenings, locations, positions, successionPlans, surveys } from "../../../db/schema";
import { audit, diff } from "../../../lib/audit";
import { forbidden, notFound, validation } from "../../../lib/errors";
import { notify } from "../../notifications";
import { todayIn } from "@/lib/format";
import type { actionPlanSchema, careerManagerNotesSchema, careerPlanSchema, successionPlanSchema } from "@/lib/validation/talent";
import { employeeBasics } from "../shared";

/* ------------------------------------------------------------------ */
/* Career plans                                                        */
/* ------------------------------------------------------------------ */

export async function getCareerPlan(ctx: RequestContext, employeeId: string) {
  const isSelf = employeeId === ctx.employeeId;
  const canView = isSelf || can(ctx, "performance.manage", "all") || (await canAccessEmployee(ctx, "performance.view", employeeId));
  if (!canView) throw forbidden();
  const canManagerNote = !isSelf && (can(ctx, "performance.manage", "all") || (await canAccessEmployee(ctx, "performance.review", employeeId)));
  return ctx.db(async (tx) => {
    const emp = (await employeeBasics(tx, [employeeId])).get(employeeId);
    if (!emp) throw notFound("Employee");
    const [plan] = await tx.select().from(careerPlans).where(eq(careerPlans.employeeId, employeeId));
    return { employee: { id: emp.id, name: emp.name }, plan: plan ?? null, isSelf, canEdit: isSelf, canManagerNote };
  });
}

/** Employees own their aspirations, target roles and actions. */
export async function saveCareerPlan(ctx: RequestContext, input: z.output<typeof careerPlanSchema>) {
  if (input.employeeId !== ctx.employeeId) throw forbidden("Only the employee edits their career plan; managers add notes.");
  const values = { aspirations: input.aspirations, targetRoles: input.targetRoles, interestedInMobility: input.interestedInMobility, actions: input.actions };
  return ctx.db(async (tx) => {
    const [before] = await tx.select().from(careerPlans).where(eq(careerPlans.employeeId, input.employeeId)).for("update");
    if (before) {
      await tx.update(careerPlans).set(values).where(eq(careerPlans.id, before.id));
      await audit(tx, ctx, { action: "career_plan.updated", entityType: "career_plan", entityId: before.id, changes: diff(before, values) });
      return { id: before.id };
    }
    const [row] = await tx.insert(careerPlans).values({ tenantId: ctx.tenantId, employeeId: input.employeeId, ...values }).returning({ id: careerPlans.id });
    await audit(tx, ctx, { action: "career_plan.created", entityType: "career_plan", entityId: row.id });
    return row;
  });
}

export async function saveCareerManagerNotes(ctx: RequestContext, input: z.output<typeof careerManagerNotesSchema>) {
  if (input.employeeId === ctx.employeeId) throw forbidden();
  if (!can(ctx, "performance.manage", "all") && !(await canAccessEmployee(ctx, "performance.review", input.employeeId))) throw forbidden();
  return ctx.db(async (tx) => {
    const emp = (await employeeBasics(tx, [input.employeeId])).get(input.employeeId);
    if (!emp) throw notFound("Employee");
    const [before] = await tx.select().from(careerPlans).where(eq(careerPlans.employeeId, input.employeeId)).for("update");
    const values = { managerNotes: input.managerNotes, reviewedOn: todayIn() };
    let id: string;
    if (before) {
      await tx.update(careerPlans).set(values).where(eq(careerPlans.id, before.id));
      id = before.id;
    } else {
      [{ id }] = await tx.insert(careerPlans).values({ tenantId: ctx.tenantId, employeeId: input.employeeId, ...values }).returning({ id: careerPlans.id });
    }
    await audit(tx, ctx, { action: "career_plan.manager_notes", entityType: "career_plan", entityId: id, metadata: { employeeId: input.employeeId } });
    if (emp.userId) {
      await notify(tx, { tenantId: ctx.tenantId, userIds: [emp.userId], category: "engagement", title: "Your manager reviewed your career plan", href: "/engagement?tab=career", dedupeKey: `career-notes:${id}:${values.reviewedOn}` });
    }
    return { id };
  });
}

/** Published internal openings for the career page (internal mobility). */
export async function internalOpenings(ctx: RequestContext) {
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        id: jobOpenings.id,
        title: jobOpenings.title,
        slug: jobOpenings.slug,
        department: departments.name,
        location: locations.name,
        workMode: jobOpenings.workMode,
        employmentType: jobOpenings.employmentType,
        closesOn: jobOpenings.closesOn,
        skills: jobOpenings.skills,
        publishedAt: jobOpenings.publishedAt,
      })
      .from(jobOpenings)
      .leftJoin(departments, eq(departments.id, jobOpenings.departmentId))
      .leftJoin(locations, eq(locations.id, jobOpenings.locationId))
      .where(eq(jobOpenings.status, "published"))
      .orderBy(desc(jobOpenings.publishedAt))
      .limit(100);
    const today = todayIn();
    return rows.filter((r) => !r.closesOn || r.closesOn >= today).map((r) => ({ ...r, publishedAt: r.publishedAt?.toISOString() ?? null }));
  });
}

/* ------------------------------------------------------------------ */
/* Succession (succession.manage only, also enforced by RLS)           */
/* ------------------------------------------------------------------ */

export async function listSuccessionPlans(ctx: RequestContext) {
  authorize(ctx, "succession.manage", "all");
  return ctx.db(async (tx) => {
    const rows = await tx.select().from(successionPlans).orderBy(asc(successionPlans.roleTitle));
    const people = await employeeBasics(tx, rows.flatMap((r) => [r.incumbentEmployeeId, ...r.candidates.map((c) => c.employeeId)]));
    const posIds = rows.map((r) => r.positionId).filter((x): x is string => !!x);
    const pos = posIds.length ? await tx.select({ id: positions.id, code: positions.code, title: positions.title }).from(positions).where(inArray(positions.id, posIds)) : [];
    const posMap = new Map(pos.map((p) => [p.id, `${p.code} · ${p.title}`]));
    return rows.map((r) => ({
      ...r,
      positionLabel: r.positionId ? (posMap.get(r.positionId) ?? null) : null,
      incumbentName: r.incumbentEmployeeId ? (people.get(r.incumbentEmployeeId)?.name ?? null) : null,
      candidates: r.candidates.map((c) => ({ ...c, name: people.get(c.employeeId)?.name ?? "Unknown" })),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function saveSuccessionPlan(ctx: RequestContext, input: z.output<typeof successionPlanSchema>) {
  authorize(ctx, "succession.manage", "all");
  const candidateIds = input.candidates.map((c) => c.employeeId);
  if (new Set(candidateIds).size !== candidateIds.length) throw validation("Each candidate can be listed once.", { candidates: ["Duplicate candidate"] });
  if (input.incumbentEmployeeId && candidateIds.includes(input.incumbentEmployeeId)) throw validation("The incumbent cannot be their own successor.", { candidates: ["Remove the incumbent"] });
  return ctx.db(async (tx) => {
    const found = await employeeBasics(tx, [...candidateIds, input.incumbentEmployeeId]);
    for (const id of [...candidateIds, input.incumbentEmployeeId].filter(Boolean) as string[]) if (!found.has(id)) throw validation("Some people no longer exist.", { candidates: ["Not found"] });
    if (input.positionId) {
      const [p] = await tx.select({ id: positions.id }).from(positions).where(eq(positions.id, input.positionId));
      if (!p) throw validation("Choose a valid position.", { positionId: ["Not found"] });
    }
    const values = { positionId: input.positionId, roleTitle: input.roleTitle, incumbentEmployeeId: input.incumbentEmployeeId, criticality: input.criticality, candidates: input.candidates };
    if (input.id) {
      const [before] = await tx.select().from(successionPlans).where(eq(successionPlans.id, input.id));
      if (!before) throw notFound("Succession plan");
      await tx.update(successionPlans).set(values).where(eq(successionPlans.id, input.id));
      await audit(tx, ctx, { action: "succession.updated", entityType: "succession_plan", entityId: input.id, changes: diff(before, values) });
      return { id: input.id };
    }
    const [row] = await tx.insert(successionPlans).values({ tenantId: ctx.tenantId, ...values, createdBy: ctx.userId }).returning({ id: successionPlans.id });
    await audit(tx, ctx, { action: "succession.created", entityType: "succession_plan", entityId: row.id, metadata: { roleTitle: input.roleTitle } });
    return row;
  });
}

/* ------------------------------------------------------------------ */
/* Engagement action plans                                             */
/* ------------------------------------------------------------------ */

export async function listActionPlans(ctx: RequestContext, opts: { surveyId?: string } = {}) {
  const manage = can(ctx, "engagement.manage", "all") || can(ctx, "engagement.results", "all");
  if (!manage && !ctx.employeeId) return [];
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ p: engagementActionPlans, survey: surveys.title, department: departments.name })
      .from(engagementActionPlans)
      .leftJoin(surveys, eq(surveys.id, engagementActionPlans.surveyId))
      .leftJoin(departments, eq(departments.id, engagementActionPlans.departmentId))
      .where(and(opts.surveyId ? eq(engagementActionPlans.surveyId, opts.surveyId) : undefined, manage ? undefined : eq(engagementActionPlans.ownerEmployeeId, ctx.employeeId!)))
      .orderBy(desc(engagementActionPlans.updatedAt))
      .limit(200);
    const owners = await employeeBasics(tx, rows.map((r) => r.p.ownerEmployeeId));
    return rows.map((r) => ({
      ...r.p,
      surveyTitle: r.survey,
      departmentName: r.department,
      ownerName: owners.get(r.p.ownerEmployeeId)?.name ?? "Unknown",
      canEdit: can(ctx, "engagement.manage", "all") || r.p.ownerEmployeeId === ctx.employeeId,
      createdAt: r.p.createdAt.toISOString(),
      updatedAt: r.p.updatedAt.toISOString(),
    }));
  });
}

/** HR creates plans; the owner can update actions and status of their plan. */
export async function saveActionPlan(ctx: RequestContext, input: z.output<typeof actionPlanSchema>) {
  const manage = can(ctx, "engagement.manage", "all");
  return ctx.db(async (tx) => {
    const owner = (await employeeBasics(tx, [input.ownerEmployeeId])).get(input.ownerEmployeeId);
    if (!owner) throw validation("Choose a valid owner.", { ownerEmployeeId: ["Not found"] });
    if (input.surveyId) {
      const [s] = await tx.select({ id: surveys.id }).from(surveys).where(eq(surveys.id, input.surveyId));
      if (!s) throw validation("Choose a valid survey.", { surveyId: ["Not found"] });
    }
    if (input.departmentId) {
      const [d] = await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, input.departmentId));
      if (!d) throw validation("Choose a valid department.", { departmentId: ["Not found"] });
    }
    const values = { surveyId: input.surveyId, departmentId: input.departmentId, ownerEmployeeId: input.ownerEmployeeId, focusArea: input.focusArea, actions: input.actions, status: input.status };
    if (input.id) {
      const [before] = await tx.select().from(engagementActionPlans).where(eq(engagementActionPlans.id, input.id)).for("update");
      if (!before) throw notFound("Action plan");
      if (!manage && before.ownerEmployeeId !== ctx.employeeId) throw forbidden();
      const next = manage ? values : { ...values, ownerEmployeeId: before.ownerEmployeeId, surveyId: before.surveyId, departmentId: before.departmentId };
      await tx.update(engagementActionPlans).set(next).where(eq(engagementActionPlans.id, before.id));
      await audit(tx, ctx, { action: "engagement.action_plan_updated", entityType: "engagement_action_plan", entityId: before.id, changes: diff(before, next) });
      return { id: before.id };
    }
    if (!manage) throw forbidden();
    const [row] = await tx.insert(engagementActionPlans).values({ tenantId: ctx.tenantId, ...values }).returning({ id: engagementActionPlans.id });
    await audit(tx, ctx, { action: "engagement.action_plan_created", entityType: "engagement_action_plan", entityId: row.id, metadata: { focusArea: input.focusArea } });
    if (owner.userId && owner.userId !== ctx.userId) {
      await notify(tx, { tenantId: ctx.tenantId, userIds: [owner.userId], category: "engagement", title: `You own an engagement action plan: ${input.focusArea}`, href: "/engagement?tab=results", dedupeKey: `action-plan:${row.id}` });
    }
    return row;
  });
}

export async function positionOptions(ctx: RequestContext) {
  authorize(ctx, "succession.manage", "all");
  return ctx.db(async (tx) => {
    const rows = await tx.select({ id: positions.id, code: positions.code, title: positions.title }).from(positions).orderBy(asc(positions.code)).limit(2000);
    return rows.map((p) => ({ value: p.id, label: `${p.code} · ${p.title}` }));
  });
}
