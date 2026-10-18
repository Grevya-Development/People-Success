import { Clock, UserRound } from "lucide-react";
import { EmptyState, Reveal, Section } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import type { RequestContext } from "@/server/auth/context";
import { attendanceMonth, todayCard } from "@/server/services/time/attendance";
import { addDaysIso } from "@/lib/leave-math";
import { formatDate, formatNumber } from "@/lib/format";
import { PunchButton } from "./punch-button";
import { MonthCalendar } from "./month-calendar";
import { MonthNav } from "./month-nav";
import { Stat, StatStrip } from "./stat";
import { DAY_STATUS, VERIFICATION, minutesLabel, statusLabel } from "./status";

export async function MineTab({ ctx, month }: { ctx: RequestContext; month: string }) {
  if (!ctx.employeeId) {
    return (
      <EmptyState
        icon={UserRound}
        title="Your login is not linked to an employee record"
        description="Attendance appears here once HR links your account to your employee profile."
      />
    );
  }
  const [card, data] = await Promise.all([todayCard(ctx), attendanceMonth(ctx, ctx.employeeId, month)]);
  if (!card) return null;
  const s = data.summary;
  const minDate = addDaysIso(card.date, -card.regularizationWindowDays);
  const dayMeta = card.day ? DAY_STATUS[card.day.status] : null;

  return (
    <Reveal className="space-y-6">
      <Section>
        <div className="flex flex-col gap-5 p-5 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 space-y-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Today · {formatDate(card.date, "EEEE, dd MMM")}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight">
                  {card.events.length === 0 ? "Not checked in yet" : card.nextKind === "out" ? `Checked in at ${[...card.events].reverse().find((e) => e.kind === "in")?.time}` : `Checked out at ${card.events[card.events.length - 1].time}`}
                </h2>
                {card.day && card.day.status !== "missing_punch" ? <StatusBadge status={card.day.status} label={statusLabel(card.day.status)} tone={dayMeta?.tone} /> : null}
              </div>
              {card.shift ? (
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Clock className="size-3.5" />
                  {card.shift.name} · {card.shift.isFlexible ? "flexible hours" : `${card.shift.start}–${card.shift.end}`}
                  {card.day?.workedMinutes ? ` · ${minutesLabel(card.day.workedMinutes)} worked` : ""}
                </p>
              ) : null}
            </div>
            {card.events.length ? (
              <ol className="flex flex-wrap gap-2" aria-label="Today's punches">
                {card.events.map((e) => {
                  const v = VERIFICATION[e.verification];
                  return (
                    <li key={e.at} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs">
                      <span className="font-medium capitalize">{e.kind}</span>
                      <span className="tabular">{e.time}</span>
                      <StatusBadge status={e.verification} label={v?.label} tone={v?.tone} />
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </div>
          <div className="shrink-0 md:max-w-xs">
            {card.allowWebCheckIn ? (
              <PunchButton nextKind={card.nextKind} geofence={card.geofence} requireGeofence={card.requireGeofence} />
            ) : (
              <p className="max-w-xs text-sm text-muted-foreground">Web check-in is turned off by your attendance policy. Use the attendance device at your office.</p>
            )}
          </div>
        </div>
      </Section>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Monthly summary</h2>
          <MonthNav month={month} hrefFor={(m) => `/attendance?tab=mine&month=${m}`} max={card.date.slice(0, 7)} />
        </div>
        <StatStrip>
          <Stat label="Present" value={formatNumber(s.present)} />
          <Stat label="Half days" value={formatNumber(s.halfDays)} />
          <Stat label="Absent" value={formatNumber(s.absent)} tone={s.absent ? "danger" : undefined} />
          <Stat label="Missing punch" value={formatNumber(s.missingPunch)} tone={s.missingPunch ? "warning" : undefined} />
          <Stat label="On leave" value={formatNumber(s.onLeave)} />
          <Stat label="Late marks" value={formatNumber(s.lateMarks)} tone={s.lateMarks ? "warning" : undefined} />
          <Stat label="Overtime" value={minutesLabel(s.overtimeMinutes)} />
          <Stat label="LOP days" value={formatNumber(s.lopDays, 1)} hint={s.pendingDays ? `${s.pendingDays} day(s) not processed yet` : "Loss of pay"} tone={s.lopDays ? "danger" : undefined} />
        </StatStrip>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Calendar</h2>
          <p className="text-xs text-muted-foreground">Click a day from {formatDate(minDate, "dd MMM")} onward to request a correction.</p>
        </div>
        <MonthCalendar
          month={month}
          today={data.today}
          days={data.days}
          weeklyOffDates={data.weeklyOffDates}
          holidayDates={data.holidayDates}
          pendingLeaveDates={data.pendingLeaveDates}
          correction={{ minDate: minDate < data.employee.joiningDate ? data.employee.joiningDate : minDate, windowDays: card.regularizationWindowDays }}
        />
      </div>
    </Reveal>
  );
}
