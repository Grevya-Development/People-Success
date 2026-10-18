import "server-only";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import type { RequestContext } from "../../auth/context";
import { authorize } from "../../auth/context";
import { employees, payrollRunEmployees, payrollRuns } from "../../db/schema";
import { notFound } from "../../lib/errors";
import { runAi } from "../../ai/run";
import { inr } from "@/lib/payroll/money";
import type { EmployeeVariance } from "@/lib/payroll/variance";

const explanationSchema = z.object({
  summary: z.string().max(2000),
  items: z
    .array(z.object({ employeeCode: z.string().max(40), explanation: z.string().max(800), needsReview: z.boolean() }))
    .max(50),
});
export type RunExplanation = z.infer<typeof explanationSchema>;

/**
 * Explain exceptions and variances in a run. The AI only narrates the
 * deterministic results (codes, component deltas, messages); it never
 * changes numbers. Without AI, a rule-based summary lists the top variance
 * drivers from line-item differences.
 */
export async function explainRun(ctx: RequestContext, runId: string) {
  authorize(ctx, "payroll.view", "all");
  const facts = await ctx.db(async (tx) => {
    const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
    if (!run) throw notFound("Payroll run");
    const rows = await tx
      .select({ e: payrollRunEmployees, code: employees.employeeCode })
      .from(payrollRunEmployees)
      .innerJoin(employees, eq(employees.id, payrollRunEmployees.employeeId))
      .where(eq(payrollRunEmployees.runId, runId))
      .orderBy(asc(employees.employeeCode));
    return rows
      .map(({ e, code }) => {
        const v = (e.snapshot as { variance?: EmployeeVariance | null }).variance ?? null;
        const issues = e.messages.filter((m) => m.severity !== "info").map((m) => `${m.severity}: ${m.message}`);
        return { code, status: e.status, net: e.netPay, variance: v, issues };
      })
      .filter((r) => r.issues.length || r.variance?.flagged);
  });

  const fallback = (): RunExplanation => ({
    summary: facts.length
      ? `${facts.length} employee${facts.length === 1 ? "" : "s"} need attention: ${facts.filter((f) => f.status === "error").length} with errors, ${facts.filter((f) => f.variance?.flagged && !f.variance.isNew).length} with variances against the previous locked run.`
      : "No exceptions or variances beyond the threshold.",
    items: facts.slice(0, 50).map((f) => {
      const drivers = (f.variance?.drivers ?? []).slice(0, 3).map((d) => `${d.componentName} ${d.delta > 0 ? "+" : ""}${inr(d.delta)}`);
      const parts = [
        f.variance?.flagged && f.variance.previousNet != null ? `Net ${inr(f.variance.previousNet)} → ${inr(f.net)}${drivers.length ? `; main drivers: ${drivers.join(", ")}` : ""}.` : null,
        ...f.issues.slice(0, 3),
      ].filter(Boolean);
      return { employeeCode: f.code, explanation: parts.join(" "), needsReview: f.status === "error" || !!f.variance?.flagged };
    }),
  });

  if (!facts.length) return { source: "rules" as const, data: fallback(), reason: "Nothing to explain." };
  const outcome = await runAi(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    {
      agentKey: "payroll_audit",
      task: "explain_run_variances",
      system:
        "Explain each listed payroll exception in one or two plain sentences for a payroll reviewer, using only the facts given (component deltas are in rupees). Do not compute new amounts, do not suggest pay changes, and mark needsReview when a human should check the inputs.",
      messages: [{ role: "user", content: JSON.stringify(facts.slice(0, 50).map((f) => ({ employeeCode: f.code, status: f.status, previousNet: f.variance?.previousNet ?? null, net: f.net, netChangePct: f.variance?.netPct ?? null, drivers: f.variance?.drivers ?? [], issues: f.issues }))) }],
      schema: explanationSchema,
      fallback,
    },
  );
  return outcome.source === "ai" ? { source: "ai" as const, data: outcome.data, reason: null } : { source: "rules" as const, data: outcome.data, reason: outcome.reason };
}
