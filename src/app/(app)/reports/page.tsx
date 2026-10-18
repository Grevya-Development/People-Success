import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BarChart3, Lock } from "lucide-react";
import { EmptyState, NoAccess, Page, PageHeader, Reveal, Section, TableSkeleton } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { can, requireContext } from "@/server/auth/context";
import { availableReports, listSavedReports } from "@/server/services/reports/service";
import { reportDefinition } from "@/server/services/reports/catalog";
import { formatDateTime } from "@/lib/format";
import { DeleteSavedReport } from "./report-controls";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <Page>
      <PageHeader title="Reports & analytics" description="Standard reports with consistent definitions. Exports are permission-checked and logged." />
      <Suspense fallback={<TableSkeleton rows={8} columns={3} />}>
        <Catalog />
      </Suspense>
    </Page>
  );
}

async function Catalog() {
  const ctx = await requireContext();
  if (!can(ctx, "reports.view", "all") && !can(ctx, "analytics.executive", "all")) return <NoAccess />;
  const reports = availableReports(ctx);
  const saved = can(ctx, "reports.view", "all") ? await listSavedReports(ctx) : [];
  const categories = [...new Set(reports.map((r) => r.category))];
  if (!reports.length) return <EmptyState icon={BarChart3} title="No reports available" description="Your role does not include access to the data behind any standard report." />;
  return (
    <Reveal className="space-y-8">
      {categories.map((cat) => (
        <section key={cat}>
          <h2 className="mb-3 text-sm font-semibold">{cat}</h2>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {reports
              .filter((r) => r.category === cat)
              .map((r) => (
                <li key={r.key}>
                  <Link href={`/reports/${r.key}`} className="flex h-full flex-col rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {r.title}
                      {r.sensitive ? <Lock className="size-3.5 text-muted-foreground" aria-label="Confidential" /> : null}
                    </span>
                    <span className="mt-1 text-sm text-muted-foreground">{r.description}</span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
      {saved.length ? (
        <Section title="Saved and scheduled reports">
          <ul className="divide-y">
            {saved.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <Link href={`/reports/${s.reportKey}`} className="font-medium hover:underline">
                  {s.name}
                </Link>
                <span className="text-muted-foreground">{reportDefinition(s.reportKey)?.title}</span>
                {s.schedule ? <StatusBadge status="active" tone="info" label={`${s.schedule[0].toUpperCase()}${s.schedule.slice(1)}`} /> : null}
                <span className="ml-auto text-xs text-muted-foreground">
                  {s.nextRunAt ? `Next ${formatDateTime(s.nextRunAt)}` : s.lastRunAt ? `Last ${formatDateTime(s.lastRunAt)}` : ""}
                </span>
                <DeleteSavedReport id={s.id} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </Reveal>
  );
}
