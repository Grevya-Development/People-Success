import { format, parseISO } from "date-fns";

export function initials(name: string | null | undefined) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

const toDate = (d: string | Date) => (typeof d === "string" ? parseISO(d) : d);

export function formatDate(d: string | Date | null | undefined, pattern = "dd MMM yyyy") {
  if (!d) return "—";
  return format(toDate(d), pattern);
}

export function formatDateTime(d: string | Date | null | undefined) {
  if (!d) return "—";
  return format(toDate(d), "dd MMM yyyy, HH:mm");
}

/** Format integer minor units (paise) as currency. */
export function formatMoney(minor: number | null | undefined, currency = "INR", opts: { compact?: boolean } = {}) {
  if (minor == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: opts.compact ? 1 : 2,
    minimumFractionDigits: opts.compact ? 0 : 2,
    notation: opts.compact ? "compact" : "standard",
  }).format(minor / 100);
}

export function formatNumber(n: number | null | undefined, digits = 0) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits }).format(n);
}

export function formatPercent(n: number | null | undefined, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function titleCase(s: string | null | undefined) {
  if (!s) return "";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Today's date (yyyy-MM-dd) in a timezone, defaulting to India. */
export function todayIn(timeZone = "Asia/Kolkata") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
