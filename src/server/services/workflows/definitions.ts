import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { authorize, type RequestContext } from "../../auth/context";
import type { Tx } from "../../db/client";
import { employees, workflowDefinitions, workflowRunSteps, workflowRuns, workflowVersions } from "../../db/schema";
import type { WorkflowStep } from "../../db/schema/automation";
import { audit } from "../../lib/audit";
import { AppError, notFound } from "../../lib/errors";
import { seedTenantDefaults } from "../tenancy/provision";
import { STARTER_WORKFLOWS, WORKFLOW_ACTIONS, WORKFLOW_TRIGGERS } from "./catalog";

const stepSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,40}$/, "Use lowercase letters, digits and underscores"),
  action: z.enum(WORKFLOW_ACTIONS.map((a) => a.action) as [string, ...string[]]),
  name: z.string().trim().min(1).max(80),
  params: z.record(z.string(), z.unknown()),
  when: z.record(z.string(), z.unknown()).optional(),
  retry: z.object({ maxAttempts: z.number().int().min(1).max(10), backoffSeconds: z.number().int().min(1).max(3600) }).optional(),
});

export const saveWorkflowSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(3, "Name the workflow").max(120),
  description: z.string().trim().max(500).nullish(),
  trigger: z.enum(WORKFLOW_TRIGGERS.map((t) => t.event) as [string, ...string[]]),
  conditions: z.record(z.string(), z.unknown()),
  steps: z
    .array(stepSchema)
    .min(1, "Add at least one step")
    .max(25)
    .refine((s) => new Set(s.map((x) => x.key)).size === s.length, "Step keys must be unique"),
});

function validateSteps(steps: z.infer<typeof stepSchema>[]) {
  for (const s of steps) {
    const spec = WORKFLOW_ACTIONS.find((a) => a.action === s.action)!;
    for (const p of spec.params) {
      if (p.required && (s.params[p.key] === undefined || s.params[p.key] === "")) {
        throw new AppError("VALIDATION", `Step "${s.name}": ${p.label} is required.`);
      }
    }
  }
}

/** Seed starter workflows (inactive) and the workflow approval policy. Idempotent. */
export async function seedStarterWorkflows(tx: Tx, tenantId: string, createdBy: string | null) {
  await seedTenantDefaults(tx, tenantId);
  let created = 0;
  for (const s of STARTER_WORKFLOWS) {
    const [def] = await tx
      .insert(workflowDefinitions)
      .values({
        tenantId,
        key: s.key,
        name: s.name,
        description: s.description,
        trigger: s.trigger,
        conditions: s.conditions,
        isActive: false,
        isStarter: true,
        createdBy,
      })
      .onConflictDoNothing()
      .returning({ id: workflowDefinitions.id });
    if (def) {
      await tx.insert(workflowVersions).values({ tenantId, definitionId: def.id, version: 1, steps: s.steps, createdBy });
      created++;
    }
  }
  return created;
}

export async function listWorkflows(ctx: RequestContext) {
  authorize(ctx, "workflows.manage", "all");
  return ctx.db(async (tx) => {
    const defs = await tx.select().from(workflowDefinitions).orderBy(desc(workflowDefinitions.isActive), workflowDefinitions.name);
    const ids = defs.map((d) => d.id);
    const stats = ids.length
      ? await tx
          .select({
            definitionId: workflowRuns.definitionId,
            total: count(),
            failed: sql<number>`count(*) filter (where ${workflowRuns.status} = 'failed')`.mapWith(Number),
            active: sql<number>`count(*) filter (where ${workflowRuns.status} in ('queued','running','waiting'))`.mapWith(Number),
            lastRunAt: sql<string | null>`max(${workflowRuns.startedAt})`,
          })
          .from(workflowRuns)
          .where(inArray(workflowRuns.definitionId, ids))
          .groupBy(workflowRuns.definitionId)
      : [];
    const byId = new Map(stats.map((s) => [s.definitionId, s]));
    return defs.map((d) => ({
      ...d,
      triggerLabel: WORKFLOW_TRIGGERS.find((t) => t.event === d.trigger)?.label ?? d.trigger,
      runs: byId.get(d.id)?.total ?? 0,
      failedRuns: byId.get(d.id)?.failed ?? 0,
      activeRuns: byId.get(d.id)?.active ?? 0,
      lastRunAt: byId.get(d.id)?.lastRunAt ?? null,
    }));
  });
}

export async function getWorkflow(ctx: RequestContext, id: string) {
  authorize(ctx, "workflows.manage", "all");
  return ctx.db(async (tx) => {
    const [def] = await tx.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
    if (!def) throw notFound("Workflow");
    const versions = await tx.select().from(workflowVersions).where(eq(workflowVersions.definitionId, id)).orderBy(desc(workflowVersions.version));
    return { def, steps: versions[0]?.steps ?? [], versions: versions.map((v) => ({ version: v.version, createdAt: v.createdAt.toISOString(), stepCount: v.steps.length })) };
  });
}

/** Create or update. Every save of steps creates a new immutable version; running runs keep theirs. */
export async function saveWorkflow(ctx: RequestContext, input: z.infer<typeof saveWorkflowSchema>) {
  authorize(ctx, "workflows.manage", "all");
  validateSteps(input.steps);
  return ctx.db(async (tx) => {
    if (input.id) {
      const [def] = await tx.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, input.id)).for("update");
      if (!def) throw notFound("Workflow");
      const version = def.currentVersion + 1;
      await tx.insert(workflowVersions).values({ tenantId: ctx.tenantId, definitionId: def.id, version, steps: input.steps as WorkflowStep[], createdBy: ctx.userId });
      await tx
        .update(workflowDefinitions)
        .set({ name: input.name, description: input.description ?? null, trigger: input.trigger, conditions: input.conditions, currentVersion: version })
        .where(eq(workflowDefinitions.id, def.id));
      await audit(tx, ctx, { action: "workflow.updated", entityType: "workflow", entityId: def.id, metadata: { version } });
      return { id: def.id, version };
    }
    const key = `custom.${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40)}_${Date.now().toString(36)}`;
    const [def] = await tx
      .insert(workflowDefinitions)
      .values({ tenantId: ctx.tenantId, key, name: input.name, description: input.description ?? null, trigger: input.trigger, conditions: input.conditions, isActive: false, createdBy: ctx.userId })
      .returning();
    await tx.insert(workflowVersions).values({ tenantId: ctx.tenantId, definitionId: def.id, version: 1, steps: input.steps as WorkflowStep[], createdBy: ctx.userId });
    await audit(tx, ctx, { action: "workflow.created", entityType: "workflow", entityId: def.id });
    return { id: def.id, version: 1 };
  });
}

export async function setWorkflowActive(ctx: RequestContext, id: string, active: boolean) {
  authorize(ctx, "workflows.manage", "all");
  return ctx.db(async (tx) => {
    const res = await tx.update(workflowDefinitions).set({ isActive: active }).where(eq(workflowDefinitions.id, id)).returning({ id: workflowDefinitions.id });
    if (!res.length) throw notFound("Workflow");
    await audit(tx, ctx, { action: active ? "workflow.activated" : "workflow.deactivated", entityType: "workflow", entityId: id });
  });
}

export async function listRuns(ctx: RequestContext, filter: { definitionId?: string; status?: string } = {}) {
  authorize(ctx, "workflows.manage", "all");
  return ctx.db((tx) =>
    tx
      .select({
        id: workflowRuns.id,
        definitionId: workflowRuns.definitionId,
        definitionName: workflowDefinitions.name,
        status: workflowRuns.status,
        version: workflowRuns.version,
        currentStepIndex: workflowRuns.currentStepIndex,
        subjectName: employees.displayName,
        subjectId: workflowRuns.subjectId,
        error: workflowRuns.error,
        startedAt: workflowRuns.startedAt,
        finishedAt: workflowRuns.finishedAt,
      })
      .from(workflowRuns)
      .innerJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowRuns.definitionId))
      .leftJoin(employees, eq(employees.id, workflowRuns.subjectId))
      .where(
        and(
          filter.definitionId ? eq(workflowRuns.definitionId, filter.definitionId) : undefined,
          filter.status ? eq(workflowRuns.status, filter.status as "failed") : undefined,
        ),
      )
      .orderBy(desc(workflowRuns.startedAt))
      .limit(200),
  );
}

export async function getRun(ctx: RequestContext, runId: string) {
  authorize(ctx, "workflows.manage", "all");
  return ctx.db(async (tx) => {
    const [run] = await tx
      .select({ run: workflowRuns, name: workflowDefinitions.name, subjectName: employees.displayName })
      .from(workflowRuns)
      .innerJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowRuns.definitionId))
      .leftJoin(employees, eq(employees.id, workflowRuns.subjectId))
      .where(eq(workflowRuns.id, runId));
    if (!run) throw notFound("Workflow run");
    const [version] = await tx
      .select()
      .from(workflowVersions)
      .where(and(eq(workflowVersions.definitionId, run.run.definitionId), eq(workflowVersions.version, run.run.version)));
    const steps = await tx.select().from(workflowRunSteps).where(eq(workflowRunSteps.runId, runId));
    return { ...run, plan: version?.steps ?? [], steps };
  });
}
