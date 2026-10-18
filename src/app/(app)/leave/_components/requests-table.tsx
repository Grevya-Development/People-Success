"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { cn } from "cn";
import { DataTable } from "@/components/data-table";
import { PersonCell } from "@/components/person";
import { StatusBadge } from "@/components/status-badge";
import { formatDate, formatDateTime } from "@/lib/format";
import { daysLabel, dotClass, rangeLabel } from "./tones";

export type RequestRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  typeName: string;
  typeColor: string;
  startDate: string;
  endDate: string;
  startSession: string;
  endSession: string;
  days: number;
  status: string;
  createdAt: string;
};

const columns: ColumnDef<RequestRow, unknown>[] = [
  {
    id: "employee",
    header: "Employee",
    meta: { className: "min-w-52" },
    cell: ({ row }) => <PersonCell id={row.original.employeeId} name={row.original.employeeName} subtitle={row.original.employeeCode} />,
  },
  {
    id: "type",
    header: "Leave",
    cell: ({ row }) => (
      <Link href={`/leave/requests/${row.original.id}`} className="inline-flex items-center gap-2 hover:underline">
        <span className={cn("size-2 rounded-full", dotClass(row.original.typeColor))} aria-hidden />
        {row.original.typeName}
      </Link>
    ),
  },
  { id: "dates", header: "Dates", cell: ({ row }) => <span className="tabular">{rangeLabel(row.original, (d) => formatDate(d, "dd MMM"))}</span> },
  { id: "days", header: "Days", meta: { className: "text-right tabular", headerClassName: "text-right" }, cell: ({ row }) => daysLabel(row.original.days) },
  { id: "status", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  {
    id: "applied",
    header: "Applied",
    meta: { className: "hidden lg:table-cell text-xs text-muted-foreground", headerClassName: "hidden lg:table-cell" },
    cell: ({ row }) => formatDateTime(row.original.createdAt),
  },
];

export function RequestsTable({ rows, page, pageCount, total, empty }: { rows: RequestRow[]; page: number; pageCount: number; total: number; empty: React.ReactNode }) {
  return <DataTable columns={columns} data={rows} page={page} pageCount={pageCount} total={total} getRowId={(r) => r.id} onRowHref={(r) => `/leave/requests/${r.id}`} empty={empty} />;
}
