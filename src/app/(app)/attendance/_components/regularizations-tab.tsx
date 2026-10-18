import Link from "next/link";
import { ArrowRight, FilePenLine, Plus, Undo2 } from "lucide-react";
import { EmptyState, Reveal, Section } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { scopeOf, type RequestContext } from "@/server/auth/context";
import { todayCard } from "@/server/services/time/attendance";
import { myRegularizations, teamRegularizations } from "@/server/services/time/regularizations";
import { addDaysIso } from "@/lib/leave-math";
import { formatDate, formatDateTime } from "@/lib/format";
import { ConfirmAction } from "@/app/(app)/settings/_components/run-action";
import { withdrawRegularizationAction } from "../actions";
import { RegularizationDialog } from "./regularization-dialog";

type Row = Awaited<ReturnType<typeof myRegularizations>>[number];

function RegTable({ rows, showEmployee, canWithdraw }: { rows: Row[]; showEmployee?: boolean; canWithdraw?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {showEmployee ? <TableHead className="pl-5">Employee</TableHead> : null}
            <TableHead className={showEmployee ? undefined : "pl-5"}>Date</TableHead>
            <TableHead>Corrected in / out</TableHead>
            <TableHead className="hidden md:table-cell">Reason</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden lg:table-cell">Requested</TableHead>
            {canWithdraw ? <TableHead className="pr-5 text-right"><span className="sr-only">Actions</span></TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              {showEmployee ? <TableCell className="pl-5 font-medium">{r.employeeName}</TableCell> : null}
              <TableCell className={showEmployee ? "tabular" : "pl-5 tabular"}>{formatDate(r.date, "EEE, dd MMM")}</TableCell>
              <TableCell className="tabular">
                {r.requestedIn ?? "—"} – {r.requestedOut ?? "—"}
              </TableCell>
              <TableCell className="hidden max-w-72 truncate text-muted-foreground md:table-cell" title={r.reason}>
                {r.reason}
              </TableCell>
              <TableCell>
                <StatusBadge status={r.status} />
              </TableCell>
              <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{formatDateTime(r.createdAt)}</TableCell>
              {canWithdraw ? (
                <TableCell className="pr-5 text-right">
                  {r.status === "pending" ? (
                    <ConfirmAction
                      trigger={
                        <Button variant="ghost" size="sm">
                          <Undo2 /> Withdraw
                        </Button>
                      }
                      title="Withdraw this correction?"
                      description="The approval request is cancelled and the day stays as recorded."
                      confirmLabel="Withdraw"
                      action={withdrawRegularizationAction}
                      input={{ id: r.id }}
                      success="Correction withdrawn"
                    />
                  ) : null}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export async function RegularizationsTab({ ctx }: { ctx: RequestContext }) {
  const scope = scopeOf(ctx, "attendance.view");
  const showTeam = scope === "team" || scope === "all";
  const [mine, card, team] = await Promise.all([myRegularizations(ctx), todayCard(ctx), showTeam ? teamRegularizations(ctx) : Promise.resolve([])]);
  const teamPending = team.filter((r) => r.status === "pending" && r.employeeId !== ctx.employeeId);
  if (!card && !showTeam) {
    return <EmptyState icon={FilePenLine} title="Your login is not linked to an employee record" description="Attendance corrections are available once HR links your account to your employee profile." />;
  }

  return (
    <Reveal className="space-y-6">
      {card ? (
        <Section
          title="My correction requests"
          description={`Corrections can be requested for the last ${card.regularizationWindowDays} days${card.maxRegularizationsPerMonth != null ? `, up to ${card.maxRegularizationsPerMonth} per month` : ""}.`}
          actions={
            <RegularizationDialog
              trigger={
                <Button size="sm">
                  <Plus /> Request correction
                </Button>
              }
              minDate={addDaysIso(card.date, -card.regularizationWindowDays)}
              maxDate={card.date}
              windowDays={card.regularizationWindowDays}
            />
          }
        >
          {mine.length ? (
            <RegTable rows={mine} canWithdraw />
          ) : (
            <EmptyState className="m-4 border-0" icon={FilePenLine} title="No correction requests" description="Missed a check-in or check-out? Request a correction and your manager will review it." />
          )}
        </Section>
      ) : null}

      {showTeam ? (
        <Section
          title={scope === "all" ? "All correction requests" : "Team correction requests"}
          description="Approve or reject them from your inbox."
          actions={
            teamPending.length ? (
              <Button variant="outline" size="sm" asChild>
                <Link href="/inbox?tab=approvals">
                  {teamPending.length} to review <ArrowRight />
                </Link>
              </Button>
            ) : null
          }
        >
          {team.length ? (
            <RegTable rows={team} showEmployee />
          ) : (
            <EmptyState className="m-4 border-0" icon={FilePenLine} title="No requests" description="Correction requests from your team will appear here." />
          )}
        </Section>
      ) : null}
    </Reveal>
  );
}
