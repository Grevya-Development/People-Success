import { CalendarDays } from "lucide-react";
import { cn } from "cn";
import { EmptyState, Reveal } from "@/components/page";
import type { RequestContext } from "@/server/auth/context";
import { teamLeaveCalendar } from "@/server/services/time/leave-requests";
import { MonthNav } from "@/app/(app)/attendance/_components/month-nav";
import { softClass } from "./tones";

const WD = ["S", "M", "T", "W", "T", "F", "S"];

/** Who is off this month: one row per person, one column per day. */
export async function CalendarTab({ ctx, month }: { ctx: RequestContext; month: string }) {
  const data = await teamLeaveCalendar(ctx, month);
  const hol = new Set(data.holidays);
  const header = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground">
        {data.people.length} of {data.totalPeople} people {data.people.length < data.totalPeople ? "with leave this month" : ""}
      </p>
      <MonthNav month={month} hrefFor={(m) => `/leave?tab=calendar&month=${m}`} />
    </div>
  );
  if (!data.people.length) {
    return (
      <Reveal>
        {header}
        <EmptyState icon={CalendarDays} title="Nobody is off this month" description="Approved and pending leave of your team appears here." />
      </Reveal>
    );
  }
  return (
    <Reveal>
      {header}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[900px] border-collapse text-xs">
          <thead>
            <tr className="border-b bg-muted/40 text-muted-foreground">
              <th className="sticky left-0 z-10 min-w-44 bg-muted px-3 py-2 text-left font-medium">Person</th>
              {data.dates.map((d) => {
                const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
                return (
                  <th key={d} className={cn("w-7 px-0 py-1.5 text-center font-normal", (wd === 0 || wd === 6) && "bg-muted", hol.has(d) && "bg-brand-soft text-brand")} title={hol.has(d) ? "Holiday" : undefined}>
                    <span className="block text-[10px]">{WD[wd]}</span>
                    <span className="tabular">{Number(d.slice(8))}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.people.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="sticky left-0 z-10 bg-card px-3 py-1.5">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="text-[10.5px] text-muted-foreground">{p.code}</span>
                </td>
                {data.dates.map((d) => {
                  const c = p.cells[d];
                  const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
                  return (
                    <td key={d} className={cn("h-9 p-0.5 text-center", (wd === 0 || wd === 6 || hol.has(d)) && "bg-muted/40")}>
                      {c ? (
                        <span
                          title={`${c.name} (${c.status})${c.session !== "full" ? ` · ${c.session.replace("_", " ")}` : ""}`}
                          className={cn(
                            "flex h-full items-center justify-center rounded text-[10px] font-medium",
                            softClass(c.color),
                            c.status === "pending" && "opacity-60 ring-1 ring-current/30 ring-inset",
                          )}
                        >
                          {c.code}
                          {c.session !== "full" ? "½" : ""}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11.5px] text-muted-foreground">Faded cells are pending approval. ½ marks a half day. Shaded columns are weekends and holidays of the default calendar.</p>
    </Reveal>
  );
}
