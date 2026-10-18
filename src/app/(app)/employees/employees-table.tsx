"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, type ServerSort } from "@/components/data-table";
import { PersonCell } from "@/components/person";
import { StatusBadge } from "@/components/status-badge";
import { formatDate, titleCase } from "@/lib/format";
import type { EmployeeRow } from "@/server/services/employees/queries";

const STATUS_LABEL: Record<string, string> = { pending: "Pre-joining", on_notice: "On notice" };

const columns: ColumnDef<EmployeeRow, unknown>[] = [
  {
    id: "name",
    header: "Employee",
    meta: { sortKey: "name", className: "min-w-56" },
    cell: ({ row }) => (
      <PersonCell id={row.original.id} name={row.original.name} subtitle={row.original.code} href={`/employees/${row.original.id}`} />
    ),
  },
  {
    id: "designation",
    header: "Designation",
    cell: ({ row }) => <span className="text-foreground">{row.original.designation ?? <span className="text-muted-foreground">—</span>}</span>,
  },
  {
    id: "department",
    header: "Department",
    meta: { sortKey: "department" },
    cell: ({ row }) => row.original.department ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "location",
    header: "Location",
    meta: { className: "hidden lg:table-cell", headerClassName: "hidden lg:table-cell" },
    cell: ({ row }) => row.original.location ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "manager",
    header: "Manager",
    meta: { className: "hidden xl:table-cell", headerClassName: "hidden xl:table-cell" },
    cell: ({ row }) =>
      row.original.managerId ? (
        <Link href={`/employees/${row.original.managerId}`} className="hover:underline">
          {row.original.managerName}
        </Link>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "type",
    header: "Type",
    meta: { className: "hidden 2xl:table-cell", headerClassName: "hidden 2xl:table-cell" },
    cell: ({ row }) => <span className="text-muted-foreground">{titleCase(row.original.employmentType)}</span>,
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} label={STATUS_LABEL[row.original.status]} />,
  },
  {
    id: "joining",
    header: "Joined",
    meta: { sortKey: "joining", className: "text-muted-foreground tabular whitespace-nowrap" },
    cell: ({ row }) => formatDate(row.original.joiningDate),
  },
];

export function EmployeesTable(props: {
  rows: EmployeeRow[];
  page: number;
  pageCount: number;
  total: number;
  sort: ServerSort;
  empty: React.ReactNode;
}) {
  return (
    <DataTable
      columns={columns}
      data={props.rows}
      sort={props.sort}
      page={props.page}
      pageCount={props.pageCount}
      total={props.total}
      getRowId={(r) => r.id}
      onRowHref={(r) => `/employees/${r.id}`}
      empty={props.empty}
    />
  );
}
