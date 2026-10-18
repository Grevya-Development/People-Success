import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, cache } from "react";
import { notFound } from "next/navigation";
import { AlertTriangle, Check, Download, Users } from "lucide-react";
import { cn } from "cn";
import { EmptyState, NoAccess, Page, PageHeader, Reveal, Section, StatGridSkeleton, TableSkeleton } from "@/components/page";
import { LinkTabs } from "@/components/documents/link-tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { can, requireContext, type RequestContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { getRunDetail, type RunEmployeeRow } from "@/server/services/payroll/runs";
import { runSummaries } from "@/server/services/payroll/reports";
import { isPayrollStaff } from "@/server/services/payroll/shared";
import { formatDateTime, formatMoney, titleCase } from "@/lib/format";
import { RUN_KIND_LABEL, RunStatusBadge } from "../../_components/status";
import { BankResponseDialog, RunActions } from "./run-actions";
import { ResultsTable } from "./results-table";
import { ExplainPanel } from "./explain-panel";

export const metadata: Metadata = { title: "Payroll run" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Detail = Awaited<ReturnType<typeof getRunDetail>>;
type Params = PageProps<"/payroll/runs/[id]">["params"];
type SearchParams = PageProps<"/payroll/runs/[id]">["searchParams"];

const load = cache(async (id: string) => {
  const ctx = await requireContext();
  if (!isPayrollStaff(ctx)) return { ctx, detail: null };
  if (!UUID.test(id)) notFound();
  try {
    return { ctx, detail: await getRunDetail(ctx, id) };
  } catch (err) {
    if (err instanceof AppError && (err.code === "NOT_FOUND" || err.code === "FORBIDDEN")) notFound();
    throw err;
  }
});

export default function RunPage({ params, searchParams }: PageProps<"/payroll/runs/[id]">) {
  return (
    <Page>
      <Suspense fallback={<Skeleton className="mb-6 h-16 w-full max-w-2xl" />}>
        <Header params={params} />
      </Suspense>
      <Suspense
        fallback={
          <div className="space-y-6">
            <StatGridSkeleton />
            <TableSkeleton rows={6} columns={6} />
          </div>
        }
      >
        <Body params={params} searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Header({ params }: { params: Params }) {
  const { id } = await params;
  const { detail } = await load(id);
  if (!detail) return <PageHeader title="Payroll run" />;
  const r = detail.run;
  return (
    <PageHeader
      eyebrow={
        <span className="flex gap-1.5">
          <Link href="/payroll" className="hover:underline">
            Payroll
          </Link>
          /
          <Link href={`/payroll/periods/${r.periodId}`} className="hover:underline">
            {detail.periodLabel}
          </Link>
        </span>
      }
      title={
        <span className="flex flex-wrap items-center gap-2">
          {RUN_KIND_LABEL[r.kind]} run · {detail.periodLabel} · {detail.legalEntityName} <RunStatusBadge status={r.status} />
        </span>
      }
      description={
        r.calculatedAt
          ? `Calculated ${formatDateTime(r.calculatedAt)} with ${r.calculationBasis?.engineVersion ?? "the payroll engine"}${r.snapshotHash ? ` · snapshot ${r.snapshotHash.slice(0, 12)}…` : ""}${r.notes ? ` · ${r.notes}` : ""}`
          : r.notes ?? "Not calculated yet."
      }
    />
  );
}

const STEPS = ["Inputs", "Calculate", "Review", "Approval", "Lock", "Disburse", "Publish"] as const;

function stepIndex(d: Detail) {
  const s = d.run.status;
  if (s === "draft") return 1;
  if (s === "calculated") return 2;
  if (s === "pending_approval") return 3;
  if (s === "approved") return 4;
  if (s === "locked") return d.batches.length ? 6 : 5;
  if (s === "disbursed") return 6;
  if (s === "published") return d.actions.includes("disburse") ? 5 : 7;
  return 0;
}

function Stepper({ detail }: { detail: Detail }) {
  const current = stepIndex(detail);
  const cancelled = detail.run.status === "cancelled";
  return (
    <ol className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-2" aria-label="Run progress">
      {STEPS.map((label, i) => {
        const done = !cancelled && (i < current || (i === 6 && detail.run.status === "published"));
        const active = !cancelled && i === current;
        return (
          <li
            key={label}
            aria-current={active ? "step" : undefined}
            className={cn("flex min-w-28 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-sm", active && "bg-brand-soft font-medium text-brand", done && "text-foreground", !done && !active && "text-muted-foreground")}
          >
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] tabular",
                done && "border-success bg-success-soft text-success",
                active && "border-brand bg-card text-brand",
              )}
            >
              {done ? <Check className="size-3" /> : i + 1}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

type Tab = "results" | "exceptions" | "summaries" | "payments";

async function Body({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  const { ctx, detail } = await load(id);
  if (!detail) return <NoAccess />;
  const sp = await searchParams;
  const tab = (["results", "exceptions", "summaries", "payments"].includes(String(sp.tab)) ? sp.tab : "results") as Tab;
  const r = detail.run;
  const t = r.totals;
  const errors = detail.employees.filter((e) => e.status === "error").length;
  const exceptions = detail.employees.filter((e) => e.status === "error" || e.status === "warning").length;
  const base = `/payroll/runs/${id}`;
  return (
    <Reveal className="space-y-5">
      <Stepper detail={detail} />
      <RunActions runId={id} status={r.status} actions={detail.actions} usesUnverifiedRules={r.usesUnverifiedRules} employees={detail.employees.map((e) => ({ employeeId: e.employeeId, name: e.name, code: e.code }))} />
      {r.usesUnverifiedRules && r.status !== "cancelled" ? (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Calculated with unverified statutory rule sets.</span>{" "}
            {r.unverifiedOverrideBy ? "Locked with an explicit override, which is recorded on the run." : "Locking will require an explicit, recorded override."}{" "}
            <Link href="/payroll/configuration?tab=statutory" className="font-medium text-brand hover:underline">
              Review rule sets
            </Link>
          </p>
        </div>
      ) : null}
      {r.status === "pending_approval" && detail.approval ? (
        <p className="text-sm text-muted-foreground">
          Awaiting approval step {detail.approval.currentStep} (HR review, then finance). Approvers act from{" "}
          <Link href="/inbox?tab=approvals" className="font-medium text-brand hover:underline">
            Approvals & tasks
          </Link>
          .
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-5">
        <Stat label="Employees" value={t ? String(t.employees) : "—"} />
        <Stat label="Gross earnings" value={t ? formatMoney(t.gross) : "—"} />
        <Stat label="Deductions" value={t ? formatMoney(t.deductions) : "—"} />
        <Stat label="Net pay" value={t ? formatMoney(t.net) : "—"} strong />
        <Stat label="Employer contributions" value={t ? formatMoney(t.employerContributions) : "—"} className="col-span-2 lg:col-span-1" />
      </div>
      <LinkTabs
        label="Run sections"
        active={tab}
        tabs={[
          { key: "results", label: "Results", href: base, count: detail.employees.length },
          { key: "exceptions", label: "Exceptions", href: `${base}?tab=exceptions`, count: exceptions },
          { key: "summaries", label: "Summaries", href: `${base}?tab=summaries` },
          { key: "payments", label: "Payments & payslips", href: `${base}?tab=payments` },
        ]}
      />
      {tab === "results" ? <Results rows={detail.employees} sp={sp} errors={errors} /> : null}
      {tab === "exceptions" ? <Exceptions detail={detail} ctx={ctx} /> : null}
      {tab === "summaries" ? (
        <Suspense fallback={<TableSkeleton rows={5} columns={3} />}>
          <Summaries ctx={ctx} runId={id} status={r.status} />
        </Suspense>
      ) : null}
      {tab === "payments" ? <Payments detail={detail} ctx={ctx} /> : null}
    </Reveal>
  );
}

function Stat({ label, value, strong, className }: { label: string; value: string; strong?: boolean; className?: string }) {
  return (
    <div className={cn("bg-card px-4 py-3.5", className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-lg tabular", strong ? "font-semibold" : "font-medium")}>{value}</p>
    </div>
  );
}

const SORTERS: Record<string, (a: RunEmployeeRow, b: RunEmployeeRow) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  gross: (a, b) => a.gross - b.gross,
  net: (a, b) => a.net - b.net,
  status: (a, b) => a.status.localeCompare(b.status),
  variance: (a, b) => Math.abs(a.netPct ?? 0) - Math.abs(b.netPct ?? 0),
};

function Results({ rows, sp, errors }: { rows: RunEmployeeRow[]; sp: Awaited<SearchParams>; errors: number }) {
  const key = typeof sp.sort === "string" && SORTERS[sp.sort] ? sp.sort : "name";
  const dir = sp.dir === "desc" ? "desc" : "asc";
  const sorted = [...rows].sort((a, b) => (dir === "asc" ? 1 : -1) * SORTERS[key](a, b));
  return (
    <div className="space-y-3">
      {errors ? (
        <p className="text-sm text-danger">
          {errors} employee{errors === 1 ? " has" : "s have"} errors. Open them for details, fix the data and recalculate before submitting.
        </p>
      ) : null}
      <ResultsTable
        rows={sorted}
        sort={{ key, dir }}
        empty={<EmptyState className="m-4 border-0" icon={Users} title="No results yet" description="Calculate the run to see each employee's pay." />}
      />
    </div>
  );
}

function Exceptions({ detail, ctx }: { detail: Detail; ctx: RequestContext }) {
  const rows = detail.employees.filter((e) => e.messages.some((m) => m.severity !== "info"));
  return (
    <div className="space-y-4">
      {can(ctx, "payroll.view", "all") && detail.actions.includes("explain") ? <ExplainPanel runId={detail.run.id} /> : null}
      {rows.length ? (
        <Section title="Exceptions" description="Errors block submission. Warnings (variances, missing bank details, attendance fallbacks) need review.">
          <ul className="divide-y">
            {rows.map((e) => (
              <li key={e.id} className="px-5 py-3">
                <p className="text-sm font-medium">
                  {e.name} <span className="font-normal text-muted-foreground">· {e.code}</span>
                </p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {e.messages
                    .filter((m) => m.severity !== "info")
                    .map((m, i) => (
                      <li key={i} className={m.severity === "error" ? "text-danger" : "text-muted-foreground"}>
                        {m.severity === "error" ? "Error: " : ""}
                        {m.message}
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        </Section>
      ) : (
        <EmptyState icon={Check} title="No exceptions" description="Every employee calculated without errors or warnings." />
      )}
    </div>
  );
}

async function Summaries({ ctx, runId, status }: { ctx: RequestContext; runId: string; status: string }) {
  if (status === "draft") return <EmptyState title="Nothing to summarize yet" description="Calculate the run first." />;
  const s = await runSummaries(ctx, runId);
  const st = s.statutory;
  const canExport = can(ctx, "payroll.view", "all") && can(ctx, "reports.export", "all");
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">For reconciliation; not a statutory return. File returns from your statutory portals after verifying these totals.</p>
      {canExport ? (
        <Button variant="outline" size="sm" asChild>
          <a href={`/api/payroll/runs/${runId}/register`}>
            <Download /> Payroll register (CSV)
          </a>
        </Button>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Statutory summary">
          <dl className="divide-y text-sm">
            <SumRow label={`PF · ${st.pf.members} members · wages ${formatMoney(st.pf.wages)}`} value={`Employee ${formatMoney(st.pf.employee)} · EPS ${formatMoney(st.pf.eps)} · EPF ${formatMoney(st.pf.epf)}`} />
            <SumRow label={`ESI · ${st.esi.covered} covered · wages ${formatMoney(st.esi.wages)}`} value={`Employee ${formatMoney(st.esi.employee)} · employer ${formatMoney(st.esi.employer)}`} />
            {st.pt.map((p) => (
              <SumRow key={p.state} label={`Professional tax · ${p.state} · ${p.employees} employee${p.employees === 1 ? "" : "s"}`} value={formatMoney(p.amount)} />
            ))}
            {st.lwf.map((l) => (
              <SumRow key={l.state} label={`LWF · ${l.state} · ${l.employees} employee${l.employees === 1 ? "" : "s"}`} value={`Employee ${formatMoney(l.employee)} · employer ${formatMoney(l.employer)}`} />
            ))}
            <SumRow label={`TDS · ${st.tds.employees} employee${st.tds.employees === 1 ? "" : "s"} (${st.tds.newRegime} new / ${st.tds.oldRegime} old regime)`} value={formatMoney(st.tds.amount)} />
          </dl>
        </Section>
        <Section title="Components">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Component</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Employees</TableHead>
                <TableHead className="pr-5 text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.components.map((c) => (
                <TableRow key={c.code}>
                  <TableCell className="pl-5">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{titleCase(c.kind)}</TableCell>
                  <TableCell className="text-right tabular">{c.employees}</TableCell>
                  <TableCell className="pr-5 text-right tabular">{formatMoney(c.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      </div>
    </div>
  );
}

function SumRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium tabular">{value}</dd>
    </div>
  );
}

function Payments({ detail, ctx }: { detail: Detail; ctx: RequestContext }) {
  const canRun = can(ctx, "payroll.run", "all");
  const counts = detail.disbursementCounts;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2 text-sm">
        {Object.keys(counts).length ? (
          Object.entries(counts).map(([s, n]) => <StatusBadge key={s} status={s} label={`${titleCase(s)}: ${n}`} />)
        ) : (
          <span className="text-muted-foreground">No payments generated yet.</span>
        )}
        <StatusBadge status="published" tone={detail.payslipCount ? "success" : "neutral"} label={`Payslips published: ${detail.payslipCount}`} />
      </div>
      <Section title="Bank transfer files" description="Files are stored as sensitive documents; downloads are logged.">
        {detail.batches.length ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Created</TableHead>
                <TableHead>Format</TableHead>
                <TableHead className="text-right">Payments</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-5 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.batches.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="pl-5">{formatDateTime(b.createdAt)}</TableCell>
                  <TableCell>{b.format === "neft_bulk" ? "NEFT bulk" : "Generic CSV"}</TableCell>
                  <TableCell className="text-right tabular">{b.count}</TableCell>
                  <TableCell className="text-right tabular">{formatMoney(b.totalAmount)}</TableCell>
                  <TableCell>
                    <StatusBadge status={b.status} />
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    {canRun ? (
                      <div className="flex justify-end gap-1">
                        {b.documentId ? (
                          <Button variant="ghost" size="sm" asChild>
                            <a href={`/api/payroll/batches/${b.id}/file`}>
                              <Download /> File
                            </a>
                          </Button>
                        ) : null}
                        <BankResponseDialog batchId={b.id} />
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState className="m-4 border-0" title="No bank files yet" description="Lock the run, then generate a bank transfer file." />
        )}
      </Section>
      {detail.children.length ? (
        <Section title="Adjustment runs">
          <ul className="divide-y">
            {detail.children.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <span>
                  {RUN_KIND_LABEL[c.kind]} · created {formatDateTime(c.createdAt)}
                </span>
                <span className="flex items-center gap-2">
                  <RunStatusBadge status={c.status} />
                  <Link href={`/payroll/runs/${c.id}`} className="font-medium text-brand hover:underline">
                    Open
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
