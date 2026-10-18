import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { monthLabel, shiftMonth } from "./status";

/** Previous / next month links that keep the other query parameters. */
export function MonthNav({ month, hrefFor, max }: { month: string; hrefFor: (month: string) => string; max?: string }) {
  const next = shiftMonth(month, 1);
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon-sm" asChild>
        <Link href={hrefFor(shiftMonth(month, -1))} scroll={false} aria-label="Previous month">
          <ChevronLeft />
        </Link>
      </Button>
      <span className="min-w-32 text-center text-sm font-medium tabular">{monthLabel(month)}</span>
      {max && next > max ? (
        <Button variant="outline" size="icon-sm" disabled aria-label="Next month">
          <ChevronRight />
        </Button>
      ) : (
        <Button variant="outline" size="icon-sm" asChild>
          <Link href={hrefFor(next)} scroll={false} aria-label="Next month">
            <ChevronRight />
          </Link>
        </Button>
      )}
    </div>
  );
}
