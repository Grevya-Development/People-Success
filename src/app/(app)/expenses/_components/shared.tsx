import { cn } from "cn";
import { StatusBadge } from "@/components/status-badge";

const CLAIM_TONES = {
  draft: "neutral",
  submitted: "info",
  approved: "success",
  rejected: "danger",
  reimbursed: "brand",
  cancelled: "neutral",
} as const;

export function ClaimStatus({ status, postedToPayroll, method }: { status: keyof typeof CLAIM_TONES; postedToPayroll?: boolean; method?: string }) {
  if (status === "approved" && method === "payroll") {
    return <StatusBadge status="approved" tone={postedToPayroll ? "success" : "warning"} label={postedToPayroll ? "Approved · in payroll" : "Approved · awaiting payroll"} />;
  }
  if (status === "approved" && method === "bank_transfer") return <StatusBadge status="approved" tone="success" label="Approved · to be paid" />;
  return <StatusBadge status={status} tone={CLAIM_TONES[status]} label={status === "submitted" ? "Awaiting approval" : undefined} />;
}

/** Compact stat tile used in a `grid gap-px bg-border` strip. */
export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "warning" | "success" | "danger" }) {
  return (
    <div className="bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-1.5 text-xl leading-none font-semibold tracking-tight tabular", tone === "warning" && "text-warning", tone === "success" && "text-success", tone === "danger" && "text-danger")}>{value}</p>
      {hint ? <p className="mt-1.5 text-[11.5px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function StatStrip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4", className)}>{children}</div>;
}

/** Horizontal bar for simple breakdowns (no chart library needed). */
export function BarRow({ label, value, max, display }: { label: string; value: number; max: number; display: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <li className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 py-1.5 text-sm sm:grid-cols-[minmax(0,14rem)_1fr_auto]">
      <span className="truncate text-muted-foreground" title={label}>
        {label}
      </span>
      <span className="h-2 rounded-full bg-muted" aria-hidden>
        <span className="block h-2 rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular text-right font-medium">{display}</span>
    </li>
  );
}
