import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, ArrowRight, CalendarRange, FileText, Settings2 } from "lucide-react";
import { EmptyState, ErrorState, NoAccess, Page, PageHeader, Reveal, Section, StatGridSkeleton, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, requireContext, type RequestContext } from "@/server/auth/context";
import { listPeriods, type PeriodSummary } from "@/server/services/payroll/periods";
import { periodReadiness } from "@/server/services/payroll/readiness";
import { unverifiedRuleSetCount } from "@/server/services/payroll/rules";
import { payrollLookups } from "@/server/services/payroll/lookups";
import { isPayrollStaff } from "@/server/services/payroll/shared";
import { formatDate, formatMoney, todayIn } from "@/lib/format";
import { monthBounds } from "@/lib/payroll/dates";
import { OpenPeriodDialog } from "./_components/open-period-dialog";
import { PayrollTabs } from "./_components/payroll-tabs";
import { PeriodStatusBadge, RunStatusBadge } from "./_components/status";
import { StartRunButton } from "./_components/start-run-button";

export const metadata: Metadata = { title: "Payroll" };

export default function PayrollPage() {
  return (
    <Page>
      <PageHeader
        title="Payroll"
        description="Monthly payroll per legal entity: inputs, calculation, approval, lock, payment and payslips."
        actions={
          <Suspense fallback={<Skeleton className="h-8 w-56" />}>
            <HeaderActions />
          </Suspense>
        }
      />
      <Suspense
        fallback={
          <div className="space-y-6">
            <StatGridSkeleton />
            <TableSkeleton rows={4} columns={6} />
          </div>
        }
      >
        <Overview />
      </Suspense>
    </Page>
  );
}

async function HeaderActions() {
  const ctx = await requireContext();
  if (!isPayrollStaff(ctx)) return null;
  const canRun = can(ctx, "payroll.run", "all");
  const lookups = canRun ? await payrollLookups(ctx) : null;
  const [y, m] = todayIn().split("-").map(Number);
  const { end } = monthBounds(y, m);
  return (
    <>
      <Button variant="outline" size="sm" asChild>
        <Link href="/payroll/configuration">
          <Settings2 /> Configuration
        </Link>
      </Button>
      {lookups && lookups.legalEntities.length ? (
        <OpenPeriodDialog legalEntities={lookups.legalEntities} defaults={{ year: y, month: m, payDate: end, inputCutoffDate: `${end.slice(0, 8)}25` }} />
      ) : null}
    </>
  );
}

async function Overview() {
  const ctx = await requireContext();
  if (!isPayrollStaff(ctx)) {
    if (can(ctx, "payslips.view") && ctx.employeeId) {
      return (
        <EmptyState
          icon={FileText}
          title="Your payslips are in My payslips"
          description="Payroll processing is limited to the payroll team. Your published payslips and tax declaration are available to you."
          action={
            <Button size="sm" asChild>
              <Link href="/payroll/payslips">Open my payslips</Link>
            </Button>
          }
        />
      );
    }
    return <NoAccess />;
  }
  let periods: PeriodSummary[];
  let unverified = 0;
  try {
    [periods, unverified] = await Promise.all([listPeriods(ctx), unverifiedRuleSetCount(ctx)]);
  } catch {
    return <ErrorState />;
  }
  const current = periods.find((p) => p.status === "open") ?? periods[0] ?? null;
  return (
    <Reveal className="space-y-6">
      <PayrollTabs ctx={ctx} active="overview" />
      {unverified > 0 ? (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">
              {unverified} statutory rule set{unverified === 1 ? " is" : "s are"} unverified
            </p>
            <p className="text-muted-foreground">
              Default values are provided for convenience and may not be current. Payroll can be calculated, but locking a run that uses unverified rules needs an explicit override. Have a qualified payroll professional verify them first.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/payroll/configuration?tab=statutory">Review</Link>
          </Button>
        </div>
      ) : null}
      {current ? (
        <Suspense fallback={<Skeleton className="h-36 w-full rounded-xl" />}>
          <CurrentPeriod ctx={ctx} period={current} />
        </Suspense>
      ) : (
        <EmptyState
          icon={CalendarRange}
          title="No payroll periods yet"
          description={
            can(ctx, "payroll.config", "all")
              ? "Start by loading the standard components and statutory rule sets in Configuration, then open the first period."
              : "Open the first payroll period to start."
          }
          action={
            <Button size="sm" variant="outline" asChild>
              <Link href="/payroll/configuration">Go to configuration</Link>
            </Button>
          }
        />
      )}
      {periods.length ? <PeriodsTable periods={periods} /> : null}
    </Reveal>
  );
}

function nextStep(p: PeriodSummary): { label: string; href: string } | null {
  const r = p.regularRun;
  if (!r) return null;
  const href = `/payroll/runs/${r.id}`;
  switch (r.status) {
    case "draft":
      return { label: "Calculate", href };
    case "calculated":
      return { label: "Review and submit", href };
    case "pending_approval":
      return { label: "Track approval", href };
    case "approved":
      return { label: "Lock the run", href };
    case "locked":
    case "disbursed":
      return { label: "Pay and publish", href };
    default:
      return { label: "View run", href };
  }
}

async function CurrentPeriod({ ctx, period }: { ctx: RequestContext; period: PeriodSummary }) {
  let readiness: Awaited<ReturnType<typeof periodReadiness>> | null = null;
  try {
    readiness = await periodReadiness(ctx, period.id);
  } catch {
    readiness = null;
  }
  const next = nextStep(period);
  return (
    <Section
      title={
        <span className="flex flex-wrap items-center gap-2">
          {period.label} · {period.legalEntityName}
          <PeriodStatusBadge status={period.status} />
          {period.regularRun ? <RunStatusBadge status={period.regularRun.status} /> : null}
        </span>
      }
      description={`Pay date ${formatDate(period.payDate)} · input cutoff ${formatDate(period.inputCutoffDate)}`}
      actions={
        next ? (
          <Button size="sm" asChild>
            <Link href={next.href}>
              {next.label} <ArrowRight />
            </Link>
          </Button>
        ) : period.status === "open" && can(ctx, "payroll.run", "all") ? (
          <StartRunButton periodId={period.id} />
        ) : null
      }
    >
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        <Stat label="Employees in scope" value={readiness ? String(readiness.eligible) : "—"} />
        <Stat label="Blocking issues" value={readiness ? String(readiness.counts.error) : "—"} tone={readiness?.counts.error ? "danger" : undefined} />
        <Stat label="Warnings" value={readiness ? String(readiness.counts.warning) : "—"} tone={readiness?.counts.warning ? "warning" : undefined} />
        <Stat label="Net pay" value={period.regularRun?.totals ? formatMoney(period.regularRun.totals.net) : "—"} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-sm">
        <span className="text-muted-foreground">Readiness checks cover compensation, structures, bank details, PAN, joiners, exits, attendance and rule sets.</span>
        <Link href={`/payroll/periods/${period.id}`} className="font-medium text-brand hover:underline">
          View readiness and inputs
        </Link>
      </div>
    </Section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" | "warning" }) {
  return (
    <div className="bg-card px-5 py-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular ${tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : ""}`}>{value}</p>
    </div>
  );
}

function PeriodsTable({ periods }: { periods: PeriodSummary[] }) {
  return (
    <Section title="Periods">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">Period</TableHead>
              <TableHead>Legal entity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Regular run</TableHead>
              <TableHead className="text-right">Employees</TableHead>
              <TableHead className="text-right">Net pay</TableHead>
              <TableHead className="hidden md:table-cell">Pay date</TableHead>
              <TableHead className="pr-5 text-right">
                <span className="sr-only">Open</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {periods.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="pl-5 font-medium">
                  <Link href={`/payroll/periods/${p.id}`} className="hover:underline">
                    {p.label}
                  </Link>
                  {p.otherRuns ? <span className="ml-2 text-xs text-muted-foreground">+{p.otherRuns} other run{p.otherRuns === 1 ? "" : "s"}</span> : null}
                </TableCell>
                <TableCell>{p.legalEntityName}</TableCell>
                <TableCell>
                  <PeriodStatusBadge status={p.status} />
                </TableCell>
                <TableCell>{p.regularRun ? <RunStatusBadge status={p.regularRun.status} /> : <span className="text-muted-foreground">Not started</span>}</TableCell>
                <TableCell className="text-right tabular">{p.regularRun?.totals?.employees ?? "—"}</TableCell>
                <TableCell className="text-right tabular">{p.regularRun?.totals ? formatMoney(p.regularRun.totals.net) : "—"}</TableCell>
                <TableCell className="hidden md:table-cell">{formatDate(p.payDate)}</TableCell>
                <TableCell className="pr-5 text-right">
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={p.regularRun ? `/payroll/runs/${p.regularRun.id}` : `/payroll/periods/${p.id}`}>Open</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Section>
  );
}
