import { unstable_rethrow } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { EmptyState, ErrorState, NoAccess, Reveal, Section } from "@/components/page";
import type { RequestContext } from "@/server/auth/context";
import { logger } from "@/server/lib/logger";
import { canSeeExpenseReports, spendReport, type SpendReport } from "@/server/services/expenses/reports";
import { formatDate, formatMoney } from "@/lib/format";
import { BarRow } from "./shared";

export async function SpendReports({ ctx }: { ctx: RequestContext }) {
  if (!canSeeExpenseReports(ctx)) return <NoAccess />;
  let report: SpendReport;
  try {
    report = await spendReport(ctx);
  } catch (err) {
    unstable_rethrow(err);
    logger.error("expenses.report_failed", { err });
    return <ErrorState title="Could not load spend reports" />;
  }
  if (!report.total) {
    return <EmptyState icon={BarChart3} title="No approved spend yet" description="Approved and reimbursed expenses from the last 12 months will be summarized here." />;
  }
  const maxCat = Math.max(...report.byCategory.map((r) => r.amount));
  const maxDept = Math.max(...report.byDepartment.map((r) => r.amount));
  const maxMonth = Math.max(...report.byMonth.map((r) => r.amount));
  const monthLabel = (m: string) => formatDate(`${m}-01`, "MMM yyyy");

  return (
    <Reveal className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Approved and reimbursed spend since {formatDate(report.since)}, by expense date:{" "}
        <span className="font-medium text-foreground tabular">{formatMoney(report.total)}</span>
      </p>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="By category">
          <ul className="px-5 py-3">
            {report.byCategory.map((r) => (
              <BarRow key={r.name} label={`${r.name} (${r.items})`} value={r.amount} max={maxCat} display={formatMoney(r.amount, "INR", { compact: true })} />
            ))}
          </ul>
        </Section>
        <Section title="By department" description="Employee's current department.">
          <ul className="px-5 py-3">
            {report.byDepartment.map((r) => (
              <BarRow key={r.name} label={`${r.name} (${r.claims} claims)`} value={r.amount} max={maxDept} display={formatMoney(r.amount, "INR", { compact: true })} />
            ))}
          </ul>
        </Section>
      </div>
      <Section title="By month">
        <ul className="px-5 py-3">
          {report.byMonth.map((r) => (
            <BarRow key={r.month} label={monthLabel(r.month)} value={r.amount} max={maxMonth} display={formatMoney(r.amount, "INR", { compact: true })} />
          ))}
        </ul>
      </Section>
    </Reveal>
  );
}
