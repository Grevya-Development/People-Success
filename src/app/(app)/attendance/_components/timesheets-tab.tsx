import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardList, UserRound } from "lucide-react";
import { EmptyState, Reveal, Section } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { scopeOf, type RequestContext } from "@/server/auth/context";
import { getWeekTimesheet, listProjects, teamTimesheets, weekStartOf } from "@/server/services/time/timesheets";
import { addDaysIso } from "@/lib/leave-math";
import { formatDate } from "@/lib/format";
import { TimesheetEditor } from "./timesheet-editor";
import { minutesLabel } from "./status";

function WeekNav({ week }: { week: string }) {
  const href = (w: string) => `/attendance?tab=timesheets&week=${w}`;
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon-sm" asChild>
        <Link href={href(addDaysIso(week, -7))} scroll={false} aria-label="Previous week">
          <ChevronLeft />
        </Link>
      </Button>
      <span className="min-w-44 text-center text-sm font-medium tabular">
        {formatDate(week, "dd MMM")} – {formatDate(addDaysIso(week, 6), "dd MMM yyyy")}
      </span>
      <Button variant="outline" size="icon-sm" asChild>
        <Link href={href(addDaysIso(week, 7))} scroll={false} aria-label="Next week">
          <ChevronRight />
        </Link>
      </Button>
    </div>
  );
}

export async function TimesheetsTab({ ctx, week }: { ctx: RequestContext; week: string }) {
  const start = weekStartOf(week);
  const scope = scopeOf(ctx, "attendance.view");
  const showTeam = scope === "team" || scope === "all";
  const [mine, projects, team] = await Promise.all([
    ctx.employeeId ? getWeekTimesheet(ctx, ctx.employeeId, start) : Promise.resolve(null),
    listProjects(ctx, { activeOnly: true }),
    showTeam ? teamTimesheets(ctx, start) : Promise.resolve(null),
  ]);
  const projectOptions = projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }));

  return (
    <Reveal className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <WeekNav week={start} />
        {!projects.length ? <p className="text-xs text-muted-foreground">No projects yet: time can be logged without a project.</p> : null}
      </div>

      {mine ? (
        <Section title="My timesheet" description="Log hours per project and task, then submit the week for approval.">
          <div className="p-4">
            <TimesheetEditor
              key={mine.weekStart}
              sheet={{ id: mine.sheet?.id ?? null, status: mine.sheet?.status ?? "draft", weekStart: mine.weekStart }}
              entries={mine.entries.map((e) => ({ date: e.date, projectId: e.projectId, task: e.task, minutes: e.minutes }))}
              projects={projectOptions}
            />
          </div>
        </Section>
      ) : !ctx.employeeId ? (
        <EmptyState icon={UserRound} title="Your login is not linked to an employee record" description="Timesheets are available once HR links your account to your employee profile." />
      ) : null}

      {team ? (
        <Section title={scope === "all" ? "Everyone's timesheets" : "Team timesheets"} description="Submitted timesheets are approved from your inbox.">
          {team.rows.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Employee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Logged</TableHead>
                    <TableHead className="pr-5 text-right">
                      <span className="sr-only">Open</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {team.rows.map((r) => (
                    <TableRow key={r.employeeId}>
                      <TableCell className="pl-5">
                        <span className="font-medium">{r.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{r.code}</span>
                      </TableCell>
                      <TableCell>{r.status ? <StatusBadge status={r.status} /> : <span className="text-xs text-muted-foreground">Not started</span>}</TableCell>
                      <TableCell className="text-right tabular">{minutesLabel(r.totalMinutes)}</TableCell>
                      <TableCell className="pr-5 text-right">
                        {r.timesheetId ? (
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/attendance/timesheets/${r.timesheetId}`}>View</Link>
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyState className="m-4 border-0" icon={ClipboardList} title="No team members" description="Timesheets of people reporting to you appear here." />
          )}
        </Section>
      ) : null}
    </Reveal>
  );
}
