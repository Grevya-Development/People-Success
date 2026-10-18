import "server-only";
import { sql } from "drizzle-orm";
import type { RequestContext } from "../../auth/context";
import { activeStages, canSeeOffers, requireRecruitmentView } from "./shared";

/**
 * Recruitment analytics. All figures are computed live from the pipeline
 * tables for the caller's tenant (RLS applies). Definitions:
 *
 *  - Funnel (per opening, or all openings): an application "reached" a stage
 *    when its current stage, or any stage it was moved to (application_events
 *    stage_changed / hired), has that stage's sort order or later. Rejected
 *    and withdrawn applications count for the stages they reached.
 *    Conversion = reached(stage) / reached(previous stage).
 *  - Time to hire: median and average calendar days from applied_at to
 *    decided_at for applications with status "hired".
 *  - Offer acceptance rate: accepted / (accepted + declined + expired)
 *    offers. Rescinded and open offers are excluded. Only shown to people
 *    who can see offers.
 *  - Source effectiveness: per application source, applications, how many
 *    reached an interview-kind stage (or later), hires, and hire rate
 *    (hires / applications).
 */

export type FunnelRow = { stageId: string; name: string; kind: string; reached: number; conversion: number | null };
export type SourceRow = { source: string; applications: number; interviewed: number; hired: number; hireRate: number | null };

export async function recruitmentAnalytics(ctx: RequestContext, opts: { openingId?: string | null } = {}) {
  requireRecruitmentView(ctx);
  const opening = opts.openingId ?? null;
  return ctx.db(async (tx) => {
    const stages = await activeStages(tx, ctx.tenantId);
    const openingFilter = opening ? sql`and a.opening_id = ${opening}` : sql``;

    // Highest stage order reached per application.
    const reachedRows = await tx.execute<{ max_order: number }>(sql`
      select greatest(
        coalesce(cs.sort_order, 0),
        coalesce((select max(s2.sort_order) from application_events e join recruitment_stages s2 on s2.id = e.to_stage_id where e.application_id = a.id), 0)
      )::int as max_order
      from applications a
      join recruitment_stages cs on cs.id = a.stage_id
      where a.tenant_id = ${ctx.tenantId} ${openingFilter}`);
    const orders = [...reachedRows].map((r) => Number(r.max_order));
    const funnel: FunnelRow[] = [];
    let prev: number | null = null;
    for (const s of stages) {
      const reached = orders.filter((o) => o >= s.sortOrder).length;
      funnel.push({ stageId: s.id, name: s.name, kind: s.kind, reached, conversion: prev == null ? null : prev === 0 ? null : reached / prev });
      prev = reached;
    }

    const [tth] = await tx.execute<{ median: string | null; avg: string | null; n: number }>(sql`
      select
        percentile_cont(0.5) within group (order by extract(epoch from (a.decided_at - a.applied_at)) / 86400)::numeric(10,1)::text as median,
        avg(extract(epoch from (a.decided_at - a.applied_at)) / 86400)::numeric(10,1)::text as avg,
        count(*)::int as n
      from applications a
      where a.tenant_id = ${ctx.tenantId} and a.status = 'hired' and a.decided_at is not null ${openingFilter}`);

    let offersStat: { accepted: number; declined: number; expired: number; rate: number | null } | null = null;
    if (canSeeOffers(ctx)) {
      const [o] = await tx.execute<{ accepted: number; declined: number; expired: number }>(sql`
        select
          count(*) filter (where status = 'accepted')::int as accepted,
          count(*) filter (where status = 'declined')::int as declined,
          count(*) filter (where status = 'expired')::int as expired
        from offers a where a.tenant_id = ${ctx.tenantId} ${openingFilter}`);
      const decided = (o?.accepted ?? 0) + (o?.declined ?? 0) + (o?.expired ?? 0);
      offersStat = { accepted: o?.accepted ?? 0, declined: o?.declined ?? 0, expired: o?.expired ?? 0, rate: decided ? (o?.accepted ?? 0) / decided : null };
    }

    const interviewOrder = stages.find((s) => s.kind === "interview")?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const sourceRows = await tx.execute<{ source: string; applications: number; interviewed: number; hired: number }>(sql`
      with reached as (
        select a.source, a.status,
          greatest(coalesce(cs.sort_order, 0),
            coalesce((select max(s2.sort_order) from application_events e join recruitment_stages s2 on s2.id = e.to_stage_id where e.application_id = a.id), 0)) as max_order
        from applications a join recruitment_stages cs on cs.id = a.stage_id
        where a.tenant_id = ${ctx.tenantId} ${openingFilter}
      )
      select source, count(*)::int as applications,
        count(*) filter (where max_order >= ${interviewOrder})::int as interviewed,
        count(*) filter (where status = 'hired')::int as hired
      from reached group by source order by count(*) desc`);
    const sources: SourceRow[] = [...sourceRows].map((r) => ({
      source: r.source,
      applications: r.applications,
      interviewed: r.interviewed,
      hired: r.hired,
      hireRate: r.applications ? r.hired / r.applications : null,
    }));

    return {
      funnel,
      totalApplications: orders.length,
      timeToHire: { medianDays: tth?.median ? Number(tth.median) : null, averageDays: tth?.avg ? Number(tth.avg) : null, hires: tth?.n ?? 0 },
      offers: offersStat,
      sources,
    };
  });
}
