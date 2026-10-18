import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { z } from "zod";
import { authorize, type RequestContext } from "../../../auth/context";
import type { Tx } from "../../../db/client";
import { competencies, ratingScales, reviewCycles, reviewTemplates } from "../../../db/schema";
import type { ReviewQuestion } from "../../../db/schema/talent";
import { audit, diff } from "../../../lib/audit";
import { invalidState, notFound } from "../../../lib/errors";
import { DEFAULT_RATING_SCALE } from "@/lib/talent/ratings";
import type { competencySchema, ratingScaleSchema, reviewTemplateSchema } from "@/lib/validation/talent";

/** Insert the default 5-point scale if missing; returns its id. Idempotent. */
export async function ensureDefaultRatingScale(tx: Tx, tenantId: string): Promise<string> {
  await tx
    .insert(ratingScales)
    .values({ tenantId, name: DEFAULT_RATING_SCALE.name, levels: DEFAULT_RATING_SCALE.levels })
    .onConflictDoNothing();
  const [row] = await tx
    .select({ id: ratingScales.id })
    .from(ratingScales)
    .where(and(eq(ratingScales.tenantId, tenantId), eq(ratingScales.name, DEFAULT_RATING_SCALE.name)));
  return row.id;
}

const DEFAULT_TEMPLATE: { name: string; questions: ReviewQuestion[] } = {
  name: "Standard review",
  questions: [
    { id: "impact", label: "Overall impact and results this period", type: "rating", required: true, forKinds: ["self", "manager"] },
    { id: "achievements", label: "Key achievements", type: "text", required: true, forKinds: ["self", "manager"] },
    { id: "collaboration", label: "Collaboration and teamwork", type: "rating", required: true, forKinds: ["self", "manager", "peer"] },
    { id: "growth", label: "Areas to grow in the next period", type: "text", required: false, forKinds: ["self", "manager", "peer"] },
    { id: "support", label: "My manager supports my growth", type: "rating", required: true, forKinds: ["upward"] },
    { id: "upward_text", label: "What could your manager do differently?", type: "text", required: false, forKinds: ["upward"] },
  ],
};

/** Default scale and starter template; safe to run repeatedly. */
export async function installPerformanceDefaults(ctx: RequestContext) {
  authorize(ctx, "performance.manage", "all");
  return ctx.db(async (tx) => {
    const scaleId = await ensureDefaultRatingScale(tx, ctx.tenantId);
    const inserted = await tx
      .insert(reviewTemplates)
      .values({ tenantId: ctx.tenantId, name: DEFAULT_TEMPLATE.name, questions: DEFAULT_TEMPLATE.questions, includeGoals: true, goalsWeightPercent: 50 })
      .onConflictDoNothing()
      .returning({ id: reviewTemplates.id });
    await audit(tx, ctx, { action: "performance.defaults_installed", entityType: "rating_scale", entityId: scaleId, metadata: { templateCreated: inserted.length > 0 } });
    return { scaleId, templateCreated: inserted.length > 0 };
  });
}

export async function performanceSetup(ctx: RequestContext) {
  authorize(ctx, "performance.manage", "all");
  return ctx.db(async (tx) => {
    const [scales, comps, templates] = await Promise.all([
      tx.select().from(ratingScales).orderBy(asc(ratingScales.name)),
      tx.select().from(competencies).orderBy(asc(competencies.name)),
      tx.select().from(reviewTemplates).orderBy(asc(reviewTemplates.name)),
    ]);
    return { scales, competencies: comps, templates };
  });
}

/** Scales and templates referenced by launched (non-draft) cycles are frozen. */
async function assertNotInUse(tx: Tx, column: "templateId" | "ratingScaleId", id: string) {
  const [used] = await tx
    .select({ id: reviewCycles.id })
    .from(reviewCycles)
    .where(and(eq(reviewCycles[column], id), ne(reviewCycles.status, "draft")))
    .limit(1);
  if (used) throw invalidState("This is used by a launched review cycle and can no longer be changed. Create a new one instead.");
}

export async function saveRatingScale(ctx: RequestContext, input: z.output<typeof ratingScaleSchema>) {
  authorize(ctx, "performance.manage", "all");
  const levels = [...input.levels].sort((a, b) => a.value - b.value);
  return ctx.db(async (tx) => {
    if (input.id) {
      const [before] = await tx.select().from(ratingScales).where(eq(ratingScales.id, input.id));
      if (!before) throw notFound("Rating scale");
      await assertNotInUse(tx, "ratingScaleId", input.id);
      await tx.update(ratingScales).set({ name: input.name, levels }).where(eq(ratingScales.id, input.id));
      await audit(tx, ctx, { action: "performance.scale_updated", entityType: "rating_scale", entityId: input.id, changes: diff(before, { name: input.name, levels }) });
      return { id: input.id };
    }
    const [row] = await tx.insert(ratingScales).values({ tenantId: ctx.tenantId, name: input.name, levels }).returning({ id: ratingScales.id });
    await audit(tx, ctx, { action: "performance.scale_created", entityType: "rating_scale", entityId: row.id, metadata: { name: input.name } });
    return row;
  });
}

export async function saveCompetency(ctx: RequestContext, input: z.output<typeof competencySchema>) {
  authorize(ctx, "performance.manage", "all");
  const values = { name: input.name, description: input.description, category: input.category, isActive: input.isActive };
  return ctx.db(async (tx) => {
    if (input.id) {
      const [before] = await tx.select().from(competencies).where(eq(competencies.id, input.id));
      if (!before) throw notFound("Competency");
      await tx.update(competencies).set(values).where(eq(competencies.id, input.id));
      await audit(tx, ctx, { action: "performance.competency_updated", entityType: "competency", entityId: input.id, changes: diff(before, values) });
      return { id: input.id };
    }
    const [row] = await tx.insert(competencies).values({ tenantId: ctx.tenantId, ...values }).returning({ id: competencies.id });
    await audit(tx, ctx, { action: "performance.competency_created", entityType: "competency", entityId: row.id, metadata: { name: input.name } });
    return row;
  });
}

export async function saveReviewTemplate(ctx: RequestContext, input: z.output<typeof reviewTemplateSchema>) {
  authorize(ctx, "performance.manage", "all");
  return ctx.db(async (tx) => {
    const compIds = [...new Set(input.questions.map((q) => q.competencyId).filter((x): x is string => !!x))];
    if (compIds.length) {
      const found = await tx.select({ id: competencies.id }).from(competencies).where(inArray(competencies.id, compIds));
      if (found.length !== compIds.length) throw invalidState("A selected competency no longer exists.");
    }
    const values = {
      name: input.name,
      questions: input.questions as ReviewQuestion[],
      includeGoals: input.includeGoals,
      goalsWeightPercent: input.includeGoals ? input.goalsWeightPercent : 0,
    };
    if (input.id) {
      const [before] = await tx.select().from(reviewTemplates).where(eq(reviewTemplates.id, input.id));
      if (!before) throw notFound("Review template");
      await assertNotInUse(tx, "templateId", input.id);
      await tx.update(reviewTemplates).set(values).where(eq(reviewTemplates.id, input.id));
      await audit(tx, ctx, { action: "performance.template_updated", entityType: "review_template", entityId: input.id, changes: diff(before, values) });
      return { id: input.id };
    }
    const [row] = await tx.insert(reviewTemplates).values({ tenantId: ctx.tenantId, ...values }).returning({ id: reviewTemplates.id });
    await audit(tx, ctx, { action: "performance.template_created", entityType: "review_template", entityId: row.id, metadata: { name: input.name } });
    return row;
  });
}
