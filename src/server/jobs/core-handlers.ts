import { and, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { withSystem } from "../db/tx";
import { idempotencyKeys, jobs, rateLimits } from "../db/schema";
import { escalateOverdueSteps } from "../services/approvals/engine";
import { applyScheduledAssignments } from "../services/employees/mutations";
import { registerJobHandler, registerSchedule, subscribersFor, type DomainEvent } from "./registry";
import { todayIn } from "@/lib/format";

/** Fan a domain event out to its subscribers. Each subscriber must be idempotent. */
registerJobHandler("domain_event", async (job) => {
  if (!job.tenantId) return { skipped: "no tenant" };
  const event = job.payload as DomainEvent;
  const subs = subscribersFor(event.event);
  for (const sub of subs) await sub(job.tenantId, event, job.id);
  return { subscribers: subs.length };
});

registerJobHandler("approvals.escalate", async (job) => {
  if (!job.tenantId) return;
  const n = await withSystem((tx) => escalateOverdueSteps(tx, job.tenantId!), job.tenantId);
  return { escalated: n };
});
registerSchedule({ name: "approvals.escalate", every: { minutes: 30 }, perTenant: true, jobType: "approvals.escalate" });

registerJobHandler("employees.apply_scheduled_changes", async (job) => {
  if (!job.tenantId) return;
  const n = await withSystem((tx) => applyScheduledAssignments(tx, job.tenantId!, todayIn()), job.tenantId);
  return { applied: n };
});
registerSchedule({ name: "employees.apply_scheduled_changes", every: { dailyAtIst: "00:05" }, perTenant: true, jobType: "employees.apply_scheduled_changes" });

/** Housekeeping: prune finished jobs, stale rate-limit windows and old idempotency keys. */
registerJobHandler("maintenance.prune", async () => {
  const doneJobs = await db
    .delete(jobs)
    .where(and(sql`${jobs.status} in ('succeeded','cancelled')`, lt(jobs.completedAt, sql`now() - interval '14 days'`)))
    .returning({ id: jobs.id });
  const limits = await db.delete(rateLimits).where(lt(rateLimits.windowStart, sql`now() - interval '1 day'`)).returning({ b: rateLimits.bucket });
  const keys = await db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, sql`now() - interval '7 days'`)).returning({ k: idempotencyKeys.key });
  return { jobs: doneJobs.length, rateLimits: limits.length, idempotencyKeys: keys.length };
});
registerSchedule({ name: "maintenance.prune", every: { dailyAtIst: "03:30" }, perTenant: false, jobType: "maintenance.prune" });


/** Retry queued/failed emails (immediate sends happen via sendNow after commit). */
registerJobHandler("email.deliver", async () => {
  const { deliverPendingEmails } = await import("../services/email");
  return deliverPendingEmails(50);
});
registerSchedule({ name: "email.deliver", every: { minutes: 1 }, perTenant: false, jobType: "email.deliver" });
