"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Briefcase, Pencil, Plus, Search } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/page";
import { formatMoney } from "@/lib/format";
import { POSITION_STATUSES, POSITION_STATUS_LABELS, type PositionStatus } from "@/lib/validation/organization";
import { PositionDialog, type EditablePosition, type PositionLookupOptions } from "./position-dialog";

export type PositionTableRow = EditablePosition & {
  department: string | null;
  location: string | null;
  designation: string | null;
  reportsTo: string | null;
  incumbent: string | null;
  currency: string;
};

type Props = {
  rows: PositionTableRow[];
  lookups: PositionLookupOptions | null;
  showBudget: boolean;
};

export function PositionsTable({ rows, lookups, showBudget }: Props) {
  const [status, setStatus] = useState<PositionStatus | "all">("all");
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<{ open: boolean; position?: EditablePosition }>({ open: false });
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (status === "all" || r.status === status) &&
        (!term || [r.code, r.title, r.department, r.incumbent, r.designation].some((v) => v?.toLowerCase().includes(term))),
    );
  }, [rows, status, q]);
  const canManage = !!lookups;

  return (
    <section className="rounded-xl border bg-card">
      <header className="flex flex-col gap-3 border-b px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">Positions</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Approved seats by department.{canManage ? "" : " Read-only: ask an org administrator to change positions."}
          </p>
        </div>
        {canManage ? (
          <Button size="sm" onClick={() => setDialog({ open: true })}>
            <Plus data-icon="inline-start" /> New position
          </Button>
        ) : null}
      </header>

      {rows.length ? (
        <>
          <div className="flex flex-col gap-3 border-b px-5 py-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
              {(["all", ...POSITION_STATUSES] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  aria-pressed={status === s}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    status === s && "bg-muted text-foreground",
                  )}
                >
                  {s === "all" ? "All" : POSITION_STATUS_LABELS[s]}
                  <span className="tabular text-[11px] text-muted-foreground">{counts[s] ?? 0}</span>
                </button>
              ))}
            </div>
            <div className="relative w-full md:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search positions" aria-label="Search positions" className="h-8 pl-8" type="search" />
            </div>
          </div>
          {filtered.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Position</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Reports to</TableHead>
                  <TableHead>Incumbent</TableHead>
                  <TableHead>Status</TableHead>
                  {showBudget ? <TableHead className="text-right">Budget (annual)</TableHead> : null}
                  {canManage ? (
                    <TableHead className="pr-5 text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-[16rem] pl-5">
                      <div className="truncate font-medium">{r.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        <span className="tabular">{r.code}</span>
                        {r.designation ? ` · ${r.designation}` : ""}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{r.department ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.location ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="max-w-[12rem] truncate text-muted-foreground">{r.reportsTo ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {r.employeeId && r.incumbent ? (
                        <Link href={`/employees/${r.employeeId}`} className="hover:underline">
                          {r.incumbent}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Vacant</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    {showBudget ? (
                      <TableCell className="tabular text-right whitespace-nowrap">{formatMoney(r.budgetedAnnualCtc, r.currency, { compact: true })}</TableCell>
                    ) : null}
                    {canManage ? (
                      <TableCell className="pr-5 text-right">
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${r.code}`} title="Edit" onClick={() => setDialog({ open: true, position: r })}>
                          <Pencil />
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">No positions match these filters.</p>
          )}
        </>
      ) : (
        <div className="p-5">
          <EmptyState
            icon={Briefcase}
            title="No positions yet"
            description={canManage ? "Create positions to plan headcount, track vacancies and budgets by department." : "Your organization has not set up positions."}
            className="border-0"
            action={
              canManage ? (
                <Button size="sm" onClick={() => setDialog({ open: true })}>
                  <Plus data-icon="inline-start" /> New position
                </Button>
              ) : null
            }
          />
        </div>
      )}

      {lookups ? (
        <PositionDialog lookups={lookups} position={dialog.position} open={dialog.open} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} />
      ) : null}
    </section>
  );
}
