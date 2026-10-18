"use client";

import { useState } from "react";
import { cn } from "cn";
import { DAY_STATUS, minutesLabel, statusLabel } from "./status";
import { RegularizationDialog } from "./regularization-dialog";

export type CalendarDay = {
  date: string;
  status: string;
  payableFraction: number;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  isRegularized: boolean;
  locked: boolean;
};

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function datesOfMonth(month: string) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/**
 * Month grid of computed attendance days. Past days inside the correction
 * window can be clicked to request a correction (self view only).
 */
export function MonthCalendar({
  month,
  today,
  days,
  weeklyOffDates,
  holidayDates,
  pendingLeaveDates,
  correction,
}: {
  month: string;
  today: string;
  days: CalendarDay[];
  weeklyOffDates: string[];
  holidayDates: string[];
  pendingLeaveDates: string[];
  /** When set, the viewer may request corrections between minDate and today. */
  correction: { minDate: string; windowDays: number } | null;
}) {
  const [selected, setSelected] = useState<CalendarDay | { date: string } | null>(null);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const offs = new Set(weeklyOffDates);
  const hols = new Set(holidayDates);
  const pend = new Set(pendingLeaveDates);
  const dates = datesOfMonth(month);
  const lead = (new Date(`${dates[0]}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...dates];
  while (cells.length % 7) cells.push(null);

  const canCorrect = (date: string, d?: CalendarDay) => !!correction && date >= correction.minDate && date <= today && !d?.locked;

  return (
    <>
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-[11px] font-medium text-muted-foreground">
          {WEEK.map((w) => (
            <div key={w} className="py-2">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((date, i) => {
            if (!date) return <div key={`x${i}`} className="min-h-16 border-r border-b bg-muted/20 last:border-r-0 sm:min-h-24" />;
            const d = byDate.get(date);
            const meta = d ? DAY_STATUS[d.status] : null;
            const isToday = date === today;
            const fallback = !d ? (hols.has(date) ? "Holiday" : offs.has(date) ? "Weekly off" : pend.has(date) ? "Leave pending" : null) : null;
            const clickable = canCorrect(date, d);
            const title = d
              ? `${date}: ${statusLabel(d.status)}${d.firstIn ? ` · in ${d.firstIn}` : ""}${d.lastOut ? ` · out ${d.lastOut}` : ""} · payable ${d.payableFraction}`
              : `${date}${fallback ? `: ${fallback}` : ""}`;
            const body = (
              <>
                <div className="flex items-center justify-between gap-1">
                  <span className={cn("text-xs tabular", isToday ? "flex size-5 items-center justify-center rounded-full bg-foreground font-semibold text-background" : "text-muted-foreground")}>
                    {Number(date.slice(8))}
                  </span>
                  {d?.isRegularized ? <span className="hidden text-[10px] text-info sm:inline">corrected</span> : null}
                </div>
                {meta ? (
                  <span className={cn("mt-1 inline-flex w-fit rounded px-1 text-[10.5px] font-medium sm:px-1.5", meta.cell)}>
                    <span className="sm:hidden">{meta.short}</span>
                    <span className="hidden sm:inline">{meta.label}</span>
                  </span>
                ) : fallback ? (
                  <span className="mt-1 hidden text-[10.5px] text-muted-foreground sm:inline">{fallback}</span>
                ) : null}
                {d && (d.firstIn || d.lastOut) ? (
                  <span className="mt-auto hidden text-[10.5px] text-muted-foreground tabular sm:block">
                    {d.firstIn ?? "—"}–{d.lastOut ?? "—"}
                    {d.workedMinutes ? ` · ${minutesLabel(d.workedMinutes)}` : ""}
                  </span>
                ) : null}
                {d && d.lateMinutes > 0 ? <span className="hidden text-[10.5px] text-warning sm:block">Late {d.lateMinutes}m</span> : null}
              </>
            );
            const cls = cn(
              "flex min-h-16 flex-col items-stretch gap-0.5 border-r border-b p-1.5 text-left sm:min-h-24 sm:p-2 [&:nth-child(7n)]:border-r-0",
              (offs.has(date) || hols.has(date)) && !d && "bg-muted/30",
            );
            return clickable ? (
              <button
                key={date}
                type="button"
                title={`${title} — click to request a correction`}
                onClick={() => setSelected(d ?? { date })}
                className={cn(cls, "transition-colors hover:bg-muted/50 focus-visible:relative focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none")}
              >
                {body}
              </button>
            ) : (
              <div key={date} title={title} className={cls}>
                {body}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-muted-foreground">
        {Object.entries(DAY_STATUS).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-sm", v.dot)} />
            {v.label}
          </span>
        ))}
      </div>
      {correction ? (
        <RegularizationDialog
          open={!!selected}
          onOpenChange={(o) => !o && setSelected(null)}
          date={selected?.date}
          inTime={selected && "firstIn" in selected ? selected.firstIn : null}
          outTime={selected && "lastOut" in selected ? selected.lastOut : null}
          minDate={correction.minDate}
          maxDate={today}
          windowDays={correction.windowDays}
        />
      ) : null}
    </>
  );
}
