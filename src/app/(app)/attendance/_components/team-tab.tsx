import { CalendarCheck, Users } from "lucide-react";
import { EmptyState, Reveal, Section } from "@/components/page";
import { PersonCell } from "@/components/person";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RequestContext } from "@/server/auth/context";
import { teamToday } from "@/server/services/time/attendance";
import { formatDate } from "@/lib/format";
import { Stat, StatStrip } from "./stat";
import { DAY_STATUS, statusLabel } from "./status";

export async function TeamTab({ ctx }: { ctx: RequestContext }) {
  const data = await teamToday(ctx);
  if (!data.rows.length) {
    return <EmptyState icon={Users} title="No team members" description="People who report to you, directly or indirectly, appear here." />;
  }
  const count = (pred: (r: (typeof data.rows)[number]) => boolean) => data.rows.filter(pred).length;
  const checkedIn = count((r) => !!r.firstIn);
  const onLeave = count((r) => r.status === "on_leave" || r.leave?.status === "approved");
  const late = count((r) => r.lateMinutes > 0);
  const notIn = count((r) => !r.firstIn && r.status !== "on_leave" && r.status !== "holiday" && r.status !== "weekly_off" && r.leave?.status !== "approved");

  return (
    <Reveal className="space-y-6">
      <StatStrip className="lg:grid-cols-4">
        <Stat label="Team size" value={data.rows.length} />
        <Stat label="Checked in" value={checkedIn} tone="success" />
        <Stat label="On leave" value={onLeave} />
        <Stat label="Not checked in" value={notIn} hint={late ? `${late} late today` : undefined} tone={notIn ? "warning" : undefined} />
      </StatStrip>

      <Section title={`Today · ${formatDate(data.today, "EEE, dd MMM")}`}>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Employee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>In</TableHead>
                <TableHead>Out</TableHead>
                <TableHead className="pr-5">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => {
                const meta = r.status ? DAY_STATUS[r.status] : null;
                return (
                  <TableRow key={r.employeeId}>
                    <TableCell className="pl-5">
                      <PersonCell id={r.employeeId} name={r.name} subtitle={r.code} />
                    </TableCell>
                    <TableCell>
                      {r.status ? <StatusBadge status={r.status} label={statusLabel(r.status)} tone={meta?.tone} /> : <span className="text-xs text-muted-foreground">Not checked in</span>}
                    </TableCell>
                    <TableCell className="tabular">{r.firstIn ?? "—"}</TableCell>
                    <TableCell className="tabular">{r.lastOut ?? "—"}</TableCell>
                    <TableCell className="pr-5 text-xs text-muted-foreground">
                      {[r.lateMinutes ? `Late by ${r.lateMinutes} min` : null, r.leave ? `${r.leave.type} (${r.leave.status})` : null].filter(Boolean).join(" · ") || "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title="Exceptions in the last 7 days" description="Missing punches, absences and late arrivals. Employees can fix missing punches with a correction request.">
        {data.exceptions.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Date</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-5">In / out</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.exceptions.map((x) => (
                  <TableRow key={`${x.employeeId}-${x.date}`}>
                    <TableCell className="pl-5 tabular">{formatDate(x.date, "EEE, dd MMM")}</TableCell>
                    <TableCell>{x.name}</TableCell>
                    <TableCell>
                      <StatusBadge status={x.status} label={x.lateMinutes && x.status === "present" ? `Late ${x.lateMinutes}m` : statusLabel(x.status)} tone={x.lateMinutes && x.status === "present" ? "warning" : DAY_STATUS[x.status]?.tone} />
                    </TableCell>
                    <TableCell className="pr-5 tabular text-muted-foreground">
                      {x.firstIn ?? "—"} – {x.lastOut ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState className="m-4 border-0" icon={CalendarCheck} title="No exceptions" description="Nobody in your team had a missing punch, absence or late arrival this week." />
        )}
      </Section>
    </Reveal>
  );
}
