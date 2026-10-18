import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { withSystem } from "@/server/db/tx";
import { jobs, legalEntities, notifications, tasks, workflowDefinitions, workflowRunSteps, workflowRuns } from "@/server/db/schema";
import { runJobsOnce } from "@/server/jobs/runner";
import { createEmployee, markJoined } from "@/server/services/employees/mutations";
import { saveWorkflow, seedStarterWorkflows, setWorkflowActive } from "@/server/services/workflows/definitions";
import { retryRun } from "@/server/services/workflows/engine";
import { createEmployeeSchema } from "@/lib/validation/employees";
import { todayIn } from "@/lib/format";
import { addMember, contextFor, createOwnedTenant } from "../helpers/fixtures";

async function drain() {
  for (let i = 0; i < 40; i++) {
    // Make retries due immediately so the test does not wait for backoff.
    await db.update(jobs).set({ runAt: new Date(Date.now() - 60_000) }).where(eq(jobs.status, "queued"));
    if (!(await runJobsOnce({ workerId: "wf-test", limit: 100 }))) break;
  }
}

describe("workflow engine", () => {
  let org: Awaited<ReturnType<typeof createOwnedTenant>>;
  let le: string;
  beforeAll(async () => {
    org = await createOwnedTenant();
    [{ id: le }] = await db.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.tenantId, org.tenant.id));
    await withSystem((tx) => seedStarterWorkflows(tx, org.tenant.id, org.user.id), org.tenant.id);
  });

  const newEmployee = async (firstName: string, managerId: string | null = null) => {
    const ctx = await contextFor(org.tenant.id, org.user.id);
    return createEmployee(
      ctx,
      createEmployeeSchema.parse({
        firstName,
        legalEntityId: le,
        employmentType: "full_time",
        workerType: "employee",
        workMode: "onsite",
        joiningDate: "2099-01-01",
        probationMonths: 0,
        noticePeriodDays: 30,
        managerId,
      }),
    );
  };

  it("runs the new-joiner starter workflow once per event", async () => {
    const ctx = await contextFor(org.tenant.id, org.user.id);
    const [starter] = await db
      .select()
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.tenantId, org.tenant.id), eq(workflowDefinitions.key, "starter.new_hire_welcome")));
    await setWorkflowActive(ctx, starter.id, true);

    const mgr = await newEmployee("Mira");
    const m = await addMember(org.tenant.id, ["people_manager"], { employeeId: mgr.id });
    const joiner = await newEmployee("Jay", mgr.id);
    await markJoined(ctx, joiner.id, todayIn());
    await drain();

    const runs = await db.select().from(workflowRuns).where(and(eq(workflowRuns.definitionId, starter.id), eq(workflowRuns.subjectId, joiner.id)));
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("succeeded");
    const steps = await db.select().from(workflowRunSteps).where(eq(workflowRunSteps.runId, runs[0].id));
    expect(steps.map((s) => s.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    const created = await db.select().from(tasks).where(and(eq(tasks.containerType, "workflow_run"), eq(tasks.containerId, runs[0].id)));
    expect(created).toHaveLength(2);
    expect(created.find((t) => t.title.includes("1:1"))?.assigneeUserId).toBe(m.user.id);
    const notes = await db.select().from(notifications).where(eq(notifications.userId, m.user.id));
    expect(notes.some((n) => n.title.includes("Jay"))).toBe(true);

    // Redeliver the same domain event: no second run.
    const [eventJob] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.tenantId, org.tenant.id), eq(jobs.type, "domain_event")))
      .then((rows) => rows.filter((r) => (r.payload as { event: string; employeeId?: string }).event === "employee.joined" && (r.payload as { employeeId?: string }).employeeId === joiner.id));
    await db.update(jobs).set({ status: "queued", runAt: new Date(Date.now() - 1000) }).where(eq(jobs.id, eventJob.id));
    await drain();
    const again = await db.select().from(workflowRuns).where(and(eq(workflowRuns.definitionId, starter.id), eq(workflowRuns.subjectId, joiner.id)));
    expect(again).toHaveLength(1);
    const tasksAgain = await db.select().from(tasks).where(inArray(tasks.containerId, [runs[0].id]));
    expect(tasksAgain).toHaveLength(2);
  });

  it("fails a run after retries, then retries it without duplicating completed steps", async () => {
    const ctx = await contextFor(org.tenant.id, org.user.id);
    const { id } = await saveWorkflow(ctx, {
      name: "Webhook on join",
      trigger: "employee.joined",
      conditions: {},
      steps: [
        { key: "note", action: "notify", name: "Notify HR", params: { recipients: "hr", title: "Joined: {{employee.name}}" } },
        { key: "hook", action: "call_integration", name: "Webhook", params: { eventName: "employee.joined" }, retry: { maxAttempts: 2, backoffSeconds: 1 } },
      ],
    });
    await setWorkflowActive(ctx, id, true);
    const e = await newEmployee("Kai");
    await markJoined(ctx, e.id, todayIn());
    await drain();
    const [run] = await db.select().from(workflowRuns).where(and(eq(workflowRuns.definitionId, id), eq(workflowRuns.subjectId, e.id)));
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/Webhook/);
    const before = await db.select().from(notifications).where(eq(notifications.title, "Joined: Kai"));

    await retryRun(org.tenant.id, run.id);
    await drain();
    const [after] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, run.id));
    expect(after.status).toBe("failed"); // still no webhook configured
    const notesAfter = await db.select().from(notifications).where(eq(notifications.title, "Joined: Kai"));
    expect(notesAfter.length).toBe(before.length); // completed step was not re-run
  });
});
