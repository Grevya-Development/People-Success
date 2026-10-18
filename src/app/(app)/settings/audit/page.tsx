import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronRight, ScrollText } from "lucide-react";
import { EmptyState, NoAccess, PageHeader, Reveal, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, requireContext } from "@/server/auth/context";
import { auditFilterOptions, listAuditLogs, type AuditRow } from "@/server/services/settings/audit-log";
import { auditFilterSchema, type AuditFilter } from "@/lib/validation/settings";
import { formatDateTime, titleCase } from "@/lib/format";
import { AuditFilters } from "./audit-filters";

export const metadata: Metadata = { title: "Audit log" };

export default function AuditPage({ searchParams }: PageProps<"/settings/audit">) {
  return (
    <>
      <PageHeader title="Audit log" description="An append-only record of every change. Sensitive values such as identity numbers and salaries are redacted." />
      <Suspense fallback={<TableSkeleton rows={10} columns={4} />}>
        <AuditData searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function hrefWith(filter: AuditFilter, patch: Partial<AuditFilter>) {
  const merged = { ...filter, ...patch };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return `/settings/audit${s ? `?${s}` : ""}`;
}

async function AuditData({ searchParams }: { searchParams: PageProps<"/settings/audit">["searchParams"] }) {
  const [ctx, sp] = await Promise.all([requireContext(), searchParams]);
  if (!can(ctx, "audit.view", "all")) return <NoAccess />;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  const filter = auditFilterSchema.parse({
    entityType: first(sp.entityType),
    action: first(sp.action),
    actor: first(sp.actor),
    from: first(sp.from),
    to: first(sp.to),
    cursor: first(sp.cursor),
  });
  const [page, options] = await Promise.all([listAuditLogs(ctx, filter), auditFilterOptions(ctx)]);
  const filtered = !!(filter.entityType || filter.action || filter.actor || filter.from || filter.to);

  return (
    <Reveal className="space-y-4">
      <AuditFilters
        key={JSON.stringify({ ...filter, cursor: undefined })}
        value={{ entityType: filter.entityType ?? "", action: filter.action ?? "", actor: filter.actor ?? "", from: filter.from ?? "", to: filter.to ?? "" }}
        entityTypes={options.entityTypes.map((t) => ({ value: t, label: titleCase(t) }))}
        actors={options.actors}
      />
      {page.rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={filtered || filter.cursor ? "No matching entries" : "No activity yet"}
          description={filtered ? "Try widening the date range or clearing filters." : "Changes made in your organization will appear here."}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead className="pr-4">Record</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.rows.map((r) => (
                <AuditRowView key={r.id} row={r} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        {filter.cursor ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={hrefWith(filter, { cursor: undefined })}>Back to newest</Link>
          </Button>
        ) : (
          <span />
        )}
        {page.nextCursor ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={hrefWith(filter, { cursor: page.nextCursor })}>
              Older entries <ChevronRight />
            </Link>
          </Button>
        ) : null}
      </div>
    </Reveal>
  );
}

function AuditRowView({ row }: { row: AuditRow }) {
  const hasDetail = (row.changes && Object.keys(row.changes).length > 0) || (row.metadata && Object.keys(row.metadata).length > 0);
  return (
    <TableRow className="align-top">
      <TableCell className="pl-4 text-sm whitespace-nowrap text-muted-foreground tabular">{formatDateTime(row.createdAt)}</TableCell>
      <TableCell className="text-sm">
        {row.actorName ?? row.actorEmail ?? (row.actorType === "user" ? "Former user" : titleCase(row.actorType))}
        {row.ip ? <p className="text-xs text-muted-foreground">{row.ip}</p> : null}
      </TableCell>
      <TableCell className="max-w-[28rem]">
        <p className="font-mono text-xs">{row.action}</p>
        {hasDetail ? (
          <details className="group mt-1">
            <summary className="cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground">
              {row.changes ? `${Object.keys(row.changes).length} field${Object.keys(row.changes).length === 1 ? "" : "s"} changed` : "Details"}
            </summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
              {JSON.stringify(row.changes ?? row.metadata, null, 2)}
            </pre>
            {row.changes && row.metadata ? (
              <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted/40 p-2 text-[11px] whitespace-pre-wrap text-muted-foreground">
                {JSON.stringify(row.metadata, null, 2)}
              </pre>
            ) : null}
          </details>
        ) : null}
      </TableCell>
      <TableCell className="pr-4 text-sm">
        {titleCase(row.entityType)}
        {row.entityId ? <p className="max-w-48 truncate font-mono text-[11px] text-muted-foreground">{row.entityId}</p> : null}
      </TableCell>
    </TableRow>
  );
}
