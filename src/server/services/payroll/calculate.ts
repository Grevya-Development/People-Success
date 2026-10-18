import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { z } from "zod";
import type { Tx } from "../../db/client";
import type { RequestContext } from "../../auth/context";
import { authorize, can } from "../../auth/context";
import { employees, legalEntities, payrollLineItems, payrollPeriods, payrollRunEmployees, payrollRuns } from "../../db/schema";
import { audit } from "../../lib/audit";
import { forbidden, invalidState, notFound } from "../../lib/errors";
import { emitDomainEvent } from "../events";
import { calculateEmployeePay, PayrollValidationError } from "@/lib/payroll/engine";
import { computePayableDays } from "@/lib/payroll/attendance";
import { resolveStructure } from "@/lib/payroll/structure";
import { calculateGratuity, esiContributionPeriod, perDayAmount } from "@/lib/payroll/statutory";
import { ageOn } from "@/lib/payroll/dates";
import { inr, sum } from "@/lib/payroll/money";
import { compareEmployee, type EmployeeVariance } from "@/lib/payroll/variance";
import { ENGINE_VERSION, type EngineInput, type EngineResult, type Message, type OneOffInput, type PayLine, type StatutoryProfile } from "@/lib/payroll/types";
import type { EsiParams, GratuityParams, IncomeTaxParams, LwfParams, PfParams, PtParams } from "@/lib/payroll/params";
import type { calculateRunSchema } from "@/lib/validation/payroll";
import { componentsFor, eligibleEmployees, lastDayOf, loadEmployeeData, previousPostedRun, type EmployeeData, type PeriodRow } from "./loader";
import { resolveRuleSets, type ResolvedRule } from "./rules";
import { toComponentDef } from "./config";
import { assertStatus, lockRun, periodLabel, POSTED_STATUSES } from "./shared";

export type FnfSetup = {
  kind: "fnf";
  leaveEncashmentDays: number;
  encashmentDivisor: number;
  noticePayDays: number;
  noticeRecoveryDays: number;
  includeGratuity: boolean;
};
export type AdjustmentSetup = { kind: "adjustment" };
export type RunSetup = FnfSetup | AdjustmentSetup;

type Snapshot = Record<string, unknown> & { setup?: RunSetup };

type EmployeeOutcome = {
  employeeId: string;
  status: "ok" | "warning" | "error";
  calendarDays: number;
  payableDays: number;
  lopDays: number;
  gross: number;
  deductions: number;
  employer: number;
  net: number;
  lines: PayLine[];
  messages: Message[];
  snapshot: Snapshot;
};

const statusOf = (messages: Message[]): EmployeeOutcome["status"] =>
  messages.some((m) => m.severity === "error") ? "error" : messages.some((m) => m.severity === "warning") ? "warning" : "ok";

/* ------------------------------------------------------------------ */
/* Engine input assembly                                               */
/* ------------------------------------------------------------------ */

type Rules = Map<string, ResolvedRule>;

function profileFor(d: EmployeeData): { profile: StatutoryProfile; messages: Message[] } {
  const messages: Message[] = [];
  const decl = d.declaration;
  const declApplies = !!decl && (decl.status === "submitted" || decl.status === "verified");
  if (decl && !declApplies) messages.push({ severity: "info", code: "declaration_draft", message: "The tax declaration is still a draft; only the regime choice is used." });
  const declarations: Record<string, number> = declApplies ? { ...decl!.declarations } : {};
  const regime = (decl?.regime ?? d.sensitive?.taxRegime ?? "new") === "old" ? "old" : "new";
  return {
    profile: {
      // Defaults until per-employee statutory flags exist (see docs/PAYROLL.md "Schema changes needed").
      pfApplicable: true,
      pfWageBasis: "capped",
      epsEligible: true,
      esiContinuing: d.esiCoveredEarlier,
      ptState: d.workState,
      lwfState: d.workState,
      taxRegime: regime,
      declarations,
      previousEmployerIncome: declApplies ? (decl!.previousEmployerIncome ?? 0) : 0,
      previousEmployerTds: declApplies ? (decl!.previousEmployerTds ?? 0) : 0,
      hasPan: !!d.sensitive?.panLast4,
    },
    messages,
  };
}

function statutoryFor(rules: Rules, state: string | null) {
  const get = <T,>(key: string) => (rules.get(key)?.params as T | null | undefined) ?? null;
  return {
    pf: get<PfParams>("pf|IN"),
    esi: get<EsiParams>("esi|IN"),
    pt: state ? get<PtParams>(`pt|IN-${state}`) : null,
    lwf: state ? get<LwfParams>(`lwf|IN-${state}`) : null,
    incomeTax: get<IncomeTaxParams>("income_tax|IN"),
  };
}

function usedRuleKeys(state: string | null) {
  return ["pf|IN", "esi|IN", "income_tax|IN", ...(state ? [`pt|IN-${state}`, `lwf|IN-${state}`] : [])];
}

function baseSnapshot(d: EmployeeData, period: PeriodRow, extra: Record<string, unknown>): Snapshot {
  const e = d.employee;
  return {
    engineVersion: ENGINE_VERSION,
    period: { id: period.id, year: period.year, month: period.month, label: periodLabel(period.year, period.month), payDate: period.payDate },
    employee: {
      code: e.employeeCode,
      name: e.displayName,
      designation: d.designation,
      department: d.department,
      location: d.location,
      joiningDate: e.joiningDate,
      lastWorkingDate: lastDayOf(e),
      panLast4: d.sensitive?.panLast4 ?? null,
      uan: d.sensitive?.uan ?? null,
      bankLast4: d.sensitive?.bankAccountLast4 ?? null,
      bankIfsc: d.sensitive?.bankIfsc ?? null,
      bankName: d.sensitive?.bankName ?? null,
      workState: d.workState,
    },
    compensation: d.compensation ? { recordId: d.compensation.id, annualCtc: d.compensation.annualCtc, effectiveFrom: d.compensation.effectiveFrom } : null,
    structure: d.structure ? { id: d.structure.id, name: d.structure.name, version: d.structure.version, lines: d.structure.lines, isDefault: d.structureIsDefault } : null,
    ...extra,
  };
}

type BuildArgs = {
  period: PeriodRow;
  d: EmployeeData;
  rules: Rules;
  components: ReturnType<typeof toComponentDef>[];
  inputs: EmployeeData["inputs"];
  loans: EngineInput["loans"];
  skipSalary?: boolean;
  extraOneOffs?: OneOffInput[];
  ytd?: EngineInput["ytd"];
  esiContinuing?: boolean;
};

function buildEngineInput(a: BuildArgs): { input: EngineInput | null; messages: Message[]; ruleKeys: string[] } {
  const { period, d } = a;
  const e = d.employee;
  const messages: Message[] = [];
  const { days, messages: dayMessages } = computePayableDays({
    periodStart: period.startDate,
    periodEnd: period.endDate,
    joiningDate: e.joiningDate,
    lastWorkingDate: lastDayOf(e),
    attendance: d.attendance,
    unpaidLeave: d.unpaidLeave,
  });
  messages.push(...dayMessages);
  const ruleKeys = usedRuleKeys(d.workState);
  for (const k of ruleKeys) {
    const r = a.rules.get(k);
    if (r?.error) messages.push({ severity: "error", code: "rule_set_invalid", message: `${r.row.name} (v${r.row.version}): ${r.error}` });
  }
  if (!a.skipSalary) {
    if (!d.compensation) messages.push({ severity: "error", code: "no_compensation", message: "No compensation record is effective for this period." });
    else if (!d.structure) messages.push({ severity: "error", code: "no_structure", message: "No salary structure is assigned and there is no active default structure." });
    if (d.compensationChangedOn) {
      messages.push({
        severity: "warning",
        code: "compensation_changed_mid_period",
        message: `Compensation changed on ${d.compensationChangedOn}. The rate effective at the end of the employment window is applied to the whole period; post any difference as an arrear.`,
      });
    }
    if (d.structureIsDefault && d.structure) messages.push({ severity: "info", code: "default_structure", message: `No structure assigned; the default structure "${d.structure.name}" was used.` });
  }
  if (!d.sensitive?.bankAccountEnc) messages.push({ severity: "warning", code: "no_bank", message: "Bank details are missing; this employee cannot be included in a bank transfer file." });
  if (messages.some((m) => m.severity === "error")) return { input: null, messages, ruleKeys };
  const { profile, messages: profileMessages } = profileFor(d);
  messages.push(...profileMessages);
  if (a.esiContinuing != null) profile.esiContinuing = a.esiContinuing;
  const oneOffs: OneOffInput[] = [
    ...a.inputs.map((i) => ({ id: i.id, kind: i.kind, componentCode: i.componentCode, amount: i.amount, isTaxable: i.isTaxable, note: i.note })),
    ...(a.extraOneOffs ?? []),
  ];
  return {
    input: {
      employee: { id: e.id, name: e.displayName, dateOfBirth: e.dateOfBirth, gender: e.gender },
      period: { year: period.year, month: period.month, startDate: period.startDate, endDate: period.endDate },
      days,
      annualCtc: d.compensation?.annualCtc ?? 0,
      components: a.components,
      structure: a.skipSalary || !d.structure ? null : { name: d.structure.name, lines: d.structure.lines },
      oneOffs,
      loans: a.loans,
      statutory: statutoryFor(a.rules, d.workState),
      profile,
      ytd: a.ytd ?? d.ytd,
      skipSalary: a.skipSalary,
    },
    messages,
    ruleKeys,
  };
}

function runEngine(input: EngineInput | null, messages: Message[]): { result: EngineResult | null; messages: Message[] } {
  if (!input) return { result: null, messages };
  try {
    const result = calculateEmployeePay(input);
    return { result, messages: [...messages, ...result.messages] };
  } catch (err) {
    if (err instanceof PayrollValidationError) {
      return { result: null, messages: [...messages, ...err.issues.map((m) => ({ severity: "error" as const, code: "invalid_input", message: m }))] };
    }
    throw err;
  }
}

function outcome(employeeId: string, days: { calendarDays: number; payableDays: number; lopDays: number }, result: EngineResult | null, messages: Message[], snapshot: Snapshot): EmployeeOutcome {
  return {
    employeeId,
    status: statusOf(messages),
    calendarDays: days.calendarDays,
    payableDays: result?.payableDays ?? days.payableDays,
    lopDays: result?.lopDays ?? days.lopDays,
    gross: result?.gross ?? 0,
    deductions: result?.deductions ?? 0,
    employer: result?.employerContributions ?? 0,
    net: result?.net ?? 0,
    lines: result?.lines ?? [],
    messages,
    snapshot,
  };
}

/* ------------------------------------------------------------------ */
/* Calculation                                                         */
/* ------------------------------------------------------------------ */

export async function calculateRun(ctx: RequestContext, input: z.output<typeof calculateRunSchema>) {
  authorize(ctx, "payroll.run", "all");
  if (!can(ctx, "compensation.view", "all") || !can(ctx, "employees.sensitive.view", "all")) {
    throw forbidden("Calculating payroll also requires access to compensation and statutory details for all employees.");
  }
  return ctx.db(async (tx) => {
    const run = await lockRun(tx, input.runId);
    if (run.idempotencyKey === input.idempotencyKey && run.status === "calculated") {
      return { reused: true, runId: run.id, totals: run.totals };
    }
    assertStatus(run, ["draft", "calculated"], "calculate");
    const [period] = await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, run.periodId));
    if (!period) throw notFound("Payroll period");
    if (period.status === "locked" && run.kind === "regular") throw invalidState("This period is locked.");
    const [le] = await tx.select().from(legalEntities).where(eq(legalEntities.id, run.legalEntityId));

    const existing = await tx.select().from(payrollRunEmployees).where(eq(payrollRunEmployees.runId, run.id));
    const setups = new Map(existing.filter((r) => (r.snapshot as Snapshot).setup).map((r) => [r.employeeId, (r.snapshot as Snapshot).setup!]));

    let emps;
    if (run.kind === "regular") {
      const fnfRuns = await tx
        .select({ id: payrollRuns.id })
        .from(payrollRuns)
        .where(and(eq(payrollRuns.periodId, period.id), eq(payrollRuns.kind, "full_and_final"), ne(payrollRuns.status, "cancelled")));
      const fnfEmployees = fnfRuns.length
        ? new Set((await tx.select({ e: payrollRunEmployees.employeeId }).from(payrollRunEmployees).where(inArray(payrollRunEmployees.runId, fnfRuns.map((r) => r.id)))).map((r) => r.e))
        : new Set<string>();
      emps = (await eligibleEmployees(tx, period)).filter((e) => !fnfEmployees.has(e.id));
    } else {
      if (!setups.size) throw invalidState("This run has no employees.");
      emps = await tx.select().from(employees).where(inArray(employees.id, [...setups.keys()]));
    }

    const comps = (await componentsFor(tx)).map(toComponentDef);
    // National rule sets first (ESI decides the contribution period used for the
    // continuation rule); state rule sets once work states are known.
    const base = await resolveRuleSets(tx, period.endDate, [
      { kind: "pf", jurisdiction: "IN" },
      { kind: "esi", jurisdiction: "IN" },
      { kind: "income_tax", jurisdiction: "IN" },
      { kind: "gratuity", jurisdiction: "IN" },
    ]);
    const esiRule = base.get("esi|IN");
    const esiStart = esiRule?.params ? esiContributionPeriod(esiRule.params as EsiParams, period.year, period.month) : null;
    const data = await loadEmployeeData(tx, period, emps, { esiPeriodStart: esiStart ? { year: esiStart.startYear, month: esiStart.startMonth } : null });
    const stateKeys = [...new Set([...data.values()].map((d) => d.workState).filter(Boolean) as string[])].flatMap((s) => [
      { kind: "pt" as const, jurisdiction: `IN-${s}` },
      { kind: "lwf" as const, jurisdiction: `IN-${s}` },
    ]);
    const stateRules = await resolveRuleSets(tx, period.endDate, stateKeys);
    const rules: Rules = new Map([...base, ...stateRules]);

    const outcomes: EmployeeOutcome[] = [];
    const usedRules = new Set<string>();
    const threshold = input.varianceThresholdPct;

    if (run.kind === "regular") {
      const prev = await previousPostedRun(tx, period, emps.map((e) => e.id));
      for (const e of emps) {
        const d = data.get(e.id)!;
        const loans = d.loans.map((l) => ({ loanId: l.id, kind: l.kind, installment: l.monthlyInstallment, outstanding: l.outstanding }));
        const built = buildEngineInput({ period, d, rules, components: comps, inputs: d.inputs, loans });
        const { result, messages } = runEngine(built.input, built.messages);
        built.ruleKeys.forEach((k) => rules.get(k) && usedRules.add(k));
        let variance: EmployeeVariance | null = null;
        if (result) {
          const p = prev.byEmployee.get(e.id) ?? null;
          variance = compareEmployee({ employeeId: e.id, gross: result.gross, net: result.net, lines: result.lines }, p ? { employeeId: e.id, ...p } : null, prev.runId, threshold);
          if (variance.flagged && p) {
            messages.push({
              severity: "warning",
              code: "variance",
              message: `Net pay ${inr(p.net)} → ${inr(result.net)} (${variance.netPct == null ? "n/a" : `${variance.netPct > 0 ? "+" : ""}${variance.netPct}%`}) vs the previous locked run exceeds ±${threshold}%.`,
            });
          }
        }
        outcomes.push(
          outcome(e.id, built.input?.days ?? { calendarDays: daysIn(period), payableDays: 0, lopDays: 0 }, result, messages, baseSnapshot(d, period, snapshotExtras(built.input, result, rules, built.ruleKeys, variance))),
        );
      }
    } else if (run.kind === "full_and_final") {
      const salaryPaid = await employeesInPostedRuns(tx, period.id, "regular");
      const consumed = await consumedInputIds(tx, period.id);
      for (const e of emps) {
        const d = data.get(e.id)!;
        const setup = setups.get(e.id) as FnfSetup;
        const skipSalary = salaryPaid.has(e.id);
        const { oneOffs, messages: fnfMessages } = settlementItems(d, setup, comps, rules);
        const loans = d.loans.map((l) => ({ loanId: l.id, kind: l.kind, installment: l.outstanding, outstanding: l.outstanding }));
        const built = buildEngineInput({ period, d, rules, components: comps, inputs: d.inputs.filter((i) => !consumed.has(i.id)), loans, skipSalary, extraOneOffs: oneOffs });
        built.messages.push(...fnfMessages);
        if (skipSalary) built.messages.push({ severity: "info", code: "salary_already_paid", message: "Salary for this period was paid in the regular run; this settlement contains settlement items only." });
        if (!lastDayOf(e)) built.messages.push({ severity: "error", code: "no_exit_date", message: "No last working day is recorded for this employee." });
        const { result, messages } = runEngine(built.messages.some((m) => m.severity === "error") ? null : built.input, built.messages);
        built.ruleKeys.forEach((k) => rules.get(k) && usedRules.add(k));
        if (setup.includeGratuity && rules.get("gratuity|IN")) usedRules.add("gratuity|IN");
        outcomes.push(outcome(e.id, built.input?.days ?? { calendarDays: daysIn(period), payableDays: 0, lopDays: 0 }, result, messages, { ...baseSnapshot(d, period, snapshotExtras(built.input, result, rules, built.ruleKeys, null)), setup }));
      }
    } else if (run.kind === "adjustment") {
      if (!run.parentRunId) throw invalidState("Adjustment runs need a parent run.");
      const parentEmps = await tx.select().from(payrollRunEmployees).where(and(eq(payrollRunEmployees.runId, run.parentRunId), inArray(payrollRunEmployees.employeeId, emps.map((e) => e.id))));
      const parentLines = parentEmps.length ? await tx.select().from(payrollLineItems).where(inArray(payrollLineItems.runEmployeeId, parentEmps.map((p) => p.id))) : [];
      for (const e of emps) {
        const d = data.get(e.id)!;
        const parent = parentEmps.find((p) => p.employeeId === e.id);
        const setup = setups.get(e.id)!;
        if (!parent) {
          outcomes.push(outcome(e.id, { calendarDays: daysIn(period), payableDays: 0, lopDays: 0 }, null, [{ severity: "error", code: "not_in_parent", message: "This employee was not in the original run." }], { ...baseSnapshot(d, period, {}), setup }));
          continue;
        }
        const ps = parent.snapshot as { ytd?: EngineInput["ytd"]; profile?: { esiContinuing?: boolean }; inputs?: { id: string }[] };
        const inputIds = new Set((ps.inputs ?? []).map((i) => i.id));
        const built = buildEngineInput({ period, d, rules, components: comps, inputs: d.inputs.filter((i) => inputIds.has(i.id)), loans: [], ytd: ps.ytd, esiContinuing: ps.profile?.esiContinuing });
        const { result, messages } = runEngine(built.input, built.messages);
        built.ruleKeys.forEach((k) => rules.get(k) && usedRules.add(k));
        const original = parentLines.filter((l) => l.runEmployeeId === parent.id && l.componentCode !== "LOAN");
        const diffLines = result ? differentialLines(result.lines.filter((l) => l.componentCode !== "LOAN"), original, periodLabel(period.year, period.month)) : [];
        if (result && !diffLines.length) messages.push({ severity: "warning", code: "no_difference", message: "Recalculating gives the same result as the original run; nothing to adjust." });
        const diffResult = result ? totalsOf(diffLines, result) : null;
        if (diffResult && diffResult.net < 0) messages.push({ severity: "warning", code: "negative_adjustment", message: `Net adjustment ${inr(diffResult.net)} is a recovery; it is not paid out. Recover it through a deduction input in the next period.` });
        outcomes.push(
          outcome(e.id, built.input?.days ?? { calendarDays: daysIn(period), payableDays: 0, lopDays: 0 }, diffResult, messages, {
            ...baseSnapshot(d, period, snapshotExtras(built.input, result, rules, built.ruleKeys, null)),
            setup,
            parent: { runId: run.parentRunId, runEmployeeId: parent.id, gross: parent.grossEarnings, net: parent.netPay },
          }),
        );
      }
    }

    // Replace previous results atomically (same transaction).
    await tx.delete(payrollRunEmployees).where(eq(payrollRunEmployees.runId, run.id));
    for (const chunk of chunks(outcomes, 200)) {
      const inserted = await tx
        .insert(payrollRunEmployees)
        .values(
          chunk.map((o) => ({
            tenantId: ctx.tenantId,
            runId: run.id,
            employeeId: o.employeeId,
            status: o.status,
            calendarDays: o.calendarDays,
            payableDays: o.payableDays,
            lopDays: o.lopDays,
            grossEarnings: o.gross,
            totalDeductions: o.deductions,
            employerContributions: o.employer,
            netPay: o.net,
            snapshot: o.snapshot,
            messages: o.messages,
          })),
        )
        .returning({ id: payrollRunEmployees.id, employeeId: payrollRunEmployees.employeeId });
      const idByEmp = new Map(inserted.map((r) => [r.employeeId, r.id]));
      const lineValues = chunk.flatMap((o) =>
        o.lines.map((l) => ({
          tenantId: ctx.tenantId,
          runEmployeeId: idByEmp.get(o.employeeId)!,
          componentCode: l.componentCode,
          componentName: l.componentName,
          kind: l.kind,
          amount: l.amount,
          isTaxable: l.isTaxable,
          explanation: l.explanation,
          sortOrder: l.sortOrder,
        })),
      );
      for (const lc of chunks(lineValues, 1000)) await tx.insert(payrollLineItems).values(lc);
    }

    const ruleSets = [...usedRules].map((k) => rules.get(k)!.row).map((r) => ({ id: r.id, kind: r.kind, jurisdiction: r.jurisdiction, version: r.version, verified: !!r.verifiedAt }));
    const totals = {
      employees: outcomes.length,
      gross: sum(outcomes.map((o) => o.gross)),
      deductions: sum(outcomes.map((o) => o.deductions)),
      employerContributions: sum(outcomes.map((o) => o.employer)),
      net: sum(outcomes.map((o) => o.net)),
    };
    const now = new Date();
    await tx
      .update(payrollRuns)
      .set({
        status: "calculated",
        totals,
        calculationBasis: { engineVersion: ENGINE_VERSION, ruleSets },
        usesUnverifiedRules: ruleSets.some((r) => !r.verified),
        idempotencyKey: input.idempotencyKey,
        calculatedAt: now,
        snapshotHash: null,
      })
      .where(eq(payrollRuns.id, run.id));
    const errors = outcomes.filter((o) => o.status === "error").length;
    const variances = outcomes.filter((o) => o.messages.some((m) => m.code === "variance")).length;
    await audit(tx, ctx, {
      action: "payroll.run_calculated",
      entityType: "payroll_run",
      entityId: run.id,
      metadata: { employees: outcomes.length, errors, variances, engineVersion: ENGINE_VERSION, ruleSets: ruleSets.map((r) => `${r.kind}/${r.jurisdiction}@v${r.version}`), legalEntity: le?.name },
    });
    if (errors || variances) {
      await emitDomainEvent(tx, ctx.tenantId, "payroll.exception", { runId: run.id, errors, variances }, { dedupeKey: `payroll.exception:${run.id}:${now.getTime()}` });
    }
    return { reused: false, runId: run.id, totals, errors, variances };
  });
}

const daysIn = (p: PeriodRow) => Math.round((Date.parse(`${p.endDate}T00:00:00Z`) - Date.parse(`${p.startDate}T00:00:00Z`)) / 86_400_000) + 1;

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function snapshotExtras(input: EngineInput | null, result: EngineResult | null, rules: Rules, keys: string[], variance: EmployeeVariance | null) {
  return {
    days: input?.days ?? null,
    inputs: input?.oneOffs.filter((o) => o.id).map((o) => ({ id: o.id, kind: o.kind, componentCode: o.componentCode, amount: o.amount })) ?? [],
    settlementItems: input?.oneOffs.filter((o) => !o.id).map((o) => ({ kind: o.kind, componentCode: o.componentCode, amount: o.amount })) ?? [],
    loans: input?.loans.map((l) => ({ loanId: l.loanId, amount: Math.min(l.installment, l.outstanding), outstandingBefore: l.outstanding })) ?? [],
    ruleSets: keys.flatMap((k) => {
      const r = rules.get(k)?.row;
      return r ? [{ id: r.id, kind: r.kind, jurisdiction: r.jurisdiction, version: r.version, verified: !!r.verifiedAt }] : [];
    }),
    profile: input?.profile ? { ...input.profile, declarations: undefined, declarationKeys: Object.keys(input.profile.declarations) } : null,
    ytd: input?.ytd ?? null,
    statutory: result?.statutory ?? null,
    fullMonthGross: result?.fullMonthGross ?? null,
    explanation: result?.explanation ?? null,
    variance,
  };
}

async function employeesInPostedRuns(tx: Tx, periodId: string, kind: "regular") {
  const rows = await tx
    .select({ e: payrollRunEmployees.employeeId })
    .from(payrollRunEmployees)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunEmployees.runId))
    .where(and(eq(payrollRuns.periodId, periodId), eq(payrollRuns.kind, kind), inArray(payrollRuns.status, POSTED_STATUSES)));
  return new Set(rows.map((r) => r.e));
}

async function consumedInputIds(tx: Tx, periodId: string) {
  const rows = await tx
    .select({ snapshot: payrollRunEmployees.snapshot })
    .from(payrollRunEmployees)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunEmployees.runId))
    .where(and(eq(payrollRuns.periodId, periodId), inArray(payrollRuns.status, POSTED_STATUSES)));
  return new Set(rows.flatMap((r) => ((r.snapshot as { inputs?: { id: string }[] }).inputs ?? []).map((i) => i.id)));
}

/** F&F settlement amounts (leave encashment, notice pay/recovery, gratuity) as one-off inputs. */
function settlementItems(d: EmployeeData, setup: FnfSetup, comps: ReturnType<typeof toComponentDef>[], rules: Rules): { oneOffs: OneOffInput[]; messages: Message[] } {
  const messages: Message[] = [];
  const oneOffs: OneOffInput[] = [];
  if (!d.compensation || !d.structure) {
    messages.push({ severity: "error", code: "no_compensation", message: "Settlement items need the employee's compensation and salary structure." });
    return { oneOffs, messages };
  }
  const pf = rules.get("pf|IN")?.params as PfParams | null | undefined;
  let basicMonthly = 0;
  let grossMonthly = 0;
  try {
    const age = d.employee.dateOfBirth ? ageOn(d.employee.dateOfBirth, lastDayOf(d.employee) ?? d.employee.joiningDate) : null;
    const s = resolveStructure(d.compensation.annualCtc, d.structure.lines, comps, { pf: pf ?? null, pfApplicable: true, pfWageBasis: "capped", epsEligible: true, ageYears: age });
    basicMonthly = s.earnings.find((l) => l.code === "BASIC")?.monthly ?? 0;
    grossMonthly = s.grossMonthly;
  } catch (err) {
    if (err instanceof PayrollValidationError) {
      messages.push(...err.issues.map((m) => ({ severity: "error" as const, code: "invalid_structure", message: m })));
      return { oneOffs, messages };
    }
    throw err;
  }
  if (setup.leaveEncashmentDays > 0) {
    const r = perDayAmount(basicMonthly, setup.encashmentDivisor, setup.leaveEncashmentDays, "Leave encashment (basic)");
    if (r.amount > 0) oneOffs.push({ kind: "leave_encashment", componentCode: "LEAVE_ENC", amount: r.amount, isTaxable: true, explanation: r.explanation });
  }
  if (setup.noticePayDays > 0) {
    const r = perDayAmount(grossMonthly, 30, setup.noticePayDays, "Notice pay in lieu (monthly gross)");
    if (r.amount > 0) oneOffs.push({ kind: "other_earning", componentCode: "NOTICE_PAY", amount: r.amount, isTaxable: true, explanation: r.explanation });
  }
  if (setup.noticeRecoveryDays > 0) {
    const r = perDayAmount(grossMonthly, 30, setup.noticeRecoveryDays, "Notice period shortfall recovery (monthly gross)");
    if (r.amount > 0) oneOffs.push({ kind: "recovery", componentCode: "NOTICE_REC", amount: r.amount, isTaxable: false, explanation: r.explanation });
  }
  if (setup.includeGratuity) {
    const g = rules.get("gratuity|IN");
    const exit = lastDayOf(d.employee);
    if (!g?.params) messages.push({ severity: "error", code: "no_gratuity_rules", message: "No gratuity rule set is effective for this period." });
    else if (exit) {
      const r = calculateGratuity(g.params as GratuityParams, { lastDrawnMonthlyWage: basicMonthly, joiningDate: d.employee.joiningDate, exitDate: exit });
      if (r.eligible && r.amount > 0) oneOffs.push({ kind: "other_earning", componentCode: "GRATUITY", amount: r.amount, isTaxable: false, explanation: r.explanation });
      else messages.push({ severity: "info", code: "gratuity_not_eligible", message: r.explanation });
    }
  }
  const missing = oneOffs.filter((o) => !comps.some((c) => c.code === o.componentCode)).map((o) => o.componentCode);
  if (missing.length) messages.push({ severity: "error", code: "missing_component", message: `Settlement components are missing or inactive: ${missing.join(", ")}. Load the standard components.` });
  return { oneOffs, messages };
}

/** Lines = recalculated − original, per component, for adjustment runs. */
function differentialLines(current: PayLine[], original: (typeof payrollLineItems.$inferSelect)[], label: string): PayLine[] {
  const keys = new Set([...current.map((l) => l.componentCode), ...original.map((l) => l.componentCode)]);
  const out: PayLine[] = [];
  for (const code of keys) {
    const now = current.filter((l) => l.componentCode === code);
    const was = original.filter((l) => l.componentCode === code);
    const delta = sum(now.map((l) => l.amount)) - sum(was.map((l) => l.amount));
    if (delta === 0) continue;
    const ref = now[0] ?? was[0];
    out.push({
      componentCode: code,
      componentName: ref.componentName,
      kind: ref.kind,
      amount: delta,
      isTaxable: ref.isTaxable,
      sortOrder: ref.sortOrder,
      explanation: `Adjustment for ${label}: recalculated ${inr(sum(now.map((l) => l.amount)))} − originally ${inr(sum(was.map((l) => l.amount)))} = ${inr(delta)}${now[0] ? `. Now: ${now[0].explanation}` : ""}`,
    });
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder || a.componentCode.localeCompare(b.componentCode));
}

function totalsOf(lines: PayLine[], base: EngineResult): EngineResult {
  const gross = sum(lines.filter((l) => l.kind === "earning" || l.kind === "reimbursement").map((l) => l.amount));
  const deductions = sum(lines.filter((l) => l.kind === "deduction" || l.kind === "statutory_deduction").map((l) => l.amount));
  const employerContributions = sum(lines.filter((l) => l.kind === "employer_contribution").map((l) => l.amount));
  return { ...base, lines, gross, deductions, employerContributions, net: gross - deductions, explanation: `Adjustment: gross ${inr(gross)} − deductions ${inr(deductions)} = net ${inr(gross - deductions)}.` };
}
