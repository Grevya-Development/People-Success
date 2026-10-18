import { sql } from "drizzle-orm";
import { can, type RequestContext } from "../../auth/context";
import { forbidden } from "../../lib/errors";
import { shiftDate } from "./shared";
import { todayIn } from "@/lib/format";

export type ExitInsights = {
  windowFrom: string;
  totalExits: number;
  voluntary: number;
  involuntary: number;
  reasons: { reason: string; count: number }[];
  byMonth: { month: string; count: number }[];
  regretted: { regretted: number; nonRegretted: number; unknown: number };
  averageNoticeServedDays: number | null;
  averageNoticePeriodDays: number | null;
  openExits: number;
};

export type OnboardingInsights = {
  activePlans: number;
  completedPlans: number;
  averageCompletionDays: number | null;
  overdueTasks: number;
  onTimeRate: number | null;
  slowestTasks: { title: string; overdue: number }[];
};

const VOLUNTARY = ["resignation", "retirement", "mutual_separation"];

/** Exit analytics over the last 12 months (completed exits; reasons also include accepted ones). */
export async function exitInsights(ctx: RequestContext): Promise<ExitInsights> {
  if (!can(ctx, "exits.manage", "all")) throw forbidden();
  const from = shiftDate(todayIn(), -365);
  return ctx.db(async (tx) => {
    const lwd = sql`coalesce(e.approved_last_working_date, e.requested_last_working_date)`;
    const [totals] = await tx.execute<{ total: number; voluntary: number; open: number; served: string | null; notice: string | null }>(sql`
      select
        count(*) filter (where e.status = 'completed')::int as total,
        count(*) filter (where e.status = 'completed' and e.type in (${sql.join(VOLUNTARY.map((v) => sql`${v}`), sql`, `)}))::int as voluntary,
        (select count(*)::int from exit_cases o where o.status in ('submitted','under_review','accepted','in_progress')) as open,
        avg((${lwd}) - e.submitted_on) filter (where e.status = 'completed' and e.type = 'resignation') as served,
        avg(e.notice_period_days) filter (where e.status = 'completed' and e.type = 'resignation') as notice
      from exit_cases e
      where e.status = 'completed' and ${lwd} >= ${from}::date
    `);
    const reasons = await tx.execute<{ reason: string; count: number }>(sql`
      select coalesce(e.exit_interview->>'primaryReason', e.reason_category, 'unspecified') as reason, count(*)::int as count
      from exit_cases e
      where e.status in ('accepted','in_progress','completed') and ${lwd} >= ${from}::date
      group by 1 order by 2 desc, 1 asc
    `);
    const byMonth = await tx.execute<{ month: string; count: number }>(sql`
      select to_char(date_trunc('month', ${lwd}), 'YYYY-MM') as month, count(*)::int as count
      from exit_cases e
      where e.status = 'completed' and ${lwd} >= ${from}::date
      group by 1 order by 1
    `);
    const [reg] = await tx.execute<{ regretted: number; non: number; unknown: number }>(sql`
      select
        count(*) filter (where (e.exit_interview->>'regretted')::boolean is true)::int as regretted,
        count(*) filter (where (e.exit_interview->>'regretted')::boolean is false)::int as non,
        count(*) filter (where e.exit_interview is null or e.exit_interview->>'regretted' is null)::int as unknown
      from exit_cases e
      where e.status in ('accepted','in_progress','completed') and ${lwd} >= ${from}::date
    `);
    // Fill empty months so the trend reads correctly.
    const months: { month: string; count: number }[] = [];
    const counts = new Map(byMonth.map((r) => [r.month, Number(r.count)]));
    const start = new Date(`${todayIn().slice(0, 7)}-01T00:00:00Z`);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      months.push({ month: key, count: counts.get(key) ?? 0 });
    }
    const total = Number(totals?.total ?? 0);
    const voluntary = Number(totals?.voluntary ?? 0);
    return {
      windowFrom: from,
      totalExits: total,
      voluntary,
      involuntary: total - voluntary,
      reasons: reasons.map((r) => ({ reason: r.reason, count: Number(r.count) })),
      byMonth: months,
      regretted: { regretted: Number(reg?.regretted ?? 0), nonRegretted: Number(reg?.non ?? 0), unknown: Number(reg?.unknown ?? 0) },
      averageNoticeServedDays: totals?.served != null ? Math.round(Number(totals.served)) : null,
      averageNoticePeriodDays: totals?.notice != null ? Math.round(Number(totals.notice)) : null,
      openExits: Number(totals?.open ?? 0),
    };
  });
}

export async function onboardingInsights(ctx: RequestContext): Promise<OnboardingInsights> {
  if (!can(ctx, "onboarding.manage", "all")) throw forbidden();
  const today = todayIn();
  return ctx.db(async (tx) => {
    const [plans] = await tx.execute<{ active: number; completed: number; avg_days: string | null }>(sql`
      select
        count(*) filter (where status in ('not_started','in_progress'))::int as active,
        count(*) filter (where status = 'completed')::int as completed,
        avg(extract(epoch from (completed_at - created_at)) / 86400) filter (where status = 'completed') as avg_days
      from lifecycle_plans where kind = 'onboarding'
    `);
    const [taskStats] = await tx.execute<{ overdue: number; on_time: number; done_with_due: number }>(sql`
      select
        count(*) filter (where t.status in ('open','in_progress','blocked') and t.due_on < ${today}::date)::int as overdue,
        count(*) filter (where t.status = 'done' and t.due_on is not null and (t.completed_at at time zone 'Asia/Kolkata')::date <= t.due_on)::int as on_time,
        count(*) filter (where t.status = 'done' and t.due_on is not null)::int as done_with_due
      from tasks t join lifecycle_plans p on p.id = t.container_id
      where t.container_type = 'lifecycle_plan' and p.kind = 'onboarding' and p.status <> 'cancelled'
    `);
    const slowest = await tx.execute<{ title: string; overdue: number }>(sql`
      select t.title, count(*)::int as overdue
      from tasks t join lifecycle_plans p on p.id = t.container_id
      where t.container_type = 'lifecycle_plan' and p.kind = 'onboarding' and p.status in ('not_started','in_progress')
        and t.status in ('open','in_progress','blocked') and t.due_on < ${today}::date
      group by t.title order by 2 desc, 1 asc limit 5
    `);
    const doneWithDue = Number(taskStats?.done_with_due ?? 0);
    return {
      activePlans: Number(plans?.active ?? 0),
      completedPlans: Number(plans?.completed ?? 0),
      averageCompletionDays: plans?.avg_days != null ? Math.round(Number(plans.avg_days) * 10) / 10 : null,
      overdueTasks: Number(taskStats?.overdue ?? 0),
      onTimeRate: doneWithDue ? Number(taskStats.on_time) / doneWithDue : null,
      slowestTasks: slowest.map((s) => ({ title: s.title, overdue: Number(s.overdue) })),
    };
  });
}
