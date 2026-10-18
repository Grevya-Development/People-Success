import { ShieldAlert, ShieldCheck } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

const RUN: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  calculated: { label: "Calculated", tone: "info" },
  pending_approval: { label: "Awaiting approval", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  locked: { label: "Locked", tone: "brand" },
  disbursed: { label: "Payment file sent", tone: "brand" },
  published: { label: "Published", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function RunStatusBadge({ status }: { status: string }) {
  const s = RUN[status] ?? { label: status, tone: "neutral" as Tone };
  return <StatusBadge status={status} label={s.label} tone={s.tone} />;
}

const PERIOD: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "info" },
  processing: { label: "Processing", tone: "warning" },
  locked: { label: "Locked", tone: "brand" },
  closed: { label: "Closed", tone: "neutral" },
};

export function PeriodStatusBadge({ status }: { status: string }) {
  const s = PERIOD[status] ?? { label: status, tone: "neutral" as Tone };
  return <StatusBadge status={status} label={s.label} tone={s.tone} />;
}

const EMPLOYEE: Record<string, { label: string; tone: Tone }> = {
  ok: { label: "OK", tone: "success" },
  warning: { label: "Warning", tone: "warning" },
  error: { label: "Error", tone: "danger" },
  on_hold: { label: "Not calculated", tone: "neutral" },
  excluded: { label: "Excluded", tone: "neutral" },
};

export function ResultStatusBadge({ status }: { status: string }) {
  const s = EMPLOYEE[status] ?? { label: status, tone: "neutral" as Tone };
  return <StatusBadge status={status} label={s.label} tone={s.tone} />;
}

export function VerificationBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="inline-flex h-5 items-center gap-1 rounded-full bg-success-soft px-2 text-[11.5px] font-medium whitespace-nowrap text-success">
      <ShieldCheck className="size-3" aria-hidden /> Verified
    </span>
  ) : (
    <span className="inline-flex h-5 items-center gap-1 rounded-full bg-warning-soft px-2 text-[11.5px] font-medium whitespace-nowrap text-warning">
      <ShieldAlert className="size-3" aria-hidden /> Unverified
    </span>
  );
}

export const RUN_KIND_LABEL: Record<string, string> = {
  regular: "Regular",
  adjustment: "Adjustment",
  off_cycle: "Off-cycle",
  full_and_final: "Full and final",
};
