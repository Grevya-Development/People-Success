"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "cn";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

export type ServerSort = { key: string; dir: "asc" | "desc" };

type ColumnMeta = { sortKey?: string; className?: string; headerClassName?: string };

/**
 * Data table for server-paginated lists. Sorting and paging are driven by the
 * URL (so they are shareable and survive refresh); data comes from the server.
 */
export function DataTable<T>({
  columns,
  data,
  sort,
  page,
  pageCount,
  total,
  onRowHref,
  getRowId,
  empty,
  dense = false,
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  sort?: ServerSort;
  page?: number;
  pageCount?: number;
  total?: number;
  onRowHref?: (row: T) => string;
  getRowId?: (row: T) => string;
  empty?: React.ReactNode;
  dense?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    getRowId: getRowId ? (r) => getRowId(r) : undefined,
  });

  const navigate = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    start(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const toggleSort = (key: string) => {
    const dir = sort?.key === key && sort.dir === "asc" ? "desc" : "asc";
    navigate({ sort: key, dir, page: null });
  };

  const open = (row: Row<T>) => {
    if (onRowHref) router.push(onRowHref(row.original));
  };

  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card transition-opacity", pending && "opacity-60")}>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((h) => {
                  const meta = h.column.columnDef.meta as ColumnMeta | undefined;
                  const active = meta?.sortKey && sort?.key === meta.sortKey;
                  return (
                    <TableHead
                      key={h.id}
                      className={cn("h-9 bg-muted/40 text-xs font-medium text-muted-foreground", meta?.headerClassName)}
                      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                    >
                      {meta?.sortKey ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(meta.sortKey!)}
                          className="inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {active ? sort!.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(onRowHref && "cursor-pointer")}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a,button,input,[role=menuitem]")) return;
                    open(row);
                  }}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
                    return (
                      <TableCell key={cell.id} className={cn(dense ? "py-1.5" : "py-2.5", meta?.className)}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="p-0">
                  {empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {page && pageCount && pageCount > 1 ? (
        <div className="flex items-center justify-between border-t px-4 py-2.5 text-sm text-muted-foreground">
          <span className="tabular">
            Page {page} of {pageCount}
            {total != null ? ` · ${total.toLocaleString("en-IN")} total` : ""}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="icon-sm" disabled={page <= 1 || pending} onClick={() => navigate({ page: String(page - 1) })} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon-sm" disabled={page >= pageCount || pending} onClick={() => navigate({ page: String(page + 1) })} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : total != null ? (
        <div className="border-t px-4 py-2.5 text-sm text-muted-foreground tabular">{total.toLocaleString("en-IN")} total</div>
      ) : null}
    </div>
  );
}
