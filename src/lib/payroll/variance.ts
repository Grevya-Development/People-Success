/** Run-to-run variance detection and canonical hashing input (pure). */

export type ComparableEmployee = {
  employeeId: string;
  gross: number;
  net: number;
  lines: { componentCode: string; componentName: string; kind: string; amount: number }[];
};

export type VarianceDriver = { componentCode: string; componentName: string; previous: number; current: number; delta: number };

export type EmployeeVariance = {
  previousRunId: string | null;
  previousGross: number | null;
  previousNet: number | null;
  grossPct: number | null;
  netPct: number | null;
  flagged: boolean;
  isNew: boolean;
  drivers: VarianceDriver[];
};

const pct = (cur: number, prev: number) => (prev === 0 ? (cur === 0 ? 0 : null) : Math.round(((cur - prev) / Math.abs(prev)) * 10000) / 100);

/** Component-level differences, largest absolute change first. */
export function varianceDrivers(current: ComparableEmployee["lines"], previous: ComparableEmployee["lines"], limit = 5): VarianceDriver[] {
  const map = new Map<string, VarianceDriver>();
  const add = (l: ComparableEmployee["lines"][number], side: "previous" | "current") => {
    const sign = l.kind === "deduction" || l.kind === "statutory_deduction" ? -1 : l.kind === "employer_contribution" ? 0 : 1;
    if (sign === 0) return;
    const d = map.get(l.componentCode) ?? { componentCode: l.componentCode, componentName: l.componentName, previous: 0, current: 0, delta: 0 };
    d[side] += sign * l.amount;
    map.set(l.componentCode, d);
  };
  previous.forEach((l) => add(l, "previous"));
  current.forEach((l) => add(l, "current"));
  return [...map.values()]
    .map((d) => ({ ...d, delta: d.current - d.previous }))
    .filter((d) => d.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.componentCode.localeCompare(b.componentCode))
    .slice(0, limit);
}

export function compareEmployee(current: ComparableEmployee, previous: ComparableEmployee | null, previousRunId: string | null, thresholdPct: number): EmployeeVariance {
  if (!previous) {
    return { previousRunId, previousGross: null, previousNet: null, grossPct: null, netPct: null, flagged: false, isNew: true, drivers: [] };
  }
  const grossPct = pct(current.gross, previous.gross);
  const netPct = pct(current.net, previous.net);
  const flagged = netPct === null || grossPct === null || Math.abs(netPct) > thresholdPct || Math.abs(grossPct) > thresholdPct;
  return {
    previousRunId,
    previousGross: previous.gross,
    previousNet: previous.net,
    grossPct,
    netPct,
    flagged,
    isNew: false,
    drivers: varianceDrivers(current.lines, previous.lines),
  };
}

/** JSON with object keys sorted recursively, for stable hashing. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}
