import { and, asc, eq, sql } from "drizzle-orm";
import { differenceInCalendarDays, parseISO } from "date-fns";
import type { Tx } from "../../db/client";
import { withSystem } from "../../db/tx";
import {
  departments,
  designations,
  employees,
  workflowDefinitions,
  workflowRunSteps,
  workflowRuns,
  workflowVersions,
} from "../../db/schema";
import { enqueueJob, type DomainEvent } from "../../jobs/registry";
import { notify } from "../notifications";
import { userIdsWithRoles } from "../directory";
import { matchesConditions } from "@/lib/conditions";
import { executeAction, type StepContext } from "./actions";

const MAX_STEP_ATTEMPTS = 3;

/** Facts available to conditions and templates for an event's subject employee. */
async function employeeFacts(tx: Tx, employeeId: string | null) {
  if (!employeeId) return null;
  const [e] = await tx
    .select({
      id: employees.id,
      name: employees.displayName,
      code: employees.employeeCode,
      status: employees.status,
      employmentType: employees.employmentType,
      workerType: employees.workerType,
      departmentId: employees.departmentId,
      department: departments.name,
      designationId: employees.designationId,
      designation: designations.title,
      locationId: employees.locationId,
      legalEntityId: employees.legalEntityId,
      managerId: employees.managerId,
      gradeId: employees.gradeId,
      joiningDate: employees.joiningDate,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .where(eq(employees.id, employeeId));
  if (!e) return null;
  return { ...e, tenureDays: differenceInCalendarDays(new Date(), parseISO(e.joiningDate)) };
}

const subjectEmployeeOf = (event: DomainEvent) => (typeof event.employeeId === "string" ? event.employeeId : null);

/**
 * Domain event → workflow runs. The unique (definition, dedupe key) index
 * makes this idempotent: a redelivered event never starts a second run.
 */
export async function startRunsForEvent(tenantId: string, event: DomainEvent, eventJobId: number) {
  const runIds = await withSystem(async (tx) => {
    const defs = await tx
      .select()
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.tenantId, tenantId), eq(workflowDefinitions.trigger, event.event), eq(workflowDefinitions.isActive, true)));
    if (!defs.length) return [];
    const subjectId = subjectEmployeeOf(event);
    const emp = await employeeFacts(tx, subjectId);
    const facts = { ...(emp ?? {}), ...event };
    const created: string[] = [];
    for (const def of defs) {
      if (!matchesConditions(def.conditions as never, facts)) continue;
      const [run] = await tx
        .insert(workflowRuns)
        .values({
          tenantId,
          definitionId: def.id,
          version: def.currentVersion,
          status: "queued",
          triggerEvent: event,
          subjectType: emp ? "employee" : null,
          subjectId: emp?.id ?? null,
          context: { employee: emp, event },
          dedupeKey: `event:${eventJobId}`,
        })
        .onConflictDoNothing()
        .returning({ id: workflowRuns.id });
      if (run) {
        created.push(run.id);
        await enqueueJob(tx, "workflow.step", { tenantId, payload: { runId: run.id }, dedupeKey: `wf:${run.id}:step:0` });
      }
    }
    return created;
  }, tenantId);
  return runIds;
}

/** Manually start a run (e.g. "Run now" from the builder for testing). */
export async function startManualRun(tenantId: string, definitionId: string, employeeId: string | null, actorUserId: string) {
  return withSystem(async (tx) => {
    const [def] = await tx.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.id, definitionId), eq(workflowDefinitions.tenantId, tenantId)));
    if (!def) throw new Error("Workflow not found");
    const emp = await employeeFacts(tx, employeeId);
    const event = { event: def.trigger, manual: true, startedBy: actorUserId, employeeId, emittedAt: new Date().toISOString() };
    const [run] = await tx
      .insert(workflowRuns)
      .values({
        tenantId,
        definitionId: def.id,
        version: def.currentVersion,
        status: "queued",
        triggerEvent: event,
        subjectType: emp ? "employee" : null,
        subjectId: emp?.id ?? null,
        context: { employee: emp, event },
        dedupeKey: `manual:${crypto.randomUUID()}`,
      })
      .returning({ id: workflowRuns.id });
    await enqueueJob(tx, "workflow.step", { tenantId, payload: { runId: run.id }, dedupeKey: `wf:${run.id}:step:0` });
    return run.id;
  }, tenantId);
}

async function advance(tx: Tx, run: typeof workflowRuns.$inferSelect, nextIndex: number) {
  await tx
    .update(workflowRuns)
    .set({ currentStepIndex: nextIndex, status: "running", waitingUntil: null, waitingForEvent: null })
    .where(eq(workflowRuns.id, run.id));
  await enqueueJob(tx, "workflow.step", { tenantId: run.tenantId, payload: { runId: run.id }, dedupeKey: `wf:${run.id}:step:${nextIndex}` });
}

async function failRun(tx: Tx, run: typeof workflowRuns.$inferSelect, message: string) {
  await tx.update(workflowRuns).set({ status: "failed", error: message.slice(0, 1000), finishedAt: new Date() }).where(eq(workflowRuns.id, run.id));
  const admins = await userIdsWithRoles(tx, run.tenantId, ["hr_admin", "tenant_owner"]);
  await notify(tx, {
    tenantId: run.tenantId,
    userIds: admins,
    category: "workflow",
    title: "A workflow run failed",
    body: message.slice(0, 200),
    href: `/workflows/runs/${run.id}`,
    dedupeKey: `wf:${run.id}:failed`,
  });
}

/**
 * Execute the current step of a run. Called by the "workflow.step" job.
 * Safe to call repeatedly: completed steps are skipped, waits resume only
 * when due, and every side effect is keyed on run + step.
 */
export async function executeRunStep(runId: string) {
  const outcome = await withSystem(async (tx) => {
    const [run] = await tx.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).for("update");
    if (!run || !["queued", "running", "waiting"].includes(run.status)) return { state: "skipped" as const };
    const [version] = await tx
      .select()
      .from(workflowVersions)
      .where(and(eq(workflowVersions.definitionId, run.definitionId), eq(workflowVersions.version, run.version)));
    if (!version) {
      await failRun(tx, run, "Workflow version not found");
      return { state: "failed" as const };
    }
    const steps = version.steps;
    const idx = run.currentStepIndex;
    if (idx >= steps.length) {
      await tx.update(workflowRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(workflowRuns.id, run.id));
      return { state: "succeeded" as const };
    }
    const step = steps[idx];
    const ctx = run.context as { employee?: { id?: string } | null; event?: Record<string, unknown> };
    const facts = { ...(ctx.employee ?? {}), ...(ctx.event ?? {}) };

    await tx
      .insert(workflowRunSteps)
      .values({
        tenantId: run.tenantId,
        runId: run.id,
        stepKey: step.key,
        action: step.action,
        status: "pending",
        idempotencyKey: `${run.id}:${step.key}`,
        input: step.params,
      })
      .onConflictDoNothing();
    const [record] = await tx
      .select()
      .from(workflowRunSteps)
      .where(and(eq(workflowRunSteps.runId, run.id), eq(workflowRunSteps.stepKey, step.key)))
      .for("update");

    if (record.status === "succeeded" || record.status === "skipped") {
      await advance(tx, run, idx + 1);
      return { state: "advanced" as const };
    }
    if (step.when && !matchesConditions(step.when as never, facts)) {
      await tx.update(workflowRunSteps).set({ status: "skipped", finishedAt: new Date() }).where(eq(workflowRunSteps.id, record.id));
      await advance(tx, run, idx + 1);
      return { state: "advanced" as const };
    }
    // A step that is waiting resumes only when its time has come.
    if (record.status === "waiting") {
      const due = run.waitingUntil && run.waitingUntil <= new Date();
      if (!due) return { state: "waiting" as const };
      await tx
        .update(workflowRunSteps)
        .set({ status: "succeeded", finishedAt: new Date(), output: { ...(record.output ?? {}), resumedAt: new Date().toISOString(), timedOut: !!run.waitingForEvent } })
        .where(eq(workflowRunSteps.id, record.id));
      await advance(tx, run, idx + 1);
      return { state: "advanced" as const };
    }
    if (run.status === "waiting") return { state: "waiting" as const };

    await tx.update(workflowRuns).set({ status: "running" }).where(eq(workflowRuns.id, run.id));
    await tx
      .update(workflowRunSteps)
      .set({ status: "running", attempts: sql`${workflowRunSteps.attempts} + 1`, startedAt: new Date(), error: null })
      .where(eq(workflowRunSteps.id, record.id));

    const stepCtx: StepContext = {
      tenantId: run.tenantId,
      runId: run.id,
      stepKey: step.key,
      subjectEmployeeId: run.subjectId,
      vars: { employee: ctx.employee ?? {}, event: ctx.event ?? {} },
    };
    try {
      const result = await executeAction(tx, step, stepCtx);
      if (result.kind === "done") {
        await tx.update(workflowRunSteps).set({ status: "succeeded", output: result.output ?? {}, finishedAt: new Date() }).where(eq(workflowRunSteps.id, record.id));
        await advance(tx, run, idx + 1);
        return { state: "advanced" as const };
      }
      if (result.kind === "wait_until") {
        await tx.update(workflowRunSteps).set({ status: "waiting", output: { until: result.until.toISOString() } }).where(eq(workflowRunSteps.id, record.id));
        await tx.update(workflowRuns).set({ status: "waiting", waitingUntil: result.until }).where(eq(workflowRuns.id, run.id));
        await enqueueJob(tx, "workflow.step", { tenantId: run.tenantId, payload: { runId: run.id }, runAt: result.until, dedupeKey: `wf:${run.id}:resume:${idx}` });
        return { state: "waiting" as const };
      }
      if (result.kind === "wait_event") {
        await tx.update(workflowRunSteps).set({ status: "waiting", output: { event: result.event } }).where(eq(workflowRunSteps.id, record.id));
        await tx
          .update(workflowRuns)
          .set({ status: "waiting", waitingForEvent: result.event, waitingUntil: result.timeoutAt })
          .where(eq(workflowRuns.id, run.id));
        if (result.timeoutAt) {
          await enqueueJob(tx, "workflow.step", { tenantId: run.tenantId, payload: { runId: run.id }, runAt: result.timeoutAt, dedupeKey: `wf:${run.id}:timeout:${idx}` });
        }
        return { state: "waiting" as const };
      }
      // wait_approval: the approval handler resumes the run.
      await tx.update(workflowRunSteps).set({ status: "waiting", output: { approvalRequestId: result.requestId } }).where(eq(workflowRunSteps.id, record.id));
      await tx.update(workflowRuns).set({ status: "waiting", waitingForEvent: "approval" }).where(eq(workflowRuns.id, run.id));
      return { state: "waiting" as const };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = (record.attempts ?? 0) + 1;
      const max = step.retry?.maxAttempts ?? MAX_STEP_ATTEMPTS;
      await tx.update(workflowRunSteps).set({ status: attempts >= max ? "failed" : "pending", error: message.slice(0, 1000) }).where(eq(workflowRunSteps.id, record.id));
      if (attempts >= max) {
        await failRun(tx, run, `Step "${step.name}" failed: ${message}`);
        return { state: "failed" as const };
      }
      return { state: "retry" as const, message };
    }
  });
  // Throwing makes the job runner retry with backoff (state already recorded).
  if (outcome.state === "retry") throw new Error(outcome.message);
  return outcome;
}

/** Resume runs waiting for `event` on the same subject. */
export async function resumeRunsWaitingFor(tenantId: string, event: DomainEvent) {
  const subjectId = subjectEmployeeOf(event);
  if (!subjectId) return 0;
  return withSystem(async (tx) => {
    const waiting = await tx
      .select()
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.tenantId, tenantId),
          eq(workflowRuns.status, "waiting"),
          eq(workflowRuns.waitingForEvent, event.event),
          eq(workflowRuns.subjectId, subjectId),
        ),
      );
    for (const run of waiting) {
      const [step] = await tx
        .select()
        .from(workflowRunSteps)
        .where(and(eq(workflowRunSteps.runId, run.id), eq(workflowRunSteps.status, "waiting")))
        .orderBy(asc(workflowRunSteps.startedAt))
        .limit(1);
      if (step) {
        await tx
          .update(workflowRunSteps)
          .set({ status: "succeeded", finishedAt: new Date(), output: { ...(step.output ?? {}), receivedEvent: event.event } })
          .where(eq(workflowRunSteps.id, step.id));
      }
      await advance(tx, run, run.currentStepIndex + 1);
    }
    return waiting.length;
  }, tenantId);
}

/** Approval outcome for a request_approval step. */
export async function resolveApprovalStep(tx: Tx, runId: string, approved: boolean, comment: string | null) {
  const [run] = await tx.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).for("update");
  if (!run || run.status !== "waiting" || run.waitingForEvent !== "approval") return;
  const [step] = await tx
    .select()
    .from(workflowRunSteps)
    .where(and(eq(workflowRunSteps.runId, run.id), eq(workflowRunSteps.status, "waiting")))
    .limit(1);
  if (step) {
    await tx
      .update(workflowRunSteps)
      .set({ status: approved ? "succeeded" : "failed", finishedAt: new Date(), output: { ...(step.output ?? {}), approved, comment } })
      .where(eq(workflowRunSteps.id, step.id));
  }
  if (approved) await advance(tx, run, run.currentStepIndex + 1);
  else await tx.update(workflowRuns).set({ status: "cancelled", error: `Approval rejected${comment ? `: ${comment}` : ""}`, finishedAt: new Date() }).where(eq(workflowRuns.id, run.id));
}

/** Retry a failed run from its failed step (idempotent per step). */
export async function retryRun(tenantId: string, runId: string) {
  return withSystem(async (tx) => {
    const [run] = await tx.select().from(workflowRuns).where(and(eq(workflowRuns.id, runId), eq(workflowRuns.tenantId, tenantId))).for("update");
    if (!run || run.status !== "failed") throw new Error("Only failed runs can be retried");
    await tx
      .update(workflowRunSteps)
      .set({ status: "pending", attempts: 0, error: null })
      .where(and(eq(workflowRunSteps.runId, run.id), eq(workflowRunSteps.status, "failed")));
    await tx.update(workflowRuns).set({ status: "running", error: null, finishedAt: null }).where(eq(workflowRuns.id, run.id));
    await enqueueJob(tx, "workflow.step", { tenantId, payload: { runId }, dedupeKey: `wf:${run.id}:retry:${Date.now()}` });
  }, tenantId);
}

export async function cancelRun(tenantId: string, runId: string, userId: string) {
  return withSystem(async (tx) => {
    const res = await tx
      .update(workflowRuns)
      .set({ status: "cancelled", cancelledBy: userId, finishedAt: new Date(), error: "Cancelled by user" })
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.tenantId, tenantId), sql`${workflowRuns.status} in ('queued','running','waiting')`))
      .returning({ id: workflowRuns.id });
    if (!res.length) throw new Error("Only active runs can be cancelled");
  }, tenantId);
}

