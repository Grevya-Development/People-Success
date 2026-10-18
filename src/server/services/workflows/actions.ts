import { createHmac } from "node:crypto";
import { addDays, addHours, format } from "date-fns";
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { integrationConnections, integrationEvents, tasks, tenants, users as usersTable } from "../../db/schema";
import { enqueueEmail, renderEmail } from "../email";
import type { WorkflowStep } from "../../db/schema/automation";
import { notify } from "../notifications";
import { managerOf, userIdForEmployee, userIdsWithPermission, userIdsWithRoles } from "../directory";
import { startApproval } from "../approvals/engine";
import { decryptField } from "../../lib/crypto";
import { runAi } from "../../ai/run";
import { interpolate } from "@/lib/conditions";
import { z } from "zod";

export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

export type StepContext = {
  tenantId: string;
  runId: string;
  stepKey: string;
  subjectEmployeeId: string | null;
  /** Interpolation context: { employee: {...}, event: {...} } */
  vars: Record<string, unknown>;
};

export type StepResult =
  | { kind: "done"; output?: Record<string, unknown> }
  | { kind: "wait_until"; until: Date; output?: Record<string, unknown> }
  | { kind: "wait_event"; event: string; timeoutAt: Date | null }
  | { kind: "wait_approval"; requestId: string };

async function recipients(tx: Tx, c: StepContext, who: string): Promise<string[]> {
  switch (who) {
    case "employee": {
      const u = await userIdForEmployee(tx, c.subjectEmployeeId);
      return u ? [u] : [];
    }
    case "manager": {
      const u = await userIdForEmployee(tx, await managerOf(tx, c.subjectEmployeeId));
      return u ? [u] : [];
    }
    case "hr":
      return userIdsWithRoles(tx, c.tenantId, ["hr_admin", "hr_manager"]);
    case "it":
      return userIdsWithPermission(tx, c.tenantId, "assets.manage");
    case "finance":
      return userIdsWithRoles(tx, c.tenantId, ["finance_manager"]);
    case "payroll":
      return userIdsWithRoles(tx, c.tenantId, ["payroll_admin"]);
    case "recruiter":
      return userIdsWithRoles(tx, c.tenantId, ["recruiter"]);
    default:
      if (who.startsWith("role:")) return userIdsWithRoles(tx, c.tenantId, [who.slice(5)]);
      return [];
  }
}

const text = (v: unknown, c: StepContext) => interpolate(String(v ?? ""), c.vars);

/**
 * Execute one step. Side effects are keyed on run + step so a retried job never
 * duplicates them (tasks/notifications use dedupe keys, approvals use the
 * one-open-request-per-subject index).
 */
export async function executeAction(tx: Tx, step: WorkflowStep, c: StepContext): Promise<StepResult> {
  const p = step.params ?? {};
  const dedupe = `wf:${c.runId}:${c.stepKey}`;
  switch (step.action) {
    case "create_task": {
      const [existing] = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.containerType, "workflow_run"), eq(tasks.containerId, c.runId), eq(tasks.title, text(p.title, c))));
      if (existing) return { kind: "done", output: { taskId: existing.id, reused: true } };
      const who = String(p.assignee ?? "hr");
      const users = await recipients(tx, c, who);
      const dueInDays = Number(p.dueInDays ?? 3);
      const [task] = await tx
        .insert(tasks)
        .values({
          tenantId: c.tenantId,
          title: text(p.title, c).slice(0, 300),
          description: p.description ? text(p.description, c) : null,
          ownerGroup: ["employee", "manager", "hr", "it", "finance"].includes(who) ? who : "other",
          assigneeUserId: users.sort()[0] ?? null,
          subjectEmployeeId: c.subjectEmployeeId,
          containerType: "workflow_run",
          containerId: c.runId,
          dueOn: format(addDays(new Date(), Number.isFinite(dueInDays) ? dueInDays : 3), "yyyy-MM-dd"),
          createdBy: null,
        })
        .returning({ id: tasks.id });
      if (task && users[0]) {
        await notify(tx, {
          tenantId: c.tenantId,
          userIds: [users.sort()[0]],
          category: "task",
          title: `New task: ${text(p.title, c).slice(0, 120)}`,
          href: "/inbox?tab=tasks",
          dedupeKey: dedupe,
        });
      }
      return { kind: "done", output: { taskId: task.id, assigned: users.length > 0 } };
    }
    case "notify": {
      const users = await recipients(tx, c, String(p.recipients ?? "hr"));
      await notify(tx, {
        tenantId: c.tenantId,
        userIds: users,
        category: "workflow",
        title: text(p.title, c).slice(0, 200),
        body: p.body ? text(p.body, c).slice(0, 500) : null,
        href: p.href ? text(p.href, c) : null,
        dedupeKey: dedupe,
      });
      return { kind: "done", output: { recipients: users.length } };
    }
    case "send_email": {
      const users = await recipients(tx, c, String(p.recipients ?? "hr"));
      const rows = users.length ? await tx.select({ id: usersTable.id, email: usersTable.email }).from(usersTable).where(inArray(usersTable.id, users)) : [];
      const rendered = renderEmail({ title: text(p.subject, c), body: text(p.body, c).split(/\n{2,}/) });
      for (const r of rows) {
        await enqueueEmail(tx, {
          tenantId: c.tenantId,
          to: r.email,
          template: "workflow",
          subject: text(p.subject, c).slice(0, 200),
          html: rendered.html,
          text: rendered.text,
          dedupeKey: `${dedupe}:${r.id}`,
        });
      }
      return { kind: "done", output: { emails: rows.length } };
    }
    case "request_approval": {
      const request = await startApproval(
        tx,
        { tenantId: c.tenantId, userId: SYSTEM_USER_ID },
        {
          subjectType: "workflow_approval",
          subjectId: c.runId,
          title: text(p.title ?? "Workflow approval", c).slice(0, 200),
          requestedBy: SYSTEM_USER_ID,
          subjectEmployeeId: c.subjectEmployeeId,
        },
      );
      return { kind: "wait_approval", requestId: request.id };
    }
    case "wait": {
      const until = addHours(addDays(new Date(), Number(p.days ?? 0)), Number(p.hours ?? 0));
      return { kind: "wait_until", until };
    }
    case "wait_for_event": {
      const timeout = p.timeoutDays ? addDays(new Date(), Number(p.timeoutDays)) : null;
      return { kind: "wait_event", event: String(p.event), timeoutAt: timeout };
    }
    case "call_integration": {
      const [conn] = await tx
        .select()
        .from(integrationConnections)
        .where(and(eq(integrationConnections.tenantId, c.tenantId), eq(integrationConnections.provider, "webhook")));
      if (!conn || conn.status === "disabled" || !conn.credentialsEnc) throw new Error("Outbound webhook is not configured");
      const creds = JSON.parse(decryptField(conn.credentialsEnc)) as { url: string; secret: string };
      const body = JSON.stringify({ event: text(p.eventName, c), runId: c.runId, step: c.stepKey, data: c.vars, sentAt: new Date().toISOString() });
      const signature = createHmac("sha256", creds.secret).update(body).digest("hex");
      const res = await fetch(creds.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-peoplesuccess-signature": `sha256=${signature}`, "idempotency-key": dedupe },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      await tx
        .insert(integrationEvents)
        .values({
          tenantId: c.tenantId,
          connectionId: conn.id,
          provider: "webhook",
          direction: "outbound",
          eventType: text(p.eventName, c),
          externalId: dedupe,
          status: res.ok ? "delivered" : "failed",
          attempts: 1,
          error: res.ok ? null : `HTTP ${res.status}`,
          processedAt: new Date(),
        })
        .onConflictDoNothing();
      if (!res.ok) throw new Error(`Webhook responded with HTTP ${res.status}`);
      return { kind: "done", output: { status: res.status } };
    }
    case "run_agent": {
      const out = await runAi(
        { tenantId: c.tenantId, userId: null },
        {
          agentKey: String(p.agent ?? "hr_operations"),
          task: "workflow.note",
          system: "Write a short factual note (max 120 words) for HR based only on the facts provided.",
          messages: [{ role: "user", content: `${text(p.instruction, c)}\n\nFacts:\n${JSON.stringify(c.vars).slice(0, 6000)}` }],
          schema: z.object({ note: z.string().max(1200) }),
          effort: "low",
          maxTokens: 4000,
          fallback: () => ({ note: `Automated note: ${text(p.instruction, c)}` }),
        },
      );
      return { kind: "done", output: { note: out.data.note, source: out.source } };
    }
    case "escalate": {
      const hr = await userIdsWithRoles(tx, c.tenantId, ["hr_admin", "tenant_owner"]);
      await notify(tx, {
        tenantId: c.tenantId,
        userIds: hr,
        category: "escalation",
        title: "Workflow escalation",
        body: text(p.message, c).slice(0, 500),
        href: `/workflows/runs/${c.runId}`,
        dedupeKey: dedupe,
      });
      return { kind: "done", output: { notified: hr.length } };
    }
    default:
      throw new Error(`Unsupported workflow action "${step.action}"`);
  }
}

export async function tenantName(tx: Tx, tenantId: string) {
  const [t] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
  return t?.name ?? "";
}
