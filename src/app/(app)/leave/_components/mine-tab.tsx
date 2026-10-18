import Link from "next/link";
import { CalendarPlus, Palmtree, UserRound } from "lucide-react";
import { cn } from "cn";
import { EmptyState, Reveal, Section } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RequestContext } from "@/server/auth/context";
import { balancesFor } from "@/server/services/time/leave-ledger";
import { myLeaveRequests } from "@/server/services/time/leave-requests";
import { formatDate, todayIn } from "@/lib/format";
import { BalanceCards } from "./balance-cards";
import { CancelLeaveButton } from "./request-row-actions";
import { daysLabel, dotClass, rangeLabel } from "./tones";

export async function MineTab({ ctx }: { ctx: RequestContext }) {
  if (!ctx.employeeId) {
    return <EmptyState icon={UserRound} title="Your login is not linked to an employee record" description="Leave balances and requests appear once HR links your account to your employee profile." />;
  }
  const [cards, requests] = await Promise.all([balancesFor(ctx, ctx.employeeId), myLeaveRequests(ctx)]);
  const today = todayIn();
  if (!cards.length) {
    return <EmptyState icon={Palmtree} title="Leave is not set up yet" description="HR has not configured leave types for your organization yet." />;
  }
  return (
    <Reveal className="space-y-6">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Balances</h2>
          <Link href={`/leave/balances/${ctx.employeeId}`} className="text-xs text-muted-foreground hover:text-foreground">
            View history
          </Link>
        </div>
        <BalanceCards cards={cards} />
      </div>
      <Section
        title="My requests"
        actions={
          <Button size="sm" asChild>
            <Link href="/leave/new">
              <CalendarPlus /> Apply leave
            </Link>
          </Button>
        }
      >
        {requests.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Leave</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Reason</TableHead>
                  <TableHead className="pr-5 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => {
                  const cancellable = r.status === "pending" || (r.status === "approved" && r.endDate >= today);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="pl-5">
                        <Link href={`/leave/requests/${r.id}`} className="inline-flex items-center gap-2 font-medium hover:underline">
                          <span className={cn("size-2 rounded-full", dotClass(r.typeColor))} aria-hidden />
                          {r.typeName}
                        </Link>
                      </TableCell>
                      <TableCell className="tabular">{rangeLabel(r, (d) => formatDate(d, "dd MMM yyyy"))}</TableCell>
                      <TableCell className="text-right tabular">{daysLabel(r.days)}</TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="hidden max-w-64 truncate text-muted-foreground md:table-cell" title={r.reason ?? undefined}>
                        {r.reason ?? "—"}
                      </TableCell>
                      <TableCell className="pr-5 text-right">{cancellable ? <CancelLeaveButton requestId={r.id} status={r.status} /> : null}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState className="m-4 border-0" icon={Palmtree} title="No leave requests yet" description="Plan some time off: your requests and their approval status will show here." />
        )}
      </Section>
    </Reveal>
  );
}
