import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { jobs } from "../db/schema";
import { logger } from "../lib/logger";
import { allSchedules, jobHandler, registeredJobTypes, type JobRecord } from "./registry";
import "./handlers";

const STALE_LOCK_MINUTES = 10;

function backoffSeconds(attempt: number) {
  // 15s, 1m, 4m, 16m, ~1h (capped)
  return Math.min(15 * 4 ** (attempt - 1), 3600);
}

/**
 * Claim up to `limit` due jobs atomically (SKIP LOCKED: safe with many
 * workers). Only job types this process can handle are claimed, so a worker
 * running an older build never dead-letters jobs it does not know.
 */
async function claim(limit: number, workerId: string): Promise<JobRecord[]> {
  const types = registeredJobTypes();
  if (!types.length) return [];
  return db.execute<JobRecord>(sql`
    update jobs set status = 'running', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1, updated_at = now()
    where id in (
      select id from jobs
      where status = 'queued' and run_at <= now() and type = any(${`{${types.join(",")}}`}::text[])
      order by run_at
      limit ${limit}
      for update skip locked
    )
    returning id, tenant_id as "tenantId", type, payload, status, run_at as "runAt", attempts,
      max_attempts as "maxAttempts", last_error as "lastError", locked_at as "lockedAt", locked_by as "lockedBy",
      dedupe_key as "dedupeKey", result, completed_at as "completedAt", created_at as "createdAt", updated_at as "updatedAt"`) as unknown as Promise<JobRecord[]>;
}

async function finish(job: JobRecord, result: Record<string, unknown> | void) {
  await db
    .update(jobs)
    // Keep the dedupe key: a schedule slot or workflow step must never run twice.
    .set({ status: "succeeded", result: result ?? null, completedAt: new Date(), lockedAt: null, lockedBy: null })
    .where(eq(jobs.id, job.id));
}

async function fail(job: JobRecord, err: unknown) {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
  const dead = job.attempts >= job.maxAttempts;
  await db
    .update(jobs)
    .set({
      status: dead ? "dead" : "queued",
      lastError: message,
      ...(dead ? {} : { runAt: new Date(Date.now() + backoffSeconds(job.attempts) * 1000) }),
      lockedAt: null,
      lockedBy: null,
      // Free the dedupe key of dead jobs so the work can be re-enqueued later.
      dedupeKey: dead ? null : job.dedupeKey,
    })
    .where(eq(jobs.id, job.id));
  logger[dead ? "error" : "warn"]("job.failed", { jobId: job.id, type: job.type, attempt: job.attempts, dead, err });
}

/** Process one batch. Returns the number of jobs handled. */
export async function runJobsOnce(opts: { limit?: number; workerId?: string } = {}) {
  const workerId = opts.workerId ?? `worker-${process.pid}`;
  const batch = await claim(opts.limit ?? 20, workerId);
  for (const job of batch) {
    const handler = jobHandler(job.type);
    if (!handler) {
      await fail({ ...job, attempts: job.maxAttempts }, new Error(`No handler registered for job type "${job.type}"`));
      continue;
    }
    const started = Date.now();
    try {
      const result = await handler(job);
      await finish(job, result);
      logger.debug("job.succeeded", { jobId: job.id, type: job.type, ms: Date.now() - started });
    } catch (err) {
      await fail(job, err);
    }
  }
  return batch.length;
}

/** Return jobs stuck in "running" (crashed worker) to the queue. */
export async function reclaimStaleJobs() {
  const rows = await db
    .update(jobs)
    .set({ status: "queued", lockedAt: null, lockedBy: null })
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedAt, sql`now() - make_interval(mins => ${STALE_LOCK_MINUTES})`)))
    .returning({ id: jobs.id });
  return rows.length;
}

function istParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/**
 * Enqueue due scheduled jobs. Idempotent per time slot via dedupe keys, so
 * running the scheduler from several places (worker + cron) is safe.
 */
export async function tickScheduler(now = new Date()) {
  let enqueued = 0;
  for (const s of allSchedules()) {
    let slot: string | null = null;
    if ("minutes" in s.every) {
      slot = String(Math.floor(now.getTime() / (s.every.minutes * 60_000)));
    } else {
      const { date, time } = istParts(now);
      // Daily schedules fire on the first tick at or after the configured time.
      if (time >= s.every.dailyAtIst) slot = date;
    }
    if (!slot) continue;
    const payload = JSON.stringify({ schedule: s.name, slot });
    // One set-based insert per schedule; the dedupe index makes each slot fire once.
    const rows = s.perTenant
      ? await db.execute<{ id: number }>(sql`
          insert into jobs (tenant_id, type, payload, dedupe_key, max_attempts)
          select t.id, ${s.jobType}, ${payload}::jsonb, ${"schedule:" + s.name + ":"} || t.id || ${":" + slot}, 3
          from tenants t where t.status in ('active', 'onboarding')
          on conflict (dedupe_key) where dedupe_key is not null do nothing
          returning id`)
      : await db.execute<{ id: number }>(sql`
          insert into jobs (tenant_id, type, payload, dedupe_key, max_attempts)
          values (null, ${s.jobType}, ${payload}::jsonb, ${`schedule:${s.name}:global:${slot}`}, 3)
          on conflict (dedupe_key) where dedupe_key is not null do nothing
          returning id`);
    enqueued += rows.length;
  }
  return enqueued;
}
