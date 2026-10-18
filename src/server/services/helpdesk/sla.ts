import "server-only";
import { and, eq, isNull, notInArray, or, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { ticketCategories, tickets } from "../../db/schema";
import { audit } from "../../lib/audit";
import { notify } from "../notifications";
import { userIdsWithPermission } from "../directory";

/**
 * Escalate tickets past their SLA: first response overdue (no HR reply yet)
 * or resolution overdue (not resolved; the clock does not run while waiting
 * on the employee). Notifies the assignee and helpdesk managers once per
 * ticket and breach type (dedupe keys) and stamps escalatedAt the first time.
 * System context: every query filters by tenant.
 */
export async function escalateOverdueTickets(tx: Tx, tenantId: string) {
  const overdue = await tx
    .select({
      id: tickets.id,
      number: tickets.number,
      assigneeUserId: tickets.assigneeUserId,
      escalatedAt: tickets.escalatedAt,
      sensitive: ticketCategories.isSensitive,
      firstOverdue: sql<boolean>`(${tickets.firstRespondedAt} is null and ${tickets.firstResponseDueAt} < now())`,
      resolutionOverdue: sql<boolean>`(${tickets.status} <> 'waiting_on_employee' and ${tickets.resolutionDueAt} < now())`,
    })
    .from(tickets)
    .leftJoin(ticketCategories, eq(ticketCategories.id, tickets.categoryId))
    .where(
      and(
        eq(tickets.tenantId, tenantId),
        notInArray(tickets.status, ["resolved", "closed"]),
        or(
          and(isNull(tickets.firstRespondedAt), sql`${tickets.firstResponseDueAt} < now()`),
          and(sql`${tickets.status} <> 'waiting_on_employee'`, sql`${tickets.resolutionDueAt} < now()`),
        ),
      ),
    )
    .limit(500);
  if (!overdue.length) return { escalated: 0, notified: 0 };

  const managers = await userIdsWithPermission(tx, tenantId, "helpdesk.manage");
  let notified = 0;
  for (const t of overdue) {
    const recipients = [...new Set([t.assigneeUserId, ...managers].filter((u): u is string => !!u))];
    const label = t.sensitive ? `${t.number} (confidential)` : t.number;
    for (const [kind, hit] of [["first_response", t.firstOverdue], ["resolution", t.resolutionOverdue]] as const) {
      if (!hit) continue;
      await notify(tx, {
        tenantId,
        userIds: recipients,
        category: "helpdesk",
        title: `SLA breached · ${label}`,
        body: kind === "first_response" ? "No first response yet and the response time has passed." : "The resolution time has passed.",
        href: `/helpdesk/${t.id}`,
        dedupeKey: `ticket:${t.id}:sla:${kind}`,
      });
      notified++;
    }
    if (!t.escalatedAt) {
      await tx.update(tickets).set({ escalatedAt: new Date() }).where(and(eq(tickets.id, t.id), eq(tickets.tenantId, tenantId)));
      await audit(tx, { tenantId, userId: null, actorType: "system" }, {
        action: "ticket.escalated",
        entityType: "ticket",
        entityId: t.id,
        metadata: { firstResponse: !!t.firstOverdue, resolution: !!t.resolutionOverdue },
      });
    }
  }
  return { escalated: overdue.filter((t) => !t.escalatedAt).length, notified };
}
