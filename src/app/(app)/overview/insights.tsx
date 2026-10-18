import { format, startOfMonth, subMonths } from "date-fns";
import { Reveal } from "@/components/page";
import { StatTile } from "@/components/stat-tile";
import { ChartCard, Columns, GroupedColumns, HorizontalBars, TrendArea } from "@/components/charts";
import { can, requireContext } from "@/server/auth/context";
import {
  DEFINITIONS,
  departmentBreakdown,
  headcountTrend,
  payrollMetrics,
  recruitmentMetrics,
  talentMetrics,
  timeMetrics,
  workforceMetrics,
  type MetricFilters,
} from "@/server/services/analytics/metrics";
import { todayIn } from "@/lib/format";
import { PERIODS } from "@/lib/periods";
import { PeriodSelect } from "./period-select";

function periodFor(key: string, fyStartMonth: number): MetricFilters & { label: string } {
  const today = todayIn();
  const now = new Date(`${today}T00:00:00`);
  const label = PERIODS.find((p) => p.value === key)?.label ?? "Last 3 months";
  switch (key) {
    case "month":
      return { from: format(startOfMonth(now), "yyyy-MM-dd"), to: today, label };
    case "12m":
      return { from: format(startOfMonth(subMonths(now, 11)), "yyyy-MM-dd"), to: today, label };
    case "fy": {
      const m = now.getMonth() + 1;
      const y = m >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1;
      return { from: `${y}-${String(fyStartMonth).padStart(2, "0")}-01`, to: today, label };
    }
    default:
      return { from: format(startOfMonth(subMonths(now, 2)), "yyyy-MM-dd"), to: today, label: "Last 3 months" };
  }
}

/** Leadership and HR insights. Hidden entirely for people without org-wide visibility. */
export async function Insights({ searchParams }: { searchParams: PageProps<"/overview">["searchParams"] }) {
  const ctx = await requireContext();
  const exec = can(ctx, "analytics.executive", "all") || can(ctx, "employees.view", "all");
  if (!exec) return null;
  const sp = await searchParams;
  const period = periodFor(typeof sp.period === "string" ? sp.period : "3m", 4);

  const [workforce, trend, departments, recruitment, payroll, time, talent] = await Promise.all([
    workforceMetrics(ctx, period),
    headcountTrend(ctx, {}, 12),
    departmentBreakdown(ctx, {}),
    recruitmentMetrics(ctx, period),
    payrollMetrics(ctx, { ...period, from: format(startOfMonth(subMonths(new Date(), 11)), "yyyy-MM-dd") }),
    timeMetrics(ctx, period),
    talentMetrics(ctx, period),
  ]);

  return (
    <Reveal className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">People insights</h2>
          <p className="text-xs text-muted-foreground">
            {period.label} · {period.from} to {period.to}. Hover a metric for its definition.
          </p>
        </div>
        <PeriodSelect />
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Headcount" metric={workforce.headcount} href="/employees" />
        <StatTile label="New hires" metric={workforce.newHires} href="/employees?joined=last-30-days" />
        <StatTile label="Exits" metric={workforce.exits} href="/employees?status=exited" />
        <StatTile label="Turnover" metric={workforce.turnoverRate} />
        <StatTile label="Open positions" metric={workforce.openPositions} href="/organization?tab=positions" />
        <StatTile label="Time to hire" metric={recruitment.timeToHireDays} href="/recruitment" />
        <StatTile label="Offer acceptance" metric={recruitment.offerAcceptance} href="/recruitment" />
        <StatTile label="Absenteeism" metric={time.absenteeism} href="/attendance" />
        <StatTile label="Leave per employee" metric={time.leaveUtilization} href="/leave" />
        <StatTile label="Review completion" metric={talent.reviewCompletion} href="/performance" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard
          title="Headcount"
          description="Month-end headcount, last 12 months"
          definition={DEFINITIONS.headcount}
          columns={[
            { key: "month", label: "Month" },
            { key: "headcount", label: "Headcount" },
          ]}
          rows={trend ?? []}
        >
          <TrendArea data={trend ?? []} valueKey="headcount" label="Headcount" />
        </ChartCard>
        <ChartCard
          title="Hires and exits"
          description="By month, last 12 months"
          definition={`${DEFINITIONS.newHires} ${DEFINITIONS.exits}`}
          columns={[
            { key: "month", label: "Month" },
            { key: "hires", label: "Hires" },
            { key: "exits", label: "Exits" },
          ]}
          rows={trend ?? []}
        >
          <GroupedColumns
            data={trend ?? []}
            series={[
              { key: "hires", label: "Hires", color: "var(--chart-1)" },
              { key: "exits", label: "Exits", color: "var(--chart-2)" },
            ]}
          />
        </ChartCard>
        <ChartCard
          title="Headcount by department"
          description="Active and on notice, today"
          columns={[
            { key: "department", label: "Department" },
            { key: "headcount", label: "Headcount" },
          ]}
          rows={departments ?? []}
        >
          <HorizontalBars data={departments ?? []} categoryKey="department" valueKey="headcount" label="Headcount" />
        </ChartCard>
        {recruitment.funnel ? (
          <ChartCard
            title="Recruitment funnel"
            description={`Applications by current stage, ${period.label.toLowerCase()}`}
            columns={[
              { key: "stage", label: "Stage" },
              { key: "applications", label: "Applications" },
            ]}
            rows={recruitment.funnel.filter((f) => f.applications > 0).length ? recruitment.funnel : []}
          >
            <HorizontalBars data={recruitment.funnel} categoryKey="stage" valueKey="applications" label="Applications" />
          </ChartCard>
        ) : null}
        {payroll.byMonth ? (
          <ChartCard
            title="Payroll cost"
            description="Gross plus employer contributions of locked runs, last 12 months"
            definition={DEFINITIONS.payrollCost}
            columns={[
              { key: "month", label: "Month" },
              { key: "cost", label: "Cost", format: "inr" },
            ]}
            rows={payroll.byMonth}
          >
            <Columns data={payroll.byMonth} valueKey="cost" label="Payroll cost" valueFormat="inr" />
          </ChartCard>
        ) : null}
      </div>
    </Reveal>
  );
}
