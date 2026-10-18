import "server-only";
import { gte, sql } from "drizzle-orm";
import type { RequestContext } from "../../auth/context";
import { ticketCategories, tickets } from "../../db/schema";
import { forbidden } from "../../lib/errors";
import { isHelpdeskAgent } from "./rules";

export type HelpdeskInsights = {
  days: number;
  total: number;
  open: number;
  byCategory: { name: string; total: number; open: number }[];
  medianFirstResponseHours: number | null;
  medianResolutionHours: number | null;
  /** Share of tickets (with a due time) that missed first response or resolution. */
  slaBreachRate: number | null;
  firstResponseBreaches: number;
  resolutionBreaches: number;
  satisfaction: { average: number | null; ratings: number };
  aiAssistedReplies: number;
};

/** Service desk metrics for tickets created in the last `days` days (RLS-scoped to what the viewer may see). */
export async function helpdeskInsights(ctx: RequestContext, days = 90): Promise<HelpdeskInsights> {
  if (!isHelpdeskAgent(ctx)) throw forbidden();
  const since = new Date(Date.now() - days * 86_400_000);
  return ctx.db(async (tx) => {
    const where = gte(tickets.createdAt, since);
    const [[totals], byCategory, [ai]] = await Promise.all([
      tx
        .select({
          total: sql<number>`count(*)::int`,
          open: sql<number>`count(*) filter (where ${tickets.status} not in ('resolved','closed'))::int`,
          mfr: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${tickets.firstRespondedAt} - ${tickets.createdAt})) / 3600)`,
          mres: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${tickets.resolvedAt} - ${tickets.createdAt})) / 3600)`,
          withDue: sql<number>`count(*) filter (where ${tickets.firstResponseDueAt} is not null)::int`,
          frBreach: sql<number>`count(*) filter (where coalesce(${tickets.firstRespondedAt}, now()) > ${tickets.firstResponseDueAt})::int`,
          resBreach: sql<number>`count(*) filter (where coalesce(${tickets.resolvedAt}, now()) > ${tickets.resolutionDueAt})::int`,
          anyBreach: sql<number>`count(*) filter (where coalesce(${tickets.firstRespondedAt}, now()) > ${tickets.firstResponseDueAt} or coalesce(${tickets.resolvedAt}, now()) > ${tickets.resolutionDueAt})::int`,
          avgSat: sql<number | null>`avg(${tickets.satisfaction})`,
          ratings: sql<number>`count(${tickets.satisfaction})::int`,
        })
        .from(tickets)
        .where(where),
      tx
        .select({
          name: sql<string>`coalesce(${ticketCategories.name}, 'Uncategorized')`,
          total: sql<number>`count(*)::int`,
          open: sql<number>`count(*) filter (where ${tickets.status} not in ('resolved','closed'))::int`,
        })
        .from(tickets)
        .leftJoin(ticketCategories, sql`${ticketCategories.id} = ${tickets.categoryId}`)
        .where(where)
        .groupBy(sql`1`)
        .orderBy(sql`2 desc`),
      tx.execute<{ n: number }>(sql`
        select count(*)::int as n from ticket_messages m join tickets t on t.id = m.ticket_id
        where m.ai_assisted and t.created_at >= ${since.toISOString()}`),
    ]);
    const num = (v: unknown) => (v == null ? null : Math.round(Number(v) * 10) / 10);
    return {
      days,
      total: Number(totals.total),
      open: Number(totals.open),
      byCategory: byCategory.map((r) => ({ name: r.name, total: Number(r.total), open: Number(r.open) })),
      medianFirstResponseHours: num(totals.mfr),
      medianResolutionHours: num(totals.mres),
      slaBreachRate: Number(totals.withDue) ? Number(totals.anyBreach) / Number(totals.withDue) : null,
      firstResponseBreaches: Number(totals.frBreach),
      resolutionBreaches: Number(totals.resBreach),
      satisfaction: { average: num(totals.avgSat), ratings: Number(totals.ratings) },
      aiAssistedReplies: Number(ai?.n ?? 0),
    };
  });
}
