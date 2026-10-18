import { CalendarCheck } from "lucide-react";
import { EmptyState, Reveal, Section } from "@/components/page";
import { PersonCell } from "@/components/person";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, type RequestContext } from "@/server/auth/context";
import { attendanceForDate } from "@/server/services/time/attendance";
import { employeeFormLookups } from "@/server/services/employees/lookups";
import { addDaysIso } from "@/lib/leave-math";
import { formatDate, formatNumber } from "@/lib/format";
import { DeviceImportDialog } from "./device-import-dialog";
import { ExportLink } from "./export-link";
import { QueryInput } from "./query-input";
import { RecomputeDialog } from "./recompute-dialog";
import { Stat, StatStrip } from "./stat";
import { DAY_STATUS, minutesLabel, statusLabel } from "./status";

export async function AllTab({ ctx, date, today }: { ctx: RequestContext; date: string; today: string }) {
  const canManage = can(ctx, "attendance.manage", "all");
  const canExport = canManage || can(ctx, "reports.export", "all");
  const [data, lookups] = await Promise.all([attendanceForDate(ctx, date), canManage ? employeeFormLookups(ctx) : null]);
  const c = (k: string) => data.counts[k] ?? 0;
  const recomputeTo = date < today ? date : addDaysIso(today, -1);

  return (
    <Reveal className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <QueryInput name="date" type="date" value={date} label="Date" />
        <div className="flex flex-wrap items-center gap-2">
          {canExport ? <ExportLink month={date.slice(0, 7)} /> : null}
          {canManage && lookups ? <RecomputeDialog from={addDaysIso(recomputeTo, -6)} to={recomputeTo} employees={lookups.managers} /> : null}
          {canManage ? <DeviceImportDialog /> : null}
        </div>
      </div>

      <StatStrip>
        <Stat label="Employed" value={formatNumber(data.activeEmployees)} />
        <Stat label="Present" value={formatNumber(c("present"))} tone="success" />
        <Stat label="Half day" value={formatNumber(c("half_day"))} />
        <Stat label="Absent" value={formatNumber(c("absent"))} tone={c("absent") ? "danger" : undefined} />
        <Stat label="Missing punch" value={formatNumber(c("missing_punch"))} tone={c("missing_punch") ? "warning" : undefined} />
        <Stat label="On leave" value={formatNumber(c("on_leave"))} />
        <Stat label="Holiday / off" value={formatNumber(c("holiday") + c("weekly_off"))} />
        <Stat
          label="Not processed"
          value={formatNumber(data.notComputed)}
          hint={date >= today ? "Today is finalized overnight" : data.notComputed ? "Use Recompute period" : "All processed"}
          tone={data.notComputed && date < today ? "warning" : undefined}
        />
      </StatStrip>

      <Section title={`Exceptions · ${formatDate(date, "EEE, dd MMM yyyy")}`} description="Missing punches, absences, half days and late arrivals.">
        {data.exceptions.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Employee</TableHead>
                  <TableHead className="hidden md:table-cell">Department</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>In / out</TableHead>
                  <TableHead className="text-right">Worked</TableHead>
                  <TableHead className="pr-5 text-right">Late</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.exceptions.map((x) => (
                  <TableRow key={x.employeeId}>
                    <TableCell className="pl-5">
                      <PersonCell id={x.employeeId} name={x.name} subtitle={x.code} href={`/employees/${x.employeeId}`} />
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{x.department ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={x.status} label={statusLabel(x.status)} tone={DAY_STATUS[x.status]?.tone} />
                        {x.isRegularized ? <StatusBadge status="corrected" label="Corrected" tone="info" /> : null}
                      </div>
                    </TableCell>
                    <TableCell className="tabular text-muted-foreground">
                      {x.firstIn ?? "—"} – {x.lastOut ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular">{minutesLabel(x.workedMinutes)}</TableCell>
                    <TableCell className="pr-5 text-right tabular">{x.lateMinutes ? `${x.lateMinutes}m` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState className="m-4 border-0" icon={CalendarCheck} title="No exceptions" description="No missing punches, absences or late arrivals recorded for this date." />
        )}
      </Section>
    </Reveal>
  );
}
