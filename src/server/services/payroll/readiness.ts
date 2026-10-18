import "server-only";
import { and, eq, inArray, isNull, lte, ne } from "drizzle-orm";
import type { RequestContext } from "../../auth/context";
import { can } from "../../auth/context";
import { employees, legalEntities, payrollPeriods, payrollRunEmployees, payrollRuns } from "../../db/schema";
import { notFound } from "../../lib/errors";
import type { EsiParams } from "@/lib/payroll/params";
import { esiContributionPeriod } from "@/lib/payroll/statutory";
import { eligibleEmployees, lastDayOf, loadEmployeeData } from "./loader";
import { resolveRuleSets } from "./rules";
import { authorizePayrollRead } from "./shared";

export type ReadinessItem = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  employeeId?: string;
  employeeName?: string;
  href?: string;
};

export type Readiness = {
  eligible: number;
  items: ReadinessItem[];
  counts: { error: number; warning: number; info: number };
  skippedChecks: string[];
  ruleSets: { kind: string; jurisdiction: string; name: string; version: number; verified: boolean }[];
};

/**
 * Pre-run validation for a period: missing compensation or structure, bank
 * details, PAN, joiners and exits, unprocessed attendance and missing or
 * unverified statutory rule sets. Read-only.
 */
export async function periodReadiness(ctx: RequestContext, periodId: string): Promise<Readiness> {
  authorizePayrollRead(ctx);
  const canComp = can(ctx, "compensation.view", "all");
  const canSensitive = can(ctx, "employees.sensitive.view", "all");
  return ctx.db(async (tx) => {
    const [period] = await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId));
    if (!period) throw notFound("Payroll period");
    const [le] = await tx.select().from(legalEntities).where(eq(legalEntities.id, period.legalEntityId));
    const items: ReadinessItem[] = [];
    const skippedChecks: string[] = [];
    if (!canComp) skippedChecks.push("Compensation and salary structures (needs compensation access)");
    if (!canSensitive) skippedChecks.push("Bank details and PAN (needs statutory details access)");

    const fnfRuns = await tx
      .select({ id: payrollRuns.id })
      .from(payrollRuns)
      .where(and(eq(payrollRuns.periodId, period.id), eq(payrollRuns.kind, "full_and_final"), ne(payrollRuns.status, "cancelled")));
    const fnf = fnfRuns.length
      ? new Set((await tx.select({ e: payrollRunEmployees.employeeId }).from(payrollRunEmployees).where(inArray(payrollRunEmployees.runId, fnfRuns.map((r) => r.id)))).map((r) => r.e))
      : new Set<string>();
    const emps = (await eligibleEmployees(tx, period)).filter((e) => !fnf.has(e.id));

    const base = await resolveRuleSets(tx, period.endDate, [
      { kind: "pf", jurisdiction: "IN" },
      { kind: "esi", jurisdiction: "IN" },
      { kind: "income_tax", jurisdiction: "IN" },
    ]);
    const esi = base.get("esi|IN");
    const esiStart = esi?.params ? esiContributionPeriod(esi.params as EsiParams, period.year, period.month) : null;
    const data = await loadEmployeeData(tx, period, emps, { esiPeriodStart: esiStart ? { year: esiStart.startYear, month: esiStart.startMonth } : null });
    const states = [...new Set([...data.values()].map((d) => d.workState).filter(Boolean) as string[])];
    const stateRules = await resolveRuleSets(tx, period.endDate, states.flatMap((s) => [{ kind: "pt" as const, jurisdiction: `IN-${s}` }, { kind: "lwf" as const, jurisdiction: `IN-${s}` }]));

    for (const [k, label] of [["pf|IN", "PF"], ["esi|IN", "ESI"], ["income_tax|IN", "Income tax"]] as const) {
      const r = base.get(k);
      if (!r) items.push({ severity: "error", code: "rule_set_missing", message: `No ${label} rule set is effective on ${period.endDate}. Load the default statutory rule sets or add one.`, href: "/payroll/configuration?tab=statutory" });
      else if (r.error) items.push({ severity: "error", code: "rule_set_invalid", message: `${r.row.name} v${r.row.version}: ${r.error}`, href: "/payroll/configuration?tab=statutory" });
    }
    for (const s of states) {
      if (!stateRules.get(`pt|IN-${s}`)) items.push({ severity: "info", code: "pt_not_configured", message: `No professional tax rule set for ${s}; PT will not be deducted there.`, href: "/payroll/configuration?tab=statutory" });
    }
    const used = [...base.values(), ...stateRules.values()];
    for (const r of used.filter((x) => !x.row.verifiedAt)) {
      items.push({ severity: "warning", code: "rule_set_unverified", message: `${r.row.name} (v${r.row.version}) is not verified. Locking will need an explicit override.`, href: "/payroll/configuration?tab=statutory" });
    }
    if (!le?.registrations?.tan) items.push({ severity: "warning", code: "tan_missing", message: `${le?.name ?? "The legal entity"} has no TAN recorded (needed for TDS).`, href: "/settings/legal-entities" });

    const pendingJoiners = await tx
      .select({ id: employees.id, name: employees.displayName, joiningDate: employees.joiningDate })
      .from(employees)
      .where(and(eq(employees.legalEntityId, period.legalEntityId), eq(employees.status, "pending"), isNull(employees.deletedAt), lte(employees.joiningDate, period.endDate)));
    for (const p of pendingJoiners) {
      items.push({ severity: "warning", code: "joining_unconfirmed", message: `Joining date ${p.joiningDate} is in or before this period but joining is not confirmed; excluded from payroll.`, employeeId: p.id, employeeName: p.name, href: `/employees/${p.id}` });
    }

    for (const e of emps) {
      const d = data.get(e.id)!;
      const who = { employeeId: e.id, employeeName: e.displayName };
      if (canComp) {
        if (!d.compensation) items.push({ ...who, severity: "error", code: "no_compensation", message: "No compensation effective in this period.", href: `/employees/${e.id}?tab=compensation` });
        else if (!d.structure) items.push({ ...who, severity: "error", code: "no_structure", message: "No salary structure assigned and no default structure.", href: "/payroll/configuration?tab=structures" });
        if (d.compensationChangedOn) items.push({ ...who, severity: "warning", code: "compensation_changed", message: `Compensation changes mid-period (${d.compensationChangedOn}).`, href: `/employees/${e.id}?tab=compensation` });
      }
      if (canSensitive) {
        if (!d.sensitive?.bankAccountEnc || !d.sensitive.bankIfsc) items.push({ ...who, severity: "warning", code: "no_bank", message: "Bank account or IFSC missing; cannot be paid by bank transfer.", href: `/employees/${e.id}?tab=statutory` });
        if (!d.sensitive?.panLast4) items.push({ ...who, severity: "warning", code: "no_pan", message: "PAN missing; TDS may be required at a higher rate (s.206AA).", href: `/employees/${e.id}?tab=statutory` });
      }
      if (e.joiningDate > period.startDate) items.push({ ...who, severity: "info", code: "joiner", message: `Joins on ${e.joiningDate}; pay will be prorated.`, href: `/employees/${e.id}` });
      const last = lastDayOf(e);
      if (last && last <= period.endDate) items.push({ ...who, severity: "info", code: "exit", message: `Last working day ${last}; consider a full and final settlement.`, href: `/employees/${e.id}` });
      if (!d.attendance.length) {
        items.push({ ...who, severity: "warning", code: "no_attendance", message: d.unpaidLeave.length ? "Attendance not processed; LOP will come from approved unpaid leave." : "Attendance not processed; all days will be treated as payable.", href: `/employees/${e.id}` });
      }
      if (!d.workState) items.push({ ...who, severity: "warning", code: "no_state", message: "No work state (location or legal entity); professional tax cannot be determined.", href: `/employees/${e.id}?tab=job` });
    }
    const counts = { error: 0, warning: 0, info: 0 };
    items.forEach((i) => counts[i.severity]++);
    const order = { error: 0, warning: 1, info: 2 };
    items.sort((a, b) => order[a.severity] - order[b.severity] || (a.employeeName ?? "").localeCompare(b.employeeName ?? ""));
    return {
      eligible: emps.length,
      items,
      counts,
      skippedChecks,
      ruleSets: used.map((r) => ({ kind: r.row.kind, jurisdiction: r.row.jurisdiction, name: r.row.name, version: r.row.version, verified: !!r.row.verifiedAt })),
    };
  });
}
