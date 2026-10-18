import { cn } from "cn";
import { StatusBadge } from "@/components/status-badge";
import { OWNER_GROUP_LABELS, SETTLEMENT_LABELS, type OwnerGroup, type SettlementStatus } from "@/lib/validation/lifecycle";

/** Thin progress meter with an accessible label. Server-safe. */
export function ProgressMeter({ value, className, label }: { value: number; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        aria-label={label ?? "Progress"}
        className="h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-muted"
      >
        <div className={cn("h-full rounded-full transition-all", v === 100 ? "bg-success" : "bg-brand")} style={{ width: `${v}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right text-xs text-muted-foreground tabular">{v}%</span>
    </div>
  );
}

export const ownerLabel = (g: string) => OWNER_GROUP_LABELS[g as OwnerGroup] ?? g;

export function PlanStatusBadge({ status }: { status: string }) {
  const label = status === "not_started" ? "Not started" : undefined;
  return <StatusBadge status={status} label={label} />;
}

const EXIT_STATUS_TONE: Record<string, "info" | "warning" | "success" | "danger" | "neutral"> = {
  submitted: "info",
  under_review: "info",
  accepted: "warning",
  in_progress: "warning",
  completed: "neutral",
  rejected: "danger",
  withdrawn: "neutral",
};

export function ExitStatusBadge({ status }: { status: string }) {
  const label = status === "in_progress" ? "Offboarding" : status === "accepted" ? "Accepted" : undefined;
  return <StatusBadge status={status} label={label} tone={EXIT_STATUS_TONE[status]} />;
}

export function SettlementBadge({ status }: { status: string }) {
  const tone = status === "paid" || status === "approved" ? "success" : status === "pending_approval" ? "warning" : status === "draft" ? "info" : "neutral";
  return <StatusBadge status={status} label={SETTLEMENT_LABELS[status as SettlementStatus] ?? status} tone={tone} />;
}

/** Small key/value list used in detail sidebars. */
export function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
