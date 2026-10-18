"use client";

import { useState, useTransition } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { cn } from "cn";
import { DataTable, type ServerSort } from "@/components/data-table";
import { PersonAvatar } from "@/components/person";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney, titleCase } from "@/lib/format";
import type { RunEmployeeRow } from "@/server/services/payroll/runs";
import { getRunEmployeeAction } from "../../actions";
import { ResultStatusBadge } from "../../_components/status";

type Detail = Extract<Awaited<ReturnType<typeof getRunEmployeeAction>>, { ok: true }>["data"];

const KIND_LABEL: Record<string, string> = {
  earning: "Earnings",
  reimbursement: "Reimbursements",
  deduction: "Deductions",
  statutory_deduction: "Statutory deductions",
  employer_contribution: "Employer contributions",
};
const KIND_ORDER = ["earning", "reimbursement", "statutory_deduction", "deduction", "employer_contribution"];

export function ResultsTable({ rows, sort, empty }: { rows: RunEmployeeRow[]; sort: ServerSort; empty: React.ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, start] = useTransition();

  const open = (id: string) => {
    setOpenId(id);
    setDetail(null);
    start(async () => {
      const res = await getRunEmployeeAction({ runEmployeeId: id });
      if (res.ok) setDetail(res.data);
      else {
        toast.error(res.error.message);
        setOpenId(null);
      }
    });
  };

  const columns: ColumnDef<RunEmployeeRow, unknown>[] = [
    {
      id: "name",
      header: "Employee",
      meta: { sortKey: "name", className: "min-w-56" },
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => open(row.original.id)}
          className="flex min-w-0 items-center gap-2.5 rounded text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <PersonAvatar id={row.original.employeeId} name={row.original.name} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground hover:underline">{row.original.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{row.original.code}</span>
          </span>
        </button>
      ),
    },
    {
      id: "days",
      header: "Payable days",
      meta: { className: "text-right tabular", headerClassName: "text-right" },
      cell: ({ row }) => (
        <span>
          {row.original.payableDays}/{row.original.calendarDays}
          {row.original.lopDays ? <span className="ml-1 text-xs text-warning">({row.original.lopDays} LOP)</span> : null}
        </span>
      ),
    },
    { id: "gross", header: "Gross", meta: { sortKey: "gross", className: "text-right tabular", headerClassName: "text-right" }, cell: ({ row }) => formatMoney(row.original.gross) },
    { id: "deductions", header: "Deductions", meta: { className: "hidden text-right tabular md:table-cell", headerClassName: "hidden text-right md:table-cell" }, cell: ({ row }) => formatMoney(row.original.deductions) },
    { id: "net", header: "Net pay", meta: { sortKey: "net", className: "text-right font-medium tabular", headerClassName: "text-right" }, cell: ({ row }) => formatMoney(row.original.net) },
    { id: "status", header: "Status", meta: { sortKey: "status" }, cell: ({ row }) => <ResultStatusBadge status={row.original.status} /> },
    {
      id: "variance",
      header: "Variance",
      meta: { sortKey: "variance", className: "hidden text-right tabular sm:table-cell", headerClassName: "hidden text-right sm:table-cell" },
      cell: ({ row }) =>
        row.original.netPct == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={cn(row.original.varianceFlagged && "font-medium text-warning")}>
            {row.original.netPct > 0 ? "+" : ""}
            {row.original.netPct}%
          </span>
        ),
    },
  ];

  return (
    <>
      <DataTable columns={columns} data={rows} sort={sort} total={rows.length} getRowId={(r) => r.id} empty={empty} dense />
      <Sheet open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-xl">
          <SheetHeader className="border-b">
            <SheetTitle>{detail ? detail.name : "Loading…"}</SheetTitle>
            <SheetDescription>{detail ? `${detail.code} · ${detail.payableDays} of ${detail.calendarDays} days payable${detail.lopDays ? ` · ${detail.lopDays} LOP` : ""}` : " "}</SheetDescription>
          </SheetHeader>
          {loading || !detail ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <EmployeeDetail detail={detail} />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function EmployeeDetail({ detail }: { detail: Detail }) {
  const snap = detail.snapshot as {
    compensation?: { annualCtc: number; effectiveFrom: string } | null;
    structure?: { name: string; version: number; isDefault: boolean } | null;
    ruleSets?: { kind: string; jurisdiction: string; version: number; verified: boolean }[];
    profile?: { taxRegime?: string; ptState?: string | null } | null;
    days?: { source: string } | null;
    explanation?: string | null;
  };
  return (
    <div className="space-y-5 p-4">
      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border text-sm">
        {[
          ["Gross", detail.gross],
          ["Deductions", detail.deductions],
          ["Net pay", detail.net],
        ].map(([label, v]) => (
          <div key={label as string} className="bg-card px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-semibold tabular">{formatMoney(v as number)}</dd>
          </div>
        ))}
      </dl>
      {detail.messages.length ? (
        <ul className="space-y-1.5 text-sm">
          {detail.messages.map((m, i) => (
            <li key={i} className={cn("rounded-md px-3 py-2", m.severity === "error" ? "bg-danger-soft text-danger" : m.severity === "warning" ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground")}>
              {m.message}
            </li>
          ))}
        </ul>
      ) : null}
      {KIND_ORDER.map((kind) => {
        const lines = detail.lines.filter((l) => l.kind === kind && (l.amount !== 0 || l.componentCode === "LOP"));
        if (!lines.length) return null;
        return (
          <section key={kind}>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{KIND_LABEL[kind]}</h3>
            <ul className="divide-y rounded-lg border">
              {lines.map((l) => (
                <li key={l.id} className="px-3 py-2">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{l.componentName}</span>
                    <span className="tabular">{l.componentCode === "LOP" ? "—" : formatMoney(l.amount)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{l.explanation}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <section>
        <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Calculation basis</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Annual CTC</dt>
          <dd className="tabular">{snap.compensation ? formatMoney(snap.compensation.annualCtc) : "—"}</dd>
          <dt className="text-muted-foreground">Structure</dt>
          <dd>{snap.structure ? `${snap.structure.name} v${snap.structure.version}${snap.structure.isDefault ? " (default)" : ""}` : "—"}</dd>
          <dt className="text-muted-foreground">Tax regime</dt>
          <dd>{snap.profile?.taxRegime ? titleCase(snap.profile.taxRegime) : "—"}</dd>
          <dt className="text-muted-foreground">Work state</dt>
          <dd>{snap.profile?.ptState ?? "—"}</dd>
          <dt className="text-muted-foreground">Attendance source</dt>
          <dd>{snap.days?.source ? titleCase(snap.days.source) : "—"}</dd>
          <dt className="text-muted-foreground">Rule sets</dt>
          <dd className="space-y-0.5">
            {(snap.ruleSets ?? []).map((r) => (
              <span key={`${r.kind}${r.jurisdiction}`} className="block">
                {r.kind.toUpperCase()} {r.jurisdiction} v{r.version} <span className={r.verified ? "text-success" : "text-warning"}>{r.verified ? "verified" : "unverified"}</span>
              </span>
            ))}
          </dd>
        </dl>
        {snap.explanation ? <p className="mt-3 text-xs text-muted-foreground">{snap.explanation}</p> : null}
      </section>
      <details className="rounded-lg border text-xs">
        <summary className="cursor-pointer px-3 py-2 font-medium">Full snapshot</summary>
        <pre className="max-h-80 overflow-auto border-t bg-muted/40 p-3 whitespace-pre-wrap">{JSON.stringify(detail.snapshot, null, 2)}</pre>
      </details>
    </div>
  );
}
