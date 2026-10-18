import { toneOf } from "@/lib/validation/time";

/** Leave type colour → existing status tone classes (no new colours). */
const DOT: Record<string, string> = {
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  brand: "bg-brand",
  neutral: "bg-muted-foreground",
};
const SOFT: Record<string, string> = {
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  brand: "bg-brand-soft text-brand",
  neutral: "bg-muted text-muted-foreground",
};

export const dotClass = (color: string) => DOT[toneOf(color)];
export const softClass = (color: string) => SOFT[toneOf(color)];

export function daysLabel(n: number) {
  const v = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
  return `${v} day${Math.abs(n) === 1 ? "" : "s"}`;
}

export const SESSION_SHORT: Record<string, string> = { full: "", first_half: "1st half", second_half: "2nd half" };

export function rangeLabel(r: { startDate: string; endDate: string; startSession: string; endSession: string }, fmt: (d: string) => string) {
  const s = SESSION_SHORT[r.startSession] ? ` (${SESSION_SHORT[r.startSession]})` : "";
  if (r.startDate === r.endDate) return `${fmt(r.startDate)}${s}`;
  const e = SESSION_SHORT[r.endSession] ? ` (${SESSION_SHORT[r.endSession]})` : "";
  return `${fmt(r.startDate)}${s} – ${fmt(r.endDate)}${e}`;
}
