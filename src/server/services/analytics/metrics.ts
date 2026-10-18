import { sql, type SQL } from "drizzle-orm";
import { format, startOfMonth, subMonths, endOfMonth } from "date-fns";
import { can, type RequestContext } from "../../auth/context";
import type { Tx } from "../../db/client";

/**
 * Workforce and operations metrics. Every metric has a written definition
 * (also in docs/METRICS.md), an explicit period and filters, and is computed
 * from source tables at request time. When the viewer lacks access to the
 * underlying data, the metric is returned as `restricted` rather than as a
 * misleading zero.
 */

export type MetricFilters = {
  from: string; // yyyy-MM-dd inclusive
  to: string; // yyyy-MM-dd inclusive
  departmentId?: string | null;
  locationId?: string | null;
  legalEntityId?: string | null;
};

export type MetricValue =
  | { kind: "value"; value: number | null; unit: "count" | "percent" | "days" | "hours" | "inr_paise" | "score"; definition: string }
  | { kind: "restricted"; definition: string };

const restricted = (definition: string): MetricValue => ({ kind: "restricted", definition });
const value = (v: number | null, unit: Extract<MetricValue, { kind: "value" }>["unit"], definition: string): MetricValue => ({ kind: "value", value: v, unit, definition });

/** Employee-level filter fragment (alias e). */
function empFilter(f: MetricFilters): SQL {
  const parts: SQL[] = [sql`e.deleted_at is null`];
  if (f.departmentId) parts.push(sql`e.department_id = ${f.departmentId}`);
  if (f.locationId) parts.push(sql`e.location_id = ${f.locationId}`);
  if (f.legalEntityId) parts.push(sql`e.legal_entity_id = ${f.legalEntityId}`);
  return sql.join(parts, sql` and `);
}

async function one<T extends Record<string, unknown>>(tx: Tx, q: SQL): Promise<T> {
  const rows = await tx.execute<T>(q);
  return rows[0] as T;
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export const DEFINITIONS = {
  headcount: "Employees in status active or on notice who had joined on or before the period end and had not exited by then.",
  newHires: "Employees whose joining date falls within the period (excluding pre-joining records).",
  exits: "Employees whose exit date falls within the period.",
  turnoverRate: "Exits in the period ÷ average of headcount at period start and period end.",
  headcountGrowth: "(Headcount at period end − headcount at period start) ÷ headcount at period start.",
  openPositions: "Positions currently in status open.",
  openOpenings: "Job openings currently published.",
  timeToHire: "Median days from application to offer acceptance, for offers accepted in the period.",
  offerAcceptance: "Offers accepted ÷ offers accepted, declined or expired, decided in the period.",
  payrollCost: "Gross earnings plus employer contributions of locked, disbursed or published regular and adjustment runs whose period ends within the date range.",
  absenteeism: "Absent days ÷ scheduled working days (present, half day, absent, missing punch, on leave) in attendance records for the period.",
  leaveUtilization: "Approved leave days taken in the period ÷ average headcount.",
  overtimeHours: "Sum of overtime minutes in attendance records for the period, in hours.",
  reviewCompletion: "Submitted, shared or acknowledged reviews ÷ all reviews in cycles active during the period.",
  learningCompletion: "Enrollments completed in the period ÷ enrollments due in the period.",
  enps: "Employee Net Promoter Score of the most recent closed survey with an eNPS question and enough responses (% promoters 9–10 minus % detractors 0–6).",
  ticketResolution: "Median hours from ticket creation to resolution, for tickets resolved in the period.",
  ticketVolume: "HR tickets created in the period.",
} as const;

/** Headcount at a date under the definition above. */
async function headcountAt(tx: Tx, f: MetricFilters, date: string) {
  const r = await one<{ n: number }>(
    tx,
    sql`select count(*)::int as n from employees e
        where ${empFilter(f)} and e.joining_date <= ${date}
          and e.status <> 'pending'
          and (e.exit_date is null or e.exit_date > ${date})`,
  );
  return r.n;
}

export async function workforceMetrics(ctx: RequestContext, f: MetricFilters) {
  if (!can(ctx, "employees.view", "all") && !can(ctx, "analytics.executive", "all")) {
    return {
      headcount: restricted(DEFINITIONS.headcount),
      newHires: restricted(DEFINITIONS.newHires),
      exits: restricted(DEFINITIONS.exits),
      turnoverRate: restricted(DEFINITIONS.turnoverRate),
      headcountGrowth: restricted(DEFINITIONS.headcountGrowth),
      openPositions: restricted(DEFINITIONS.openPositions),
    };
  }
  return ctx.db(async (tx) => {
    const [start, end, flows, positions] = await Promise.all([
      headcountAt(tx, f, f.from),
      headcountAt(tx, f, f.to),
      one<{ hires: number; exits: number }>(
        tx,
        sql`select
              count(*) filter (where e.joining_date between ${f.from} and ${f.to} and e.status <> 'pending')::int as hires,
              count(*) filter (where e.exit_date between ${f.from} and ${f.to})::int as exits
            from employees e where ${empFilter(f)}`,
      ),
      one<{ n: number }>(tx, sql`select count(*)::int as n from positions where status = 'open'`),
    ]);
    const avg = (start + end) / 2;
    return {
      headcount: value(end, "count", DEFINITIONS.headcount),
      newHires: value(flows.hires, "count", DEFINITIONS.newHires),
      exits: value(flows.exits, "count", DEFINITIONS.exits),
      turnoverRate: value(avg > 0 ? flows.exits / avg : null, "percent", DEFINITIONS.turnoverRate),
      headcountGrowth: value(start > 0 ? (end - start) / start : null, "percent", DEFINITIONS.headcountGrowth),
      openPositions: value(positions.n, "count", DEFINITIONS.openPositions),
    };
  });
}

/** Month-end headcount, hires and exits for the last N months (trend chart). */
export async function headcountTrend(ctx: RequestContext, f: Omit<MetricFilters, "from" | "to">, months = 12) {
  if (!can(ctx, "employees.view", "all") && !can(ctx, "analytics.executive", "all")) return null;
  const end = endOfMonth(new Date());
  const start = startOfMonth(subMonths(end, months - 1));
  return ctx.db(async (tx) => {
    const rows = await tx.execute<{ month: string; headcount: number; hires: number; exits: number }>(sql`
      with m as (
        select generate_series(${format(start, "yyyy-MM-dd")}::date, ${format(end, "yyyy-MM-dd")}::date, interval '1 month')::date as month_start
      )
      select to_char(m.month_start, 'YYYY-MM') as month,
        (select count(*) from employees e where ${empFilter({ ...f, from: "", to: "" })}
           and e.status <> 'pending' and e.joining_date <= (m.month_start + interval '1 month - 1 day')::date
           and (e.exit_date is null or e.exit_date > (m.month_start + interval '1 month - 1 day')::date))::int as headcount,
        (select count(*) from employees e where ${empFilter({ ...f, from: "", to: "" })}
           and e.status <> 'pending' and date_trunc('month', e.joining_date) = m.month_start)::int as hires,
        (select count(*) from employees e where ${empFilter({ ...f, from: "", to: "" })}
           and date_trunc('month', e.exit_date) = m.month_start)::int as exits
      from m order by m.month_start`);
    return [...rows];
  });
}

export async function departmentBreakdown(ctx: RequestContext, f: Omit<MetricFilters, "from" | "to">) {
  if (!can(ctx, "employees.view", "all") && !can(ctx, "analytics.executive", "all")) return null;
  return ctx.db(async (tx) => {
    const rows = await tx.execute<{ department: string; headcount: number }>(sql`
      select coalesce(d.name, 'Unassigned') as department, count(*)::int as headcount
      from employees e left join departments d on d.id = e.department_id
      where ${empFilter({ ...f, from: "", to: "" })} and e.status in ('active','on_notice')
      group by 1 order by 2 desc limit 12`);
    return [...rows];
  });
}

export async function recruitmentMetrics(ctx: RequestContext, f: MetricFilters) {
  if (!can(ctx, "recruitment.view", "all") && !can(ctx, "analytics.executive", "all")) {
    return {
      openOpenings: restricted(DEFINITIONS.openOpenings),
      timeToHireDays: restricted(DEFINITIONS.timeToHire),
      offerAcceptance: restricted(DEFINITIONS.offerAcceptance),
      funnel: null,
    };
  }
  return ctx.db(async (tx) => {
    const [openings, tth, funnel] = await Promise.all([
      one<{ n: number }>(tx, sql`select count(*)::int as n from job_openings where status = 'published'`),
      one<{ median: number | null }>(
        tx,
        sql`select percentile_cont(0.5) within group (order by extract(epoch from (o.responded_at - a.applied_at)) / 86400.0) as median
            from offers o join applications a on a.id = o.application_id
            where o.status = 'accepted' and o.responded_at::date between ${f.from} and ${f.to}`,
      ),
      tx.execute<{ stage: string; kind: string; sort_order: number; applications: number }>(
        sql`select s.name as stage, s.kind, s.sort_order, count(a.id)::int as applications
            from recruitment_stages s
            left join applications a on a.stage_id = s.id and a.applied_at::date between ${f.from} and ${f.to}
            where s.is_active
            group by s.id order by s.sort_order`,
      ),
    ]);
    // Offer acceptance needs offer visibility (RLS restricts offers to recruiters and approvers).
    let acceptance: MetricValue = restricted(DEFINITIONS.offerAcceptance);
    if (can(ctx, "offers.manage", "all") || can(ctx, "offers.approve", "all") || can(ctx, "recruitment.manage", "all")) {
      const r = await one<{ accepted: number; decided: number }>(
        tx,
        sql`select count(*) filter (where status = 'accepted')::int as accepted,
                   count(*) filter (where status in ('accepted','declined','expired'))::int as decided
            from offers where coalesce(responded_at, updated_at)::date between ${f.from} and ${f.to}`,
      );
      acceptance = value(r.decided ? r.accepted / r.decided : null, "percent", DEFINITIONS.offerAcceptance);
    }
    return {
      openOpenings: value(openings.n, "count", DEFINITIONS.openOpenings),
      timeToHireDays: value(n(tth.median), "days", DEFINITIONS.timeToHire),
      offerAcceptance: acceptance,
      funnel: [...funnel].map((r) => ({ stage: r.stage, kind: r.kind, applications: r.applications })),
    };
  });
}

export async function payrollMetrics(ctx: RequestContext, f: MetricFilters) {
  if (!can(ctx, "payroll.view", "all") && !can(ctx, "payroll.approve", "all")) return { payrollCost: restricted(DEFINITIONS.payrollCost), byMonth: null };
  return ctx.db(async (tx) => {
    const rows = await tx.execute<{ month: string; cost: number }>(sql`
      select to_char(p.end_date, 'YYYY-MM') as month,
        coalesce(sum(re.gross_earnings + re.employer_contributions), 0)::bigint as cost
      from payroll_runs r
      join payroll_periods p on p.id = r.period_id
      join payroll_run_employees re on re.run_id = r.id
      where r.status in ('locked','disbursed','published') and r.kind in ('regular','adjustment')
        and p.end_date between ${f.from} and ${f.to}
        ${f.legalEntityId ? sql`and r.legal_entity_id = ${f.legalEntityId}` : sql``}
      group by 1 order by 1`);
    const list = [...rows].map((r) => ({ month: r.month, cost: Number(r.cost) }));
    return { payrollCost: value(list.reduce((s, r) => s + r.cost, 0), "inr_paise", DEFINITIONS.payrollCost), byMonth: list };
  });
}

export async function timeMetrics(ctx: RequestContext, f: MetricFilters) {
  if (!can(ctx, "attendance.view", "all") && !can(ctx, "analytics.executive", "all")) {
    return { absenteeism: restricted(DEFINITIONS.absenteeism), leaveUtilization: restricted(DEFINITIONS.leaveUtilization), overtimeHours: restricted(DEFINITIONS.overtimeHours) };
  }
  return ctx.db(async (tx) => {
    const [att, leave, hc] = await Promise.all([
      one<{ absent: number; scheduled: number; ot: number }>(
        tx,
        sql`select count(*) filter (where ad.status = 'absent')::int as absent,
                   count(*) filter (where ad.status in ('present','half_day','absent','missing_punch','on_leave'))::int as scheduled,
                   coalesce(sum(ad.overtime_minutes), 0)::int as ot
            from attendance_days ad join employees e on e.id = ad.employee_id
            where ${empFilter(f)} and ad.date between ${f.from} and ${f.to}`,
      ),
      one<{ days: number | null }>(
        tx,
        sql`select coalesce(sum(lr.days), 0) as days from leave_requests lr join employees e on e.id = lr.employee_id
            where ${empFilter(f)} and lr.status = 'approved' and lr.start_date between ${f.from} and ${f.to}`,
      ),
      Promise.all([headcountAt(tx, f, f.from), headcountAt(tx, f, f.to)]),
    ]);
    const avgHc = (hc[0] + hc[1]) / 2;
    return {
      absenteeism: value(att.scheduled ? att.absent / att.scheduled : null, "percent", DEFINITIONS.absenteeism),
      leaveUtilization: value(avgHc ? Number(leave.days ?? 0) / avgHc : null, "days", DEFINITIONS.leaveUtilization),
      overtimeHours: value(att.ot / 60, "hours", DEFINITIONS.overtimeHours),
    };
  });
}

export async function talentMetrics(ctx: RequestContext, f: MetricFilters) {
  const canPerf = can(ctx, "performance.manage", "all") || can(ctx, "analytics.executive", "all");
  const canLearn = can(ctx, "learning.manage", "all") || can(ctx, "analytics.executive", "all");
  const canEng = can(ctx, "engagement.results", "all");
  return ctx.db(async (tx) => {
    const review = canPerf
      ? await one<{ done: number; total: number }>(
          tx,
          sql`select count(*) filter (where r.status in ('submitted','shared','acknowledged'))::int as done, count(*)::int as total
              from reviews r join review_cycles c on c.id = r.cycle_id
              where c.status in ('active','calibration','closed') and c.period_end >= ${f.from} and c.period_start <= ${f.to}`,
        )
      : null;
    const learning = canLearn
      ? await one<{ done: number; due: number }>(
          tx,
          sql`select count(*) filter (where status = 'completed' and completed_at::date between ${f.from} and ${f.to})::int as done,
                     count(*) filter (where due_on between ${f.from} and ${f.to})::int as due
              from learning_enrollments`,
        )
      : null;
    let enps: MetricValue = restricted(DEFINITIONS.enps);
    if (canEng) {
      const r = await one<{ score: number | null; responses: number; min_group: number }>(
        tx,
        sql`with s as (
              select id, min_group_size, (select q->>'id' from jsonb_array_elements(questions) q where q->>'type' = 'enps' limit 1) as qid
              from surveys where status = 'closed' order by closes_on desc nulls last limit 1
            )
            select
              case when count(*) = 0 then null else
                100.0 * (count(*) filter (where (sr.answers->>s.qid)::int >= 9) - count(*) filter (where (sr.answers->>s.qid)::int <= 6)) / count(*) end as score,
              count(*)::int as responses, max(s.min_group_size)::int as min_group
            from s join survey_responses sr on sr.survey_id = s.id
            where s.qid is not null and sr.answers ? s.qid`,
      );
      enps = r && r.responses >= (r.min_group ?? 5) ? value(n(r.score), "score", DEFINITIONS.enps) : value(null, "score", DEFINITIONS.enps);
    }
    return {
      reviewCompletion: review ? value(review.total ? review.done / review.total : null, "percent", DEFINITIONS.reviewCompletion) : restricted(DEFINITIONS.reviewCompletion),
      learningCompletion: learning ? value(learning.due ? Math.min(1, learning.done / learning.due) : null, "percent", DEFINITIONS.learningCompletion) : restricted(DEFINITIONS.learningCompletion),
      enps,
    };
  });
}

export async function serviceMetrics(ctx: RequestContext, f: MetricFilters) {
  if (!can(ctx, "helpdesk.manage", "all") && !can(ctx, "helpdesk.agent", "all") && !can(ctx, "analytics.executive", "all")) {
    return { ticketVolume: restricted(DEFINITIONS.ticketVolume), resolutionHours: restricted(DEFINITIONS.ticketResolution) };
  }
  return ctx.db(async (tx) => {
    const r = await one<{ opened: number; median: number | null }>(
      tx,
      sql`select count(*) filter (where created_at::date between ${f.from} and ${f.to})::int as opened,
                 percentile_cont(0.5) within group (order by extract(epoch from (resolved_at - created_at)) / 3600.0)
                   filter (where resolved_at::date between ${f.from} and ${f.to}) as median
          from tickets`,
    );
    return { ticketVolume: value(r.opened, "count", DEFINITIONS.ticketVolume), resolutionHours: value(n(r.median), "hours", DEFINITIONS.ticketResolution) };
  });
}

export function defaultPeriod(): MetricFilters {
  const now = new Date();
  return { from: format(startOfMonth(subMonths(now, 2)), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") };
}
