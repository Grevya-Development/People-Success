import type { Tx } from "../db/client";
import { jobs } from "../db/schema";

/**
 * Domain events use a transactional outbox: the event is written to the job
 * queue in the same transaction as the change that caused it, so it is
 * delivered if and only if the change commits. The worker fans events out to
 * the workflow engine, notifications and integrations.
 */
export type DomainEventType =
  | "employee.created"
  | "employee.joined"
  | "employee.job_changed"
  | "employee.probation_confirmed"
  | "employee.compensation_changed"
  | "employee.exited"
  | "candidate.stage_changed"
  | "offer.accepted"
  | "candidate.applied"
  | "offer.declined"
  | "requisition.approved"
  | "leave.requested"
  | "leave.decided"
  | "attendance.exception"
  | "payroll.period_opened"
  | "payroll.exception"
  | "payroll.locked"
  | "payroll.payslips_published"
  | "performance.cycle_started"
  | "performance.cycle_closed"
  | "learning.course_completed"
  | "document.expiring"
  | "resignation.submitted"
  | "onboarding.completed"
  | "offboarding.completed"
  | "exit.accepted"
  | "milestone.reached"
  | "expense_claim.submitted"
  | "expense_claim.approved"
  | "ticket.created"
  | "ticket.resolved";

export async function emitDomainEvent(
  tx: Tx,
  tenantId: string,
  type: DomainEventType,
  payload: Record<string, unknown>,
  opts: { dedupeKey?: string } = {},
) {
  await tx
    .insert(jobs)
    .values({
      tenantId,
      type: "domain_event",
      payload: { event: type, ...payload, emittedAt: new Date().toISOString() },
      dedupeKey: opts.dedupeKey ? `event:${tenantId}:${opts.dedupeKey}` : null,
    })
    .onConflictDoNothing();
}
