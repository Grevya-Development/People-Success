/**
 * Declarative condition matching shared by workflows, approval policies and
 * lifecycle templates. A condition object maps attribute → expected value:
 *   { departmentId: "…" }                     equals
 *   { employmentType: ["intern","contract"] } one of
 *   { tenureDays: { gte: 90 } }               numeric range (gte / lte)
 *   { status: { not: "exited" } }             not equal
 * An empty object always matches.
 */
export type ConditionValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | { gte?: number; lte?: number; in?: unknown[]; not?: unknown };

export type Conditions = Record<string, ConditionValue>;

export function matchesConditions(conditions: Conditions | null | undefined, facts: Record<string, unknown>): boolean {
  if (!conditions) return true;
  return Object.entries(conditions).every(([key, expected]) => {
    const actual = facts[key];
    if (Array.isArray(expected)) return expected.includes(actual as string);
    if (expected && typeof expected === "object") {
      const c = expected as { gte?: number; lte?: number; in?: unknown[]; not?: unknown };
      if (c.in && !c.in.includes(actual)) return false;
      if (c.not !== undefined && actual === c.not) return false;
      if (c.gte != null && !(typeof actual === "number" && actual >= c.gte)) return false;
      if (c.lte != null && !(typeof actual === "number" && actual <= c.lte)) return false;
      return true;
    }
    return actual === expected;
  });
}

/** Resolve "{{path.to.value}}" placeholders against a context object. Unknown paths render as "". */
export function interpolate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), context);
    return value === undefined || value === null ? "" : String(value);
  });
}
