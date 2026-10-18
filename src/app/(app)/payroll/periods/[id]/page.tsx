import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, cache } from "react";
import { notFound } from "next/navigation";
import { AlertCircle, AlertTriangle, ArrowRight, Info, ListChecks, Receipt } from "lucide-react";
import { EmptyState, NoAccess, Page, PageHeader, Reveal, Section, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, requireContext, type RequestContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { getPeriod } from "@/server/services/payroll/periods";
import { periodReadiness, type ReadinessItem } from "@/server/services/payroll/readiness";
import { listInputs } from "@/server/services/payroll/inputs";
import { payrollLookups } from "@/server/services/payroll/lookups";
import { settlementCandidates } from "@/server/services/payroll/runs";
import { isPayrollStaff } from "@/server/services/payroll/shared";
import { formatDate, formatMoney, titleCase } from "@/lib/format";
import { PeriodStatusBadge, RUN_KIND_LABEL, RunStatusBadge } from "../../_components/status";
import { StartRunButton } from "../../_components/start-run-button";
import { AddInputDialog, DeleteInputButton, FnfDialog, ImportInputsDialog } from "./period-dialogs";

export const metadata: Metadata = { title: "Payroll period" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const load = cache(async (id: string) => {
  const ctx = await requireContext();
  if (!isPayrollStaff(ctx)) return { ctx, data: null };
  if (!UUID.test(id)) notFound();
  try {
    return { ctx, data: await getPeriod(ctx, id) };
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
});

export default function PeriodPage({ params }: PageProps<"/payroll/periods/[id]">) {
  return (
    <Page>
      <Suspense fallback={<Skeleton className="mb-6 h-14 w-96" />}>
        <Header params={params} />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={6} columns={5} />}>
        <Body params={params} />
      </Suspense>
    </Page>
  );
}

async function Header({ params }: { params: PageProps<"/payroll/periods/[id]">["params"] }) {
  const { id } = await params;
  const { ctx, data } = await load(id);
  if (!data) return <PageHeader title="Payroll period" />;
  const regular = data.runs.find((r) => r.kind === "regular" && r.status !== "cancelled");
  const canRun = can(ctx, "payroll.run", "all");
  const open = data.period.status === "open";
  const candidates = canRun ? await settlementCandidates(ctx, id) : [];
  return (
    <PageHeader
      eyebrow={
        <Link href="/payroll" className="hover:underline">
          Payroll
        </Link>
      }
      title={
        <span className="flex flex-wrap items-center gap-2">
          {data.label} · {data.legalEntity.name} <PeriodStatusBadge status={data.period.status} />
        </span>
      }
      description={`${formatDate(data.period.startDate)} – ${formatDate(data.period.endDate)} · input cutoff ${formatDate(data.period.inputCutoffDate)} · pay date ${formatDate(data.period.payDate)}`}
      actions={
        <>
          {canRun ? <FnfDialog periodId={id} candidates={candidates.map((c) => ({ value: c.id, label: `${c.name} (${c.code})`, hint: c.lwd ? `Last day ${formatDate(c.lwd)}` : undefined }))} /> : null}
          {regular ? (
            <Button size="sm" asChild>
              <Link href={`/payroll/runs/${regular.id}`}>
                Open regular run <ArrowRight />
              </Link>
            </Button>
          ) : canRun && open ? (
            <StartRunButton periodId={id} />
          ) : null}
        </>
      }
    />
  );
}

async function Body({ params }: { params: PageProps<"/payroll/periods/[id]">["params"] }) {
  const { id } = await params;
  const { ctx, data } = await load(id);
  if (!data) return <NoAccess />;
  return (
    <Reveal className="space-y-6">
      {data.runs.length ? (
        <Section title="Runs" description="Regular payroll, full and final settlements and adjustments for this period.">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Kind</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Employees</TableHead>
                <TableHead className="text-right">Net pay</TableHead>
                <TableHead className="hidden sm:table-cell">Notes</TableHead>
                <TableHead className="pr-5 text-right">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-5 font-medium">{RUN_KIND_LABEL[r.kind] ?? r.kind}</TableCell>
                  <TableCell>
                    <RunStatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-right tabular">{r.totals?.employees ?? "—"}</TableCell>
                  <TableCell className="text-right tabular">{r.totals ? formatMoney(r.totals.net) : "—"}</TableCell>
                  <TableCell className="hidden max-w-80 truncate text-muted-foreground sm:table-cell">{r.notes ?? ""}</TableCell>
                  <TableCell className="pr-5 text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/payroll/runs/${r.id}`}>Open</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}
      <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" />}>
        <ReadinessSection ctx={ctx} periodId={id} />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={4} columns={5} />}>
        <InputsSection ctx={ctx} periodId={id} legalEntityId={data.period.legalEntityId} editable={data.period.status === "open"} />
      </Suspense>
    </Reveal>
  );
}

const SEVERITY = {
  error: { icon: AlertCircle, cls: "text-danger", label: "Blocking" },
  warning: { icon: AlertTriangle, cls: "text-warning", label: "Warning" },
  info: { icon: Info, cls: "text-info", label: "Info" },
} as const;

async function ReadinessSection({ ctx, periodId }: { ctx: RequestContext; periodId: string }) {
  const r = await periodReadiness(ctx, periodId);
  return (
    <Section
      title="Pre-run readiness"
      description={`${r.eligible} employee${r.eligible === 1 ? "" : "s"} in scope · ${r.counts.error} blocking · ${r.counts.warning} warnings · ${r.counts.info} info`}
    >
      {r.skippedChecks.length ? <p className="border-b px-5 py-2.5 text-xs text-muted-foreground">Not checked: {r.skippedChecks.join("; ")}.</p> : null}
      {r.items.length ? (
        <ul className="max-h-[28rem] divide-y overflow-y-auto">
          {r.items.map((item: ReadinessItem, i) => {
            const s = SEVERITY[item.severity];
            const Icon = s.icon;
            return (
              <li key={i} className="flex items-start gap-3 px-5 py-2.5 text-sm">
                <Icon className={`mt-0.5 size-4 shrink-0 ${s.cls}`} aria-label={s.label} />
                <div className="min-w-0 flex-1">
                  {item.employeeName ? <span className="font-medium">{item.employeeName}: </span> : null}
                  <span className="text-muted-foreground">{item.message}</span>
                </div>
                {item.href ? (
                  <Link href={item.href} className="shrink-0 text-xs font-medium text-brand hover:underline">
                    Fix
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState className="m-4 border-0" icon={ListChecks} title="Ready to run" description="No issues found for this period." />
      )}
    </Section>
  );
}

async function InputsSection({ ctx, periodId, legalEntityId, editable }: { ctx: RequestContext; periodId: string; legalEntityId: string; editable: boolean }) {
  const canRun = can(ctx, "payroll.run", "all") && editable;
  const [inputs, lookups] = await Promise.all([listInputs(ctx, periodId), canRun ? payrollLookups(ctx, { legalEntityId }) : null]);
  return (
    <Section
      title="One-off inputs"
      description="Amounts for this period only. Other modules (expenses, referrals, leave encashment) post here automatically."
      actions={
        canRun && lookups ? (
          <>
            <ImportInputsDialog periodId={periodId} />
            <AddInputDialog periodId={periodId} employees={lookups.employees} components={lookups.components} />
          </>
        ) : null
      }
    >
      {inputs.length ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Employee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Component</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden md:table-cell">Source</TableHead>
                <TableHead className="hidden lg:table-cell">Note</TableHead>
                <TableHead className="pr-5 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inputs.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="pl-5">
                    <p className="font-medium">{i.employeeName}</p>
                    <p className="text-xs text-muted-foreground">{i.employeeCode}</p>
                  </TableCell>
                  <TableCell>{titleCase(i.kind)}</TableCell>
                  <TableCell>{i.componentName ?? i.componentCode}</TableCell>
                  <TableCell className="text-right tabular">{formatMoney(i.amount)}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{titleCase(i.sourceType)}</TableCell>
                  <TableCell className="hidden max-w-64 truncate text-muted-foreground lg:table-cell">{i.note ?? ""}</TableCell>
                  <TableCell className="pr-5 text-right">
                    {canRun && (i.sourceType === "manual" || i.sourceType === "csv_import") ? <DeleteInputButton id={i.id} label={`${titleCase(i.kind)} for ${i.employeeName}`} /> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState className="m-4 border-0" icon={Receipt} title="No inputs for this period" description={canRun ? "Add bonuses, arrears, reimbursements or recoveries, or import them from a spreadsheet." : "Nothing has been posted for this period."} />
      )}
    </Section>
  );
}
