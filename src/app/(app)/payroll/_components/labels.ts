import { formatMoney, titleCase } from "@/lib/format";

export const CALC_LABEL: Record<string, string> = {
  fixed: "Fixed (₹ a year)",
  percent_of_ctc: "% of CTC",
  percent_of_basic: "% of basic",
  percent_of_gross: "% of gross",
  balancing: "Balancing (rest of CTC)",
};

/** "50% of CTC", "₹24,000.00 a year", "Balancing (rest of CTC)". Fixed values are paise. */
export function structureLineLabel(l: { calculation: string; value: number | null }) {
  if (l.calculation === "balancing") return CALC_LABEL.balancing;
  if (l.calculation === "fixed") return `${formatMoney(l.value ?? 0)} a year`;
  const base = (CALC_LABEL[l.calculation] ?? titleCase(l.calculation)).replace(/^% /, "");
  return `${l.value ?? 0}% ${base}`;
}
