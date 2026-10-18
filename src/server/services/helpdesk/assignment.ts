import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { withSystem } from "../../db/tx";
import { tickets } from "../../db/schema";
import { userIdsWithPermission, userIdsWithRoles } from "../directory";

/** Users who may work a ticket in this category (owner role + helpdesk staff). */
export async function eligibleAssignees(tx: Tx, tenantId: string, category: { ownerRoleKey: string; isSensitive: boolean } | null) {
  const managers = await userIdsWithPermission(tx, tenantId, "helpdesk.manage");
  if (category?.isSensitive) return new Set(managers);
  const [agents, owners] = await Promise.all([
    userIdsWithPermission(tx, tenantId, "helpdesk.agent"),
    category ? userIdsWithRoles(tx, tenantId, [category.ownerRoleKey]) : Promise.resolve([] as string[]),
  ]);
  return new Set([...managers, ...agents, ...owners]);
}

/**
 * Round-robin auto-assignment: among users holding the category's owner role
 * (helpdesk managers for sensitive categories, or when nobody holds the
 * role), pick the one with the fewest open tickets, then the one assigned
 * longest ago. Ticket counts span other users' queues, which the requester
 * cannot read under RLS, so this aggregate runs in system context with an
 * explicit tenant filter and returns only a user id.
 */
export async function pickAssignee(
  tenantId: string,
  category: { ownerRoleKey: string; isSensitive: boolean },
  opts: { excludeUserId?: string } = {},
): Promise<string | null> {
  return withSystem(async (tx) => {
    let candidates = await userIdsWithRoles(tx, tenantId, [category.ownerRoleKey]);
    if (category.isSensitive) {
      const managers = new Set(await userIdsWithPermission(tx, tenantId, "helpdesk.manage"));
      candidates = candidates.filter((u) => managers.has(u));
    }
    if (!candidates.length) candidates = await userIdsWithPermission(tx, tenantId, "helpdesk.manage");
    const others = candidates.filter((u) => u !== opts.excludeUserId);
    if (others.length) candidates = others;
    if (!candidates.length) return null;

    const load = await tx
      .select({
        userId: tickets.assigneeUserId,
        open: sql<number>`count(*) filter (where ${tickets.status} not in ('resolved','closed'))::int`,
        last: sql<number>`coalesce(extract(epoch from max(${tickets.createdAt})), 0)`.mapWith(Number),
      })
      .from(tickets)
      .where(and(eq(tickets.tenantId, tenantId), inArray(tickets.assigneeUserId, candidates)))
      .groupBy(tickets.assigneeUserId);
    const byUser = new Map(load.map((l) => [l.userId, l]));
    const ranked = [...candidates].sort((a, b) => {
      const la = byUser.get(a);
      const lb = byUser.get(b);
      const d = (la?.open ?? 0) - (lb?.open ?? 0);
      if (d) return d;
      return (la?.last ?? 0) - (lb?.last ?? 0) || a.localeCompare(b);
    });
    return ranked[0] ?? null;
  }, tenantId);
}
