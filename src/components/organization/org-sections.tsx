import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { ArrowRight, Building, GitBranch, Network, Users } from "lucide-react";
import { EmptyState, ErrorState, Reveal, Section } from "@/components/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import type { RequestContext } from "@/server/auth/context";
import { logger } from "@/server/lib/logger";
import {
  SPAN_WIDE,
  canSeeOrgChanges,
  listDepartments,
  orgChart,
  recentOrgChanges,
  spanOfControl,
} from "@/server/services/organization/structure";
import {
  canManagePositions,
  canSeeBudgets,
  listPositions,
  positionLookups,
  workforcePlan,
} from "@/server/services/organization/positions";
import { formatDate, formatMoney, formatNumber, titleCase } from "@/lib/format";
import { OrgChart } from "./org-chart";
import { PositionsTable } from "./positions-table";

function failed(event: string, err: unknown, title: string) {
  unstable_rethrow(err);
  logger.error(event, { err });
  return <ErrorState title={title} />;
}

export async function OrgChartSection({ ctx }: { ctx: RequestContext }) {
  let nodes;
  try {
    nodes = await orgChart(ctx);
  } catch (err) {
    return failed("organization.chart_failed", err, "Could not load the org chart");
  }
  if (!nodes.length) {
    return (
      <EmptyState
        icon={Network}
        title="No one in the org chart yet"
        description="Add employees and set their reporting managers to see the reporting structure here."
      />
    );
  }
  return (
    <Reveal>
      <OrgChart nodes={nodes} />
    </Reveal>
  );
}

export async function DepartmentsSection({ ctx }: { ctx: RequestContext }) {
  let rows;
  try {
    rows = await listDepartments(ctx);
  } catch (err) {
    return failed("organization.departments_failed", err, "Could not load departments");
  }
  const total = rows.reduce((s, r) => s + r.headcount, 0);
  return (
    <Reveal>
      <Section title="Departments" description={`${rows.length} departments · ${formatNumber(total)} active employees assigned`}>
        {rows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Department</TableHead>
                <TableHead>Parent</TableHead>
                <TableHead>Head</TableHead>
                <TableHead className="text-right">Headcount</TableHead>
                <TableHead className="pr-5">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="pl-5">
                    <span className="font-medium">{d.name}</span>
                    {d.code ? <span className="ml-2 text-xs text-muted-foreground tabular">{d.code}</span> : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{d.parentName ?? "—"}</TableCell>
                  <TableCell>
                    {d.headId && d.headName ? (
                      <Link href={`/employees/${d.headId}`} className="hover:underline">
                        {d.headName}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Not set</span>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right">{formatNumber(d.headcount)}</TableCell>
                  <TableCell className="pr-5">
                    <StatusBadge status={d.isActive ? "active" : "closed"} label={d.isActive ? "Active" : "Inactive"} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={Building}
              title="No departments yet"
              description="Departments are set up by administrators under Settings."
              className="border-0"
            />
          </div>
        )}
      </Section>
    </Reveal>
  );
}

export async function PositionsSection({ ctx }: { ctx: RequestContext }) {
  let data;
  try {
    const manage = canManagePositions(ctx);
    const [rows, lookups] = await Promise.all([listPositions(ctx), manage ? positionLookups(ctx) : Promise.resolve(null)]);
    data = { rows, lookups };
  } catch (err) {
    return failed("organization.positions_failed", err, "Could not load positions");
  }
  return (
    <Reveal>
      <PositionsTable
        rows={data.rows.map((r) => ({
          id: r.id,
          code: r.code,
          title: r.title,
          status: r.status,
          departmentId: r.departmentId,
          locationId: r.locationId,
          designationId: r.designationId,
          legalEntityId: r.legalEntityId,
          costCenterId: r.costCenterId,
          reportsToPositionId: r.reportsToPositionId,
          employeeId: r.employeeId,
          budgetedAnnualCtc: r.budgetedAnnualCtc,
          department: r.department,
          location: r.location,
          designation: r.designation,
          reportsTo: r.reportsTo,
          incumbent: r.incumbent,
          currency: r.currency,
        }))}
        lookups={data.lookups}
        showBudget={canSeeBudgets(ctx)}
      />
    </Reveal>
  );
}

const CHANGE_LABELS: Record<string, string> = {
  transfer: "Transfer",
  promotion: "Promotion",
  manager_change: "Manager change",
  designation_change: "Designation change",
};

function change(from: string | null, to: string | null) {
  if ((from ?? null) === (to ?? null)) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="text-muted-foreground">{from ?? "None"}</span>
      <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
      <span>{to ?? "None"}</span>
    </span>
  );
}

export async function InsightsSection({ ctx }: { ctx: RequestContext }) {
  let data;
  try {
    const [plan, span, changes] = await Promise.all([workforcePlan(ctx), spanOfControl(ctx), recentOrgChanges(ctx)]);
    data = { plan, span, changes };
  } catch (err) {
    return failed("organization.insights_failed", err, "Could not load insights");
  }
  const { plan, span, changes } = data;
  const showBudget = canSeeBudgets(ctx);
  const wide = span.filter((s) => s.flag === "wide");
  const narrow = span.filter((s) => s.flag === "narrow");
  const avg = span.length ? span.reduce((s, r) => s + r.directReports, 0) / span.length : null;
  const totals = plan.reduce(
    (t, r) => ({ approved: t.approved + r.approved, filled: t.filled + r.filled, open: t.open + r.open, budget: t.budget + (r.budgetTotal ?? 0) }),
    { approved: 0, filled: 0, open: 0, budget: 0 },
  );

  return (
    <Reveal className="space-y-5">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
        <Stat label="Approved positions" value={formatNumber(totals.approved)} hint="Planned, open and filled" />
        <Stat label="Open vacancies" value={formatNumber(totals.open)} />
        <Stat label="Managers" value={formatNumber(span.length)} hint={avg != null ? `Average span ${avg.toFixed(1)}` : undefined} />
        <Stat label="Spans to review" value={formatNumber(wide.length + narrow.length)} hint={`Over ${SPAN_WIDE} or exactly 1 report`} />
      </div>

      <Section title="Workforce plan" description="Positions against current headcount, by department.">
        {plan.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Department</TableHead>
                <TableHead className="text-right">Approved</TableHead>
                <TableHead className="text-right">Filled</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">Planned</TableHead>
                <TableHead className="text-right">Frozen</TableHead>
                <TableHead className={showBudget ? "text-right" : "pr-5 text-right"}>Headcount</TableHead>
                {showBudget ? <TableHead className="pr-5 text-right">Budget (annual)</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.map((r) => (
                <TableRow key={r.departmentId ?? "none"}>
                  <TableCell className="pl-5 font-medium">{r.department}</TableCell>
                  <TableCell className="tabular text-right">{r.approved}</TableCell>
                  <TableCell className="tabular text-right">{r.filled}</TableCell>
                  <TableCell className="tabular text-right">{r.open ? <span className="font-medium text-info">{r.open}</span> : 0}</TableCell>
                  <TableCell className="tabular text-right">{r.planned}</TableCell>
                  <TableCell className="tabular text-right">{r.frozen}</TableCell>
                  <TableCell className={showBudget ? "tabular text-right" : "tabular pr-5 text-right"}>{r.headcount}</TableCell>
                  {showBudget ? <TableCell className="tabular pr-5 text-right">{formatMoney(r.budgetTotal, "INR", { compact: true })}</TableCell> : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState icon={Users} title="Nothing to plan yet" description="Create positions or add employees to departments to see the workforce plan." className="border-0" />
          </div>
        )}
        {showBudget && totals.budget ? (
          <p className="border-t px-5 py-2.5 text-xs text-muted-foreground">Total approved budget {formatMoney(totals.budget, "INR", { compact: true })} per year.</p>
        ) : null}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Span of control" description={`Managers with more than ${SPAN_WIDE} direct reports may be stretched; a single report may mean an extra layer.`}>
          {span.length ? (
            <ul className="divide-y">
              {span.slice(0, 25).map((s) => (
                <li key={s.managerId} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link href={`/employees/${s.managerId}`} className="block truncate font-medium hover:underline">
                      {s.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">{[s.designation, s.department].filter(Boolean).join(" · ") || "—"}</p>
                  </div>
                  {s.flag === "wide" ? <StatusBadge status="wide" tone="warning" label="Wide span" /> : null}
                  {s.flag === "narrow" ? <StatusBadge status="narrow" tone="info" label="Single report" /> : null}
                  <span className="tabular w-10 text-right font-medium">{s.directReports}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-5">
              <EmptyState icon={Network} title="No managers yet" description="Set reporting managers on employee profiles to analyse spans." className="border-0" />
            </div>
          )}
          {span.length > 25 ? <p className="border-t px-5 py-2.5 text-xs text-muted-foreground">Showing the 25 largest of {span.length} teams.</p> : null}
        </Section>

        <Section title="Recent organizational changes" description="Transfers, promotions and reporting changes.">
          {!canSeeOrgChanges(ctx) ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Visible to HR and organization administrators.</p>
          ) : changes.length ? (
            <ul className="divide-y">
              {changes.map((c) => (
                <li key={c.id} className="space-y-1 px-5 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/employees/${c.employeeId}`} className="font-medium hover:underline">
                      {c.employeeName}
                    </Link>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <StatusBadge status={c.changeType} tone="brand" label={CHANGE_LABELS[c.changeType] ?? titleCase(c.changeType)} />
                      <span className="tabular">{formatDate(c.effectiveFrom)}</span>
                    </span>
                  </div>
                  <div className="space-y-0.5 text-xs">
                    {change(c.fromDepartment, c.toDepartment) ? <div>Department: {change(c.fromDepartment, c.toDepartment)}</div> : null}
                    {change(c.fromDesignation, c.toDesignation) ? <div>Designation: {change(c.fromDesignation, c.toDesignation)}</div> : null}
                    {change(c.fromManager, c.toManager) ? <div>Manager: {change(c.fromManager, c.toManager)}</div> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-5">
              <EmptyState icon={GitBranch} title="No changes recorded" description="Job changes made from employee profiles appear here." className="border-0" />
            </div>
          )}
        </Section>
      </div>
    </Reveal>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-card p-5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-[26px] leading-none font-semibold tracking-tight tabular">{value}</p>
      {hint ? <p className="mt-2 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
