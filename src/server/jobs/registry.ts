
import type { Queryable, Tx } from "../db/client";
import { jobs } from "../db/schema";
import type { DomainEventType } from "../services/events";

export type JobRecord = typeof jobs.$inferSelect;

export type JobHandler = (job: JobRecord) => Promise<Record<string, unknown> | void>;

const handlers = new Map<string, JobHandler>();

/** Register the function that processes jobs of `type`. One handler per type. */
export function registerJobHandler(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

export const jobHandler = (type: string) => handlers.get(type);
export const registeredJobTypes = () => [...handlers.keys()];

export type EnqueueOptions = {
  tenantId?: string | null;
  payload?: Record<string, unknown>;
  runAt?: Date;
  /** Jobs with the same dedupe key are only enqueued once while pending. */
  dedupeKey?: string;
  maxAttempts?: number;
};

export async function enqueueJob(q: Queryable, type: string, opts: EnqueueOptions = {}) {
  const [row] = await q
    .insert(jobs)
    .values({
      tenantId: opts.tenantId ?? null,
      type,
      payload: opts.payload ?? {},
      runAt: opts.runAt ?? new Date(),
      dedupeKey: opts.dedupeKey ?? null,
      maxAttempts: opts.maxAttempts ?? 5,
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id });
  return row?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* Domain event subscribers                                            */
/* ------------------------------------------------------------------ */

export type DomainEvent = { event: DomainEventType; emittedAt: string; [key: string]: unknown };
export type EventSubscriber = (tenantId: string, event: DomainEvent, jobId: number) => Promise<void>;

const subscribers = new Map<string, EventSubscriber[]>();

/** Subscribe to a domain event type, or "*" for all events (e.g. the workflow engine). */
export function onDomainEvent(type: DomainEventType | "*", fn: EventSubscriber) {
  const list = subscribers.get(type) ?? [];
  list.push(fn);
  subscribers.set(type, list);
}

export const subscribersFor = (type: string) => [...(subscribers.get(type) ?? []), ...(subscribers.get("*") ?? [])];

/* ------------------------------------------------------------------ */
/* Schedules                                                           */
/* ------------------------------------------------------------------ */

export type Schedule = {
  name: string;
  /** Run every N minutes, or once a day at a local IST time ("HH:mm"). */
  every: { minutes: number } | { dailyAtIst: string };
  /** Per-tenant schedules enqueue one job per active tenant. */
  perTenant: boolean;
  /** The job type to enqueue (must have a registered handler). */
  jobType: string;
};

const schedules: Schedule[] = [];

export function registerSchedule(s: Schedule) {
  if (!schedules.some((x) => x.name === s.name)) schedules.push(s);
}

export const allSchedules = () => [...schedules];

export type { Tx };
