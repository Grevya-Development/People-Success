/** Shared display metadata for attendance (client-safe, no new colours: status tones only). */
export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

export const DAY_STATUS: Record<string, { label: string; tone: Tone; cell: string; short: string; dot: string }> = {
  present: { label: "Present", tone: "success", cell: "bg-success-soft text-success", short: "P", dot: "bg-success" },
  half_day: { label: "Half day", tone: "warning", cell: "bg-warning-soft text-warning", short: "½", dot: "bg-warning" },
  absent: { label: "Absent", tone: "danger", cell: "bg-danger-soft text-danger", short: "A", dot: "bg-danger" },
  missing_punch: { label: "Missing punch", tone: "warning", cell: "bg-warning-soft text-warning", short: "MP", dot: "bg-warning" },
  on_leave: { label: "On leave", tone: "info", cell: "bg-info-soft text-info", short: "L", dot: "bg-info" },
  holiday: { label: "Holiday", tone: "brand", cell: "bg-brand-soft text-brand", short: "H", dot: "bg-brand" },
  weekly_off: { label: "Weekly off", tone: "neutral", cell: "bg-muted text-muted-foreground", short: "WO", dot: "bg-muted-foreground/40" },
  not_joined: { label: "Not employed", tone: "neutral", cell: "bg-muted/50 text-muted-foreground", short: "—", dot: "bg-muted-foreground/20" },
};

export const statusLabel = (s: string | null | undefined) => (s ? (DAY_STATUS[s]?.label ?? s.replace(/_/g, " ")) : "Not recorded");

export const VERIFICATION: Record<string, { label: string; tone: Tone; hint: string }> = {
  self_reported: { label: "Self-reported", tone: "neutral", hint: "Recorded from the browser without location verification." },
  location_verified: { label: "Location verified", tone: "success", hint: "Browser location was inside the office geofence." },
  device_verified: { label: "Device verified", tone: "success", hint: "Recorded by an attendance device." },
  approved_correction: { label: "Approved correction", tone: "info", hint: "Added by an approved attendance correction." },
};

export function minutesLabel(m: number) {
  if (!m) return "0h";
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${String(r).padStart(2, "0")}m` : `${h}h`;
}

export function shiftMonth(month: string, delta: number) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + delta;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
}

export function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

export const isMonth = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
export const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
