import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { format, subDays } from "date-fns";
import { Download, FileText } from "lucide-react";
import { NoAccess, Page, PageHeader, Reveal, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, requireContext } from "@/server/auth/context";
import { reportDefinition } from "@/server/services/reports/catalog";
import { runReport, PREVIEW_ROWS } from "@/server/services/reports/service";
import { employeeFormLookups } from "@/server/services/employees/lookups";
import { AppError } from "@/server/lib/errors";
import { formatDate } from "@/lib/format";
import { ReportFilters, SaveReportButton } from "../report-controls";

export const metadata: Metadata = { title: "Report" };

type Props = PageProps<"/reports/[key]">;

export default function ReportPage({ params, searchParams }: Props) {
  return (
    <Page>
      <Suspense fallback={<TableSkeleton rows={10} columns={6} />}>
        <Body params={params} searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

function cell(type: string, v: unknown) {
  if (v === null || v === undefined || v === "") return <span className="text-muted-foreground">—</span>;
  switch (type) {
    case "money":
      return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(v) / 100);
    case "percent":
      return `${(Number(v) * 100).toFixed(1)}%`;
    case "date":
      return formatDate(String(v));
    case "number":
      return Number(v).toLocaleString("en-IN");
    default:
      return String(v).replace(/_/g, " ");
  }
}

async function Body({ params, searchParams }: Props) {
  const { key } = await params;
  const def = reportDefinition(key);
  if (!def) notFound();
  const ctx = await requireContext();
  if (!def.permissions.every((p) => can(ctx, p, "all"))) return <NoAccess message="You do not have access to the data in this report." />;
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const query = {
    from: str("from") ?? format(subDays(new Date(), 90), "yyyy-MM-dd"),
    to: str("to") ?? format(new Date(), "yyyy-MM-dd"),
    departmentId: str("departmentId"),
    locationId: str("locationId"),
  };
  let result: Awaited<ReturnType<typeof runReport>>;
  try {
    result = await runReport(ctx, key, query);
  } catch (err) {
    if (err instanceof AppError && err.code === "VALIDATION") result = { def, rows: [], truncated: false };
    else throw err;
  }
  const lookups = await employeeFormLookups(ctx);
  const canExport = can(ctx, "reports.export", "all");
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <PageHeader
        eyebrow={def.category}
        title={def.title}
        description={def.description}
        actions={
          <>
            {canExport ? (
              <>
                <Button size="sm" variant="outline" asChild>
                  <a href={`/api/reports/${key}/export?format=csv&${qs}`} download>
                    <Download /> CSV
                  </a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={`/api/reports/${key}/export?format=pdf&${qs}`} download>
                    <FileText /> PDF
                  </a>
                </Button>
              </>
            ) : null}
            <SaveReportButton reportKey={key} canSchedule={canExport} defaultName={def.title} selfId={ctx.userId} />
          </>
        }
      />
      <ReportFilters usesDateRange={def.usesDateRange} departments={lookups.departments} locations={lookups.locations} />
      <Reveal key={qs}>
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {def.columns.map((c) => (
                    <TableHead key={c.key} className={["number", "money", "percent"].includes(c.type) ? "text-right" : undefined}>
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.length ? (
                  result.rows.map((r, i) => (
                    <TableRow key={i}>
                      {def.columns.map((c) => (
                        <TableCell key={c.key} className={["number", "money", "percent"].includes(c.type) ? "text-right tabular" : undefined}>
                          {cell(c.type, r[c.key])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={def.columns.length} className="py-12 text-center text-sm text-muted-foreground">
                      No rows for these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
            {result.truncated ? `Showing the first ${PREVIEW_ROWS} rows. Export for the full report.` : `${result.rows.length} ${result.rows.length === 1 ? "row" : "rows"}`}
            {def.sensitive ? " · Confidential: exports are logged." : ""}
          </p>
        </div>
      </Reveal>
    </>
  );
}
