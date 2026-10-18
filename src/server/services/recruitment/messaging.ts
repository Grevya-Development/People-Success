import "server-only";
import type { Tx } from "../../db/client";
import { enqueueEmail, renderEmail } from "../email";
import { notify } from "../notifications";
import { logEvent, usersWithPermission } from "./shared";

/**
 * Queue an email to a candidate inside the business transaction and record
 * it on the application timeline (communication history). Returns the outbox
 * id for an immediate `sendNow` after commit.
 */
export async function queueCandidateEmail(
  tx: Tx,
  e: {
    tenantId: string;
    applicationId: string | null;
    to: string;
    subject: string;
    paragraphs: string[];
    template: string;
    actorUserId: string | null;
    dedupeKey?: string;
    cta?: { label: string; href: string };
    footer?: string;
    companyName: string;
  },
) {
  const { html, text } = renderEmail({
    title: e.subject,
    body: e.paragraphs,
    cta: e.cta,
    footer: e.footer ?? `Sent by ${e.companyName} through PeopleSuccess. Reply to this email if you have questions.`,
  });
  const outboxId = await enqueueEmail(tx, {
    tenantId: e.tenantId,
    to: e.to,
    template: e.template,
    subject: e.subject,
    html,
    text,
    dedupeKey: e.dedupeKey ?? null,
  });
  if (e.applicationId && outboxId) {
    await logEvent(tx, {
      tenantId: e.tenantId,
      applicationId: e.applicationId,
      type: "email",
      actorUserId: e.actorUserId,
      body: e.paragraphs.join("\n\n").slice(0, 4000),
      metadata: { subject: e.subject, template: e.template, to: e.to, outboxId },
    });
  }
  return outboxId;
}

/** In-app notification to the opening's recruiter, or every recruitment manager if none is set. */
export async function notifyRecruiters(
  tx: Tx,
  tenantId: string,
  opts: { recruiterUserId?: string | null; extraUserIds?: (string | null | undefined)[]; title: string; body?: string | null; href: string; dedupeKey: string },
) {
  const userIds = opts.recruiterUserId ? [opts.recruiterUserId] : await usersWithPermission(tx, tenantId, "recruitment.manage");
  await notify(tx, {
    tenantId,
    userIds: [...userIds, ...((opts.extraUserIds ?? []).filter(Boolean) as string[])],
    category: "recruitment",
    title: opts.title,
    body: opts.body ?? null,
    href: opts.href,
    dedupeKey: opts.dedupeKey,
  });
}
