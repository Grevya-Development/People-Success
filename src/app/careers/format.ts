import { formatMoney } from "@/lib/format";

export function salaryLabel(s: { min: number | null; max: number | null } | null) {
  if (!s || (s.min == null && s.max == null)) return null;
  const f = (v: number | null) => (v == null ? null : formatMoney(v, "INR", { compact: true }));
  return [f(s.min), f(s.max)].filter(Boolean).join(" – ") + " a year";
}
