import Link from "next/link";
import { Info, Lock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { MetricValue } from "@/server/services/analytics/metrics";

function formatMetric(m: Extract<MetricValue, { kind: "value" }>) {
  if (m.value === null || Number.isNaN(m.value)) return "—";
  switch (m.unit) {
    case "percent":
      return `${(m.value * 100).toFixed(m.value < 0.1 ? 1 : 0)}%`;
    case "inr_paise":
      return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: "compact", maximumFractionDigits: 1 }).format(m.value / 100);
    case "days":
      return `${m.value.toFixed(m.value < 10 ? 1 : 0)} d`;
    case "hours":
      return `${m.value.toFixed(m.value < 10 ? 1 : 0)} h`;
    case "score":
      return m.value.toFixed(0);
    default:
      return new Intl.NumberFormat("en-IN", { notation: m.value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(m.value);
  }
}

/** KPI tile: label, value (proportional figures), definition on hover, honest "restricted" state. */
export function StatTile({ label, metric, href }: { label: string; metric: MetricValue; href?: string }) {
  const body = (
    <div className="h-full bg-card p-4 transition-colors hover:bg-muted/40">
      <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        <Tooltip>
          <TooltipTrigger aria-label={`Definition: ${label}`} className="text-muted-foreground/70">
            <Info className="size-3" />
          </TooltipTrigger>
          <TooltipContent className="max-w-72">{metric.definition}</TooltipContent>
        </Tooltip>
      </p>
      {metric.kind === "restricted" ? (
        <p className="mt-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
          <Lock className="size-3.5" /> Restricted
        </p>
      ) : (
        <p className="mt-1.5 text-[24px] leading-tight font-semibold tracking-tight">{formatMetric(metric)}</p>
      )}
    </div>
  );
  return href ? (
    <Link href={href} className="block focus-visible:relative focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}
