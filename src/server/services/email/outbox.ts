import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { withSystem } from "../../db/tx";
import { emailOutbox } from "../../db/schema";
import { env } from "../../env";
import { logger } from "../../lib/logger";
import { defaultProvider, type EmailProvider } from "./providers";

export const MAX_EMAIL_ATTEMPTS = 5;
/** Rows left in "sending" longer than this (crashed worker) are picked up again. */
const STALE_SENDING_MINUTES = 10;

export type EnqueueEmailInput = {
  tenantId: string | null;
  to: string;
  /** Template key, e.g. "invitation". Used for reporting, not rendering. */
  template: string;
  subject: string;
  html: string;
  text?: string | null;
  /** Unique key; a second enqueue with the same key is ignored. */
  dedupeKey?: string | null;
};

/**
 * Queue an email inside the caller's transaction, so it is only sent if the
 * business change commits. Works under tenant RLS (insert-only policy), which
 * is why the id is generated here instead of using RETURNING.
 * Returns the outbox id, or null when the dedupe key already existed.
 */
export async function enqueueEmail(tx: Tx, input: EnqueueEmailInput): Promise<string | null> {
  const id = randomUUID();
  const result = await tx
    .insert(emailOutbox)
    .values({
      id,
      tenantId: input.tenantId,
      toAddress: input.to.trim(),
      template: input.template,
      subject: input.subject.slice(0, 300),
      html: input.html,
      text: input.text ?? null,
      dedupeKey: input.dedupeKey ?? null,
    })
    .onConflictDoNothing();
  const inserted = (result as unknown as { count?: number }).count;
  return inserted === 0 ? null : id;
}

type ClaimedRow = { id: string; to_address: string; subject: string; html: string; text: string | null; attempts: number };

async function claim(opts: { limit: number; id?: string }): Promise<ClaimedRow[]> {
  return withSystem(async (tx) => {
    // Rows stuck in "sending" past their last attempt can never succeed: retire them.
    await tx.execute(sql`
      update email_outbox set status = 'dead', updated_at = now(),
        last_error = coalesce(last_error, 'Delivery did not complete')
      where status = 'sending' and attempts >= ${MAX_EMAIL_ATTEMPTS}
        and updated_at < now() - make_interval(mins => ${STALE_SENDING_MINUTES})`);

    const filter = opts.id
      ? sql`id = ${opts.id} and status in ('pending', 'failed') and attempts < ${MAX_EMAIL_ATTEMPTS}`
      : sql`attempts < ${MAX_EMAIL_ATTEMPTS} and (
          status = 'pending'
          or (status = 'failed' and updated_at < now() - make_interval(mins => attempts * attempts))
          or (status = 'sending' and updated_at < now() - make_interval(mins => ${STALE_SENDING_MINUTES}))
        )`;

    const rows = await tx.execute<ClaimedRow>(sql`
      with picked as (
        select id from email_outbox
        where ${filter}
        order by created_at
        limit ${opts.limit}
        for update skip locked
      )
      update email_outbox o
      set status = 'sending', attempts = o.attempts + 1, updated_at = now()
      from picked
      where o.id = picked.id
      returning o.id, o.to_address, o.subject, o.html, o.text, o.attempts`);
    return [...rows];
  });
}

async function deliver(row: ClaimedRow, provider: EmailProvider): Promise<"sent" | "failed" | "dead"> {
  try {
    const { providerMessageId } = await provider.send({
      id: row.id,
      to: row.to_address,
      from: env().EMAIL_FROM,
      subject: row.subject,
      html: row.html,
      text: row.text,
    });
    await withSystem((tx) =>
      tx
        .update(emailOutbox)
        .set({ status: "sent", provider: provider.name, providerMessageId, sentAt: new Date(), lastError: null })
        .where(and(eq(emailOutbox.id, row.id), eq(emailOutbox.status, "sending"))),
    );
    return "sent";
  } catch (err) {
    const status = row.attempts >= MAX_EMAIL_ATTEMPTS ? "dead" : "failed";
    const message = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 500);
    await withSystem((tx) =>
      tx
        .update(emailOutbox)
        .set({ status, provider: provider.name, lastError: message })
        .where(and(eq(emailOutbox.id, row.id), eq(emailOutbox.status, "sending"))),
    );
    logger.warn("email.delivery_failed", { outboxId: row.id, attempts: row.attempts, status, provider: provider.name });
    return status;
  }
}

export type DeliveryReport = { claimed: number; sent: number; failed: number; dead: number };

/**
 * Worker entry point: claims due rows with FOR UPDATE SKIP LOCKED (safe to
 * run concurrently), sends them outside the claiming transaction and records
 * the outcome. Sent rows are never picked again, so repeated runs are safe.
 */
export async function deliverPendingEmails(limit = 25, opts: { provider?: EmailProvider } = {}): Promise<DeliveryReport> {
  const rows = await claim({ limit });
  const provider = opts.provider ?? defaultProvider();
  const report: DeliveryReport = { claimed: rows.length, sent: 0, failed: 0, dead: 0 };
  for (const row of rows) report[await deliver(row, provider)]++;
  return report;
}

/**
 * Try to send one queued email immediately. Call only after the enqueuing
 * transaction has committed (e.g. from `after()` in a Server Action). Never
 * throws: failures stay in the outbox for the worker to retry.
 */
export async function sendNow(outboxId: string | null | undefined, opts: { provider?: EmailProvider } = {}) {
  if (!outboxId) return null;
  try {
    const [row] = await claim({ limit: 1, id: outboxId });
    if (!row) return null;
    return await deliver(row, opts.provider ?? defaultProvider());
  } catch (err) {
    logger.warn("email.send_now_failed", { outboxId, err });
    return null;
  }
}
