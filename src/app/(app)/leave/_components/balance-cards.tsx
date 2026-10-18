import { cn } from "cn";
import type { BalanceCard } from "@/server/services/time/leave-ledger";
import { daysLabel, dotClass } from "./tones";

/** One card per active leave type: available = balance − pending. */
export function BalanceCards({ cards }: { cards: BalanceCard[] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.leaveTypeId} className="bg-card p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span className={cn("size-2 rounded-full", dotClass(c.color))} aria-hidden />
            <span className="truncate">{c.name}</span>
            <span className="text-[10.5px]">{c.code}</span>
          </p>
          {c.tracksBalance ? (
            <>
              <p className={cn("mt-2 text-2xl leading-none font-semibold tracking-tight tabular", c.available < 0 && "text-danger")}>{c.available}</p>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                available
                {c.pending ? ` · ${daysLabel(c.pending)} pending` : ""}
                {c.policy && c.policy.accrual !== "none" ? ` · ${c.policy.daysPerYear}/yr` : ""}
                {!c.policy ? " · no policy" : ""}
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm font-medium">Unpaid</p>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">No balance; deducted in payroll</p>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
