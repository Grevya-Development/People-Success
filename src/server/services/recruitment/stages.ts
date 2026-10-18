import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { RequestContext } from "../../auth/context";
import { applications, recruitmentStages, scorecardTemplates } from "../../db/schema";
import type { ScorecardCriterion } from "../../db/schema/recruitment";
import { audit, diff } from "../../lib/audit";
import { invalidState, notFound, validation } from "../../lib/errors";
import { parseCriteria, type ScorecardInput, type stageSchema } from "@/lib/validation/recruitment";
import { activeStages, allStages, canViewRecruitment, requireRecruitmentManage } from "./shared";
import { forbidden } from "../../lib/errors";
import { can } from "../../auth/context";

export type StageRow = {
  id: string;
  name: string;
  kind: (typeof recruitmentStages.$inferSelect)["kind"];
  sortOrder: number;
  isActive: boolean;
  activeApplications: number;
};

export async function listStages(ctx: RequestContext): Promise<StageRow[]> {
  if (!canViewRecruitment(ctx) && !can(ctx, "interviews.feedback", "all")) throw forbidden();
  return ctx.db(async (tx) => {
    const stages = await allStages(tx, ctx.tenantId);
    const counts = await tx
      .select({ stageId: applications.stageId, n: sql<number>`count(*)::int` })
      .from(applications)
      .where(eq(applications.status, "active"))
      .groupBy(applications.stageId);
    const byStage = new Map(counts.map((c) => [c.stageId, c.n]));
    return stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, sortOrder: s.sortOrder, isActive: s.isActive, activeApplications: byStage.get(s.id) ?? 0 }));
  });
}

export async function addStage(ctx: RequestContext, input: z.output<typeof stageSchema>) {
  requireRecruitmentManage(ctx);
  return ctx.db(async (tx) => {
    const stages = await allStages(tx, ctx.tenantId);
    if (stages.some((s) => s.name.toLowerCase() === input.name.toLowerCase())) throw validation("A stage with this name already exists.", { name: ["Already used"] });
    if (input.kind === "applied" || input.kind === "hired") {
      throw validation("The pipeline already has its Applied and Hired stages; add a review, assessment or interview stage instead.", { kind: ["Choose another kind"] });
    }
    // New stages go just before the Offer stage (or before Hired); the pipeline is renumbered.
    const anchorIdx = Math.max(stages.findIndex((s) => s.kind === "offer"), 0) || stages.findIndex((s) => s.kind === "hired");
    const insertAt = anchorIdx > 0 ? anchorIdx : stages.length;
    const [row] = await tx
      .insert(recruitmentStages)
      .values({ tenantId: ctx.tenantId, name: input.name, kind: input.kind, sortOrder: 0 })
      .returning({ id: recruitmentStages.id });
    const ordered = [...stages.slice(0, insertAt).map((s) => s.id), row.id, ...stages.slice(insertAt).map((s) => s.id)];
    for (const [i, id] of ordered.entries()) await tx.update(recruitmentStages).set({ sortOrder: (i + 1) * 10 }).where(eq(recruitmentStages.id, id));
    await audit(tx, ctx, { action: "recruitment.stage_added", entityType: "recruitment_stage", entityId: row.id, metadata: { name: input.name, kind: input.kind } });
    return row;
  });
}

export async function renameStage(ctx: RequestContext, id: string, name: string) {
  requireRecruitmentManage(ctx);
  return ctx.db(async (tx) => {
    const [s] = await tx.select().from(recruitmentStages).where(eq(recruitmentStages.id, id)).for("update");
    if (!s) throw notFound("Stage");
    await tx.update(recruitmentStages).set({ name }).where(eq(recruitmentStages.id, id));
    await audit(tx, ctx, { action: "recruitment.stage_renamed", entityType: "recruitment_stage", entityId: id, changes: diff({ name: s.name }, { name }) });
  });
}

/** Swap with the neighbour. Applied stays first and Hired stays last. */
export async function moveStageOrder(ctx: RequestContext, id: string, direction: "up" | "down") {
  requireRecruitmentManage(ctx);
  return ctx.db(async (tx) => {
    const stages = await tx.select().from(recruitmentStages).orderBy(asc(recruitmentStages.sortOrder)).for("update");
    const i = stages.findIndex((s) => s.id === id);
    if (i < 0) throw notFound("Stage");
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= stages.length) return;
    const [a, b] = [stages[i], stages[j]];
    if ([a.kind, b.kind].includes("applied") || [a.kind, b.kind].includes("hired")) {
      throw invalidState("The Applied stage is always first and the Hired stage is always last.");
    }
    await tx.update(recruitmentStages).set({ sortOrder: b.sortOrder }).where(eq(recruitmentStages.id, a.id));
    await tx.update(recruitmentStages).set({ sortOrder: a.sortOrder }).where(eq(recruitmentStages.id, b.id));
    await audit(tx, ctx, { action: "recruitment.stage_reordered", entityType: "recruitment_stage", entityId: id, metadata: { direction } });
  });
}

export async function setStageActive(ctx: RequestContext, id: string, isActive: boolean) {
  requireRecruitmentManage(ctx);
  return ctx.db(async (tx) => {
    const [s] = await tx.select().from(recruitmentStages).where(eq(recruitmentStages.id, id)).for("update");
    if (!s) throw notFound("Stage");
    if (!isActive) {
      if (s.kind === "applied" || s.kind === "hired" || s.kind === "offer") {
        throw invalidState(`The ${s.name} stage is required by the pipeline and cannot be turned off.`);
      }
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(applications)
        .where(and(eq(applications.stageId, id), eq(applications.status, "active")));
      if (n > 0) throw invalidState(`Move the ${n} active candidate(s) out of ${s.name} before turning it off.`);
    }
    await tx.update(recruitmentStages).set({ isActive }).where(eq(recruitmentStages.id, id));
    await audit(tx, ctx, { action: isActive ? "recruitment.stage_activated" : "recruitment.stage_deactivated", entityType: "recruitment_stage", entityId: id });
  });
}

/* ------------------------------------------------------------------ */
/* Scorecard templates                                                 */
/* ------------------------------------------------------------------ */

export type ScorecardRow = { id: string; name: string; criteria: ScorecardCriterion[] };

export async function listScorecards(ctx: RequestContext): Promise<ScorecardRow[]> {
  if (!canViewRecruitment(ctx) && !can(ctx, "interviews.feedback", "all")) throw forbidden();
  return ctx.db(async (tx) => {
    const rows = await tx.select().from(scorecardTemplates).orderBy(asc(scorecardTemplates.name)).limit(200);
    return rows.map((r) => ({ id: r.id, name: r.name, criteria: r.criteria }));
  });
}

export async function saveScorecard(ctx: RequestContext, input: ScorecardInput) {
  requireRecruitmentManage(ctx);
  const criteria = parseCriteria(input.criteriaText);
  if (!criteria.length) throw validation("Add at least one criterion.", { criteriaText: ["Add at least one criterion"] });
  return ctx.db(async (tx) => {
    if (input.id) {
      const [before] = await tx.select().from(scorecardTemplates).where(eq(scorecardTemplates.id, input.id)).for("update");
      if (!before) throw notFound("Scorecard");
      await tx.update(scorecardTemplates).set({ name: input.name, criteria }).where(eq(scorecardTemplates.id, input.id));
      await audit(tx, ctx, { action: "recruitment.scorecard_updated", entityType: "scorecard_template", entityId: input.id, changes: diff({ name: before.name, criteria: before.criteria }, { name: input.name, criteria }) });
      return { id: input.id };
    }
    const [row] = await tx.insert(scorecardTemplates).values({ tenantId: ctx.tenantId, name: input.name, criteria }).returning({ id: scorecardTemplates.id });
    await audit(tx, ctx, { action: "recruitment.scorecard_created", entityType: "scorecard_template", entityId: row.id, metadata: { name: input.name, criteria: criteria.length } });
    return row;
  });
}

/** Default scorecard installed on request (Settings). Idempotent by name. */
export async function installDefaultScorecard(ctx: RequestContext) {
  requireRecruitmentManage(ctx);
  return ctx.db(async (tx) => {
    const name = "General interview";
    const [existing] = await tx.select({ id: scorecardTemplates.id }).from(scorecardTemplates).where(inArray(scorecardTemplates.name, [name]));
    if (existing) return existing;
    const criteria = parseCriteria(
      "Role-related knowledge: depth in the skills the job lists\nProblem solving: approach, structure and trade-offs\nCommunication: clarity and listening\nOwnership: examples of driving work to completion",
    );
    const [row] = await tx.insert(scorecardTemplates).values({ tenantId: ctx.tenantId, name, criteria }).returning({ id: scorecardTemplates.id });
    await audit(tx, ctx, { action: "recruitment.scorecard_created", entityType: "scorecard_template", entityId: row.id, metadata: { name, default: true } });
    return row;
  });
}

/** Active stages for move menus (id, name, kind). */
export async function pipelineStages(ctx: RequestContext) {
  if (!canViewRecruitment(ctx)) throw forbidden();
  const rows = await ctx.db((tx) => activeStages(tx, ctx.tenantId));
  return rows.map((s) => ({ id: s.id, name: s.name, kind: s.kind }));
}
