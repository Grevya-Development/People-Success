import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import type { RequestContext } from "../../auth/context";
import { authorize } from "../../auth/context";
import { employees, payrollLineItems, payrollPeriods, payrollRunEmployees, payrollRuns } from "../../db/schema";
import { audit } from "../../lib/audit";
import { notFound } from "../../lib/errors";
import { toCsv } from "@/lib/csv";
import type { StatutoryBreakdown } from "@/lib/payroll/types";
import { authorizePayrollRead, periodLabel } from "./shared";

const rupeesText = (paise: number) => (paise / 100).toFixed(2);

async function loadRun(ctx: RequestContext, runId: string) {
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select({ run: payrollRuns, period: payrollPeriods })
      .from(payrollRuns)
      .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
      .where(eq(payrollRuns.id, runId));
    if (!row) throw notFound("Payroll run");
    const emps = await tx
      .select({ e: payrollRunEmployees, code: employees.employeeCode, name: employees.displayName })
      .from(payrollRunEmployees)
      .innerJoin(employees, eq(employees.id, payrollRunEmployees.employeeId))
      .where(eq(payrollRunEmployees.runId, runId))
      .orderBy(asc(employees.employeeCode));
    const lines = emps.length ? await tx.select().from(payrollLineItems).where(inArray(payrollLineItems.runEmployeeId, emps.map((e) => e.e.id))) : [];
    return { ...row, emps, lines };
  });
}

/** Payroll register (one row per employee, one column per component). Requires payroll.view + reports.export; audited. */
export async function payrollRegisterCsv(ctx: RequestContext, runId: string) {
  authorize(ctx, "payroll.view", "all");
  authorize(ctx, "reports.export", "all");
  const { run, period, emps, lines } = await loadRun(ctx, runId);
  const comps = new Map<string, { name: string; kind: string; sortOrder: number }>();
  for (const l of lines) if (!comps.has(l.componentCode)) comps.set(l.componentCode, { name: l.componentName, kind: l.kind, sortOrder: l.sortOrder });
  const codes = [...comps.entries()].sort((a, b) => a[1].sortOrder - b[1].sortOrder || a[0].localeCompare(b[0])).map(([c]) => c);
  const header = ["Employee code", "Employee name", "Status", "Calendar days", "Payable days", "LOP days", ...codes.map((c) => `${comps.get(c)!.name} (${c})`), "Gross earnings", "Total deductions", "Net pay", "Employer contributions"];
  const rows: (string | number)[][] = [header];
  for (const { e, code, name } of emps) {
    const mine = lines.filter((l) => l.runEmployeeId === e.id);
    rows.push([
      code,
      name,
      e.status,
      e.calendarDays,
      Number(e.payableDays),
      Number(e.lopDays),
      ...codes.map((c) => rupeesText(mine.filter((l) => l.componentCode === c).reduce((a, l) => a + l.amount, 0))),
      rupeesText(e.grossEarnings),
      rupeesText(e.totalDeductions),
      rupeesText(e.netPay),
      rupeesText(e.employerContributions),
    ]);
  }
  await ctx.db((tx) => audit(tx, ctx, { action: "payroll.register_exported", entityType: "payroll_run", entityId: run.id, metadata: { employees: emps.length } }));
  return { csv: toCsv(rows), fileName: `payroll-register-${period.year}-${String(period.month).padStart(2, "0")}-${run.kind}.csv` };
}

export type ComponentSummaryRow = { code: string; name: string; kind: string; employees: number; total: number };

export type StatutorySummary = {
  pf: { members: number; wages: number; employee: number; eps: number; epf: number };
  esi: { covered: number; wages: number; employee: number; employer: number };
  pt: { state: string; employees: number; amount: number }[];
  lwf: { state: string; employees: number; employee: number; employer: number }[];
  tds: { employees: number; amount: number; newRegime: number; oldRegime: number };
};

/** Component totals and statutory summaries — for reconciliation; not a statutory return. */
export async function runSummaries(ctx: RequestContext, runId: string) {
  authorizePayrollRead(ctx);
  const { run, period, emps, lines } = await loadRun(ctx, runId);
  const byCode = new Map<string, ComponentSummaryRow & { set: Set<string> }>();
  for (const l of lines) {
    const row = byCode.get(l.componentCode) ?? { code: l.componentCode, name: l.componentName, kind: l.kind, employees: 0, total: 0, set: new Set<string>() };
    row.total += l.amount;
    row.set.add(l.runEmployeeId);
    byCode.set(l.componentCode, row);
  }
  const components: ComponentSummaryRow[] = [...byCode.values()].map(({ set, ...r }) => ({ ...r, employees: set.size })).filter((r) => r.total !== 0);
  const stat: StatutorySummary = {
    pf: { members: 0, wages: 0, employee: 0, eps: 0, epf: 0 },
    esi: { covered: 0, wages: 0, employee: 0, employer: 0 },
    pt: [],
    lwf: [],
    tds: { employees: 0, amount: 0, newRegime: 0, oldRegime: 0 },
  };
  const pt = new Map<string, { employees: number; amount: number }>();
  const lwf = new Map<string, { employees: number; employee: number; employer: number }>();
  for (const { e } of emps) {
    const s = (e.snapshot as { statutory?: StatutoryBreakdown | null }).statutory;
    if (!s) continue;
    if (s.pf && s.pf.employee) {
      stat.pf.members++;
      stat.pf.wages += s.pf.employeeWage;
      stat.pf.employee += s.pf.employee;
      stat.pf.eps += s.pf.eps;
      stat.pf.epf += s.pf.epf;
    }
    if (s.esi?.covered && (s.esi.employee || s.esi.employer)) {
      stat.esi.covered++;
      stat.esi.wages += s.esi.wages;
      stat.esi.employee += s.esi.employee;
      stat.esi.employer += s.esi.employer;
    }
    if (s.pt && s.pt.amount) {
      const x = pt.get(s.pt.state) ?? { employees: 0, amount: 0 };
      x.employees++;
      x.amount += s.pt.amount;
      pt.set(s.pt.state, x);
    }
    if (s.lwf) {
      const x = lwf.get(s.lwf.state) ?? { employees: 0, employee: 0, employer: 0 };
      x.employees++;
      x.employee += s.lwf.employee;
      x.employer += s.lwf.employer;
      lwf.set(s.lwf.state, x);
    }
    if (s.tds && s.tds.amount) {
      stat.tds.employees++;
      stat.tds.amount += s.tds.amount;
      if (s.tds.regime === "old") stat.tds.oldRegime++;
      else stat.tds.newRegime++;
    }
  }
  stat.pt = [...pt.entries()].map(([state, v]) => ({ state, ...v })).sort((a, b) => a.state.localeCompare(b.state));
  stat.lwf = [...lwf.entries()].map(([state, v]) => ({ state, ...v })).sort((a, b) => a.state.localeCompare(b.state));
  return { runId: run.id, periodLabel: periodLabel(period.year, period.month), components, statutory: stat };
}
