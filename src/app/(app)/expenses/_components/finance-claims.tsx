import { unstable_rethrow } from "next/navigation";
import { Download, FileClock, Search } from "lucide-react";
import { EmptyState, ErrorState, NoAccess, Reveal } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { can, type RequestContext } from "@/server/auth/context";
import { logger } from "@/server/lib/logger";
import { canManageExpenses } from "@/server/services/expenses/categories";
import { canExportExpenses, financeSummary, listAllClaims } from "@/server/services/expenses/reports";
import { CLAIM_STATUSES, claimFilterSchema } from "@/lib/validation/expenses";
import { formatMoney, titleCase } from "@/lib/format";
import { ClaimsTable } from "./my-claims";
import { Stat, StatStrip } from "./shared";

const selectClass =
  "h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export async function FinanceClaims({ ctx, filter: raw }: { ctx: RequestContext; filter: { status?: string; q?: string; month?: string } }) {
  if (!canManageExpenses(ctx)) return <NoAccess />;
  const parsed = claimFilterSchema.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v)));
  const filter = parsed.success ? parsed.data : {};
  let data;
  try {
    data = await Promise.all([financeSummary(ctx), listAllClaims(ctx, filter)]);
  } catch (err) {
    unstable_rethrow(err);
    logger.error("expenses.finance_failed", { err });
    return <ErrorState title="Could not load claims" />;
  }
  const [summary, claims] = data;
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]).toString();
  const exportable = canExportExpenses(ctx);

  return (
    <Reveal className="space-y-5">
      <StatStrip>
        <Stat label="Awaiting approval" value={summary.pending} hint={formatMoney(summary.pendingAmount, "INR", { compact: true })} />
        <Stat label="To pay by bank transfer" value={summary.toPay} hint={formatMoney(summary.toPayAmount, "INR", { compact: true })} tone={summary.toPay ? "warning" : undefined} />
        <Stat label="Approved · awaiting payroll period" value={summary.awaitingPayroll} tone={summary.awaitingPayroll ? "warning" : undefined} hint="Posted automatically when a period opens" />
        <Stat label="Posted to payroll" value={summary.postedToPayroll} />
      </StatStrip>

      <form method="get" className="flex flex-wrap items-end gap-2" role="search" aria-label="Filter claims">
        <input type="hidden" name="tab" value="finance" />
        <label className="grid gap-1 text-xs text-muted-foreground">
          Search
          <span className="relative">
            <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" aria-hidden />
            <Input name="q" defaultValue={filter.q ?? ""} placeholder="Claim, title or employee" className="h-8 w-56 pl-8" />
          </span>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Status
          <select name="status" defaultValue={filter.status ?? ""} className={selectClass}>
            <option value="">All submitted</option>
            {CLAIM_STATUSES.filter((s) => s !== "draft").map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Submitted in
          <Input type="month" name="month" defaultValue={filter.month ?? ""} className="h-8 w-40" />
        </label>
        <Button type="submit" size="sm" variant="outline">
          Apply
        </Button>
        <div className="ml-auto flex gap-2">
          {exportable ? (
            <Button asChild size="sm" variant="outline">
              <a href={`/expenses/export?type=claims${qs ? `&${qs}` : ""}`}>
                <Download data-icon="inline-start" /> Export CSV
              </a>
            </Button>
          ) : null}
          {exportable && can(ctx, "audit.view", "all") ? (
            <Button asChild size="sm" variant="ghost">
              {/* A CSV download from a route handler, not a page navigation. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/expenses/export?type=audit">
                <FileClock data-icon="inline-start" /> Audit trail
              </a>
            </Button>
          ) : null}
        </div>
      </form>

      {claims.length ? (
        <ClaimsTable claims={claims} showEmployee />
      ) : (
        <EmptyState icon={Search} title="No claims match" description="Submitted claims from every employee appear here. Try clearing the filters." />
      )}
    </Reveal>
  );
}
