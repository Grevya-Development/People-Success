import { cn } from "cn";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

const TONES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  brand: "bg-brand-soft text-brand",
};

/** Default tone for common status values across modules. */
const STATUS_TONES: Record<string, Tone> = {
  active: "success",
  approved: "success",
  done: "success",
  completed: "success",
  paid: "success",
  hired: "success",
  accepted: "success",
  published: "success",
  filled: "success",
  clean: "success",
  pending: "warning",
  in_progress: "info",
  open: "info",
  submitted: "info",
  draft: "neutral",
  planned: "neutral",
  invited: "info",
  on_notice: "warning",
  blocked: "warning",
  frozen: "warning",
  rejected: "danger",
  exited: "neutral",
  cancelled: "neutral",
  closed: "neutral",
  failed: "danger",
  dead: "danger",
  suspended: "danger",
  expired: "neutral",
  locked: "brand",
};

export function StatusBadge({ status, label, tone, className }: { status: string; label?: string; tone?: Tone; className?: string }) {
  const t = tone ?? STATUS_TONES[status] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap",
        !label && "capitalize",
        TONES[t],
        className,
      )}
    >
      {label ?? status.replace(/_/g, " ")}
    </span>
  );
}
