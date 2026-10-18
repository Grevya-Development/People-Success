import "server-only";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { RequestContext } from "../../auth/context";
import { authorizeEmployee, can } from "../../auth/context";
import { documents, employees, legalEntities, payrollLineItems, payrollPeriods, payrollRunEmployees, payrollRuns, payslips } from "../../db/schema";
import { audit } from "../../lib/audit";
import { forbidden, invalidState } from "../../lib/errors";
import { notify } from "../notifications";
import { emitDomainEvent } from "../events";
import { PdfBuilder, formatInr } from "../../pdf/builder";
import { storeGeneratedPdf } from "../../pdf/store";
import { amountInWords } from "@/lib/payroll/words";
import { daysLabel } from "@/lib/payroll/money";
import { formatDate } from "@/lib/format";
import { authorizeAny, lockRun, periodLabel, POSTED_STATUSES, verifySnapshot } from "./shared";

type SnapshotView = {
  employee?: { code?: string; name?: string; designation?: string | null; department?: string | null; location?: string | null; panLast4?: string | null; uan?: string | null; bankLast4?: string | null; bankIfsc?: string | null; joiningDate?: string };
  ytd?: { taxableEarnings: number; tds: number } | null;
  profile?: { taxRegime?: string } | null;
  period?: { label?: string };
};

const masked = (last4: string | null | undefined, len: number) => (last4 ? `${"X".repeat(Math.max(0, len - last4.length))}${last4}` : "Not on file");

async function payslipPdf(input: {
  company: { name: string; legalName: string; addressLine: string | null };
  title: string;
  period: { label: string; payDate: string };
  result: { calendarDays: number; payableDays: number; lopDays: number; gross: number; deductions: number; employer: number; net: number };
  snapshot: SnapshotView;
  lines: { componentName: string; kind: string; amount: number; componentCode: string }[];
}) {
  const s = input.snapshot;
  const e = s.employee ?? {};
  const b = await PdfBuilder.create({ title: `${input.title} – ${e.name ?? ""}`, author: input.company.name, footer: "System-generated payslip; no signature required" });
  b.letterhead(input.company, input.title, `Pay period ${input.period.label} · Paid on ${formatDate(input.period.payDate)}`);
  b.grid(
    [
      ["Employee", e.name ?? "-"],
      ["Employee code", e.code ?? "-"],
      ["Designation", e.designation ?? "-"],
      ["Department", e.department ?? "-"],
      ["Date of joining", e.joiningDate ? formatDate(e.joiningDate) : "-"],
      ["PAN", masked(e.panLast4, 10)],
      ["UAN", e.uan ?? "-"],
      ["Bank account", masked(e.bankLast4, 12)],
      ["IFSC", e.bankIfsc ?? "-"],
      ["Calendar days", String(input.result.calendarDays)],
      ["Payable days", daysLabel(input.result.payableDays)],
      ["Loss of pay days", daysLabel(input.result.lopDays)],
    ],
    3,
  );
  const shown = input.lines.filter((l) => l.amount !== 0);
  const earnings = shown.filter((l) => l.kind === "earning" || l.kind === "reimbursement");
  const deductions = shown.filter((l) => l.kind === "deduction" || l.kind === "statutory_deduction");
  const employer = shown.filter((l) => l.kind === "employer_contribution");
  const cols = [
    { header: "Component", width: 0.7 },
    { header: "Amount", width: 0.3, align: "right" as const },
  ];
  b.text("Earnings", { bold: true, size: 10.5 });
  b.table(cols, earnings.map((l) => [l.componentName, formatInr(l.amount)]), { totals: ["Gross earnings", formatInr(input.result.gross)] });
  b.text("Deductions", { bold: true, size: 10.5 });
  b.table(cols, deductions.length ? deductions.map((l) => [l.componentName, formatInr(l.amount)]) : [["No deductions", formatInr(0)]], { totals: ["Total deductions", formatInr(input.result.deductions)] });
  b.spacer(4).rule();
  b.text(`Net pay: ${formatInr(input.result.net)}`, { bold: true, size: 12.5, gap: 1 });
  b.text(amountInWords(input.result.net), { size: 9.5 });
  if (employer.length) {
    b.spacer(8);
    b.text("Employer contributions (not part of take-home pay)", { bold: true, size: 10 });
    b.table(cols, employer.map((l) => [l.componentName, formatInr(l.amount)]), { totals: ["Total", formatInr(input.result.employer)], size: 8.5 });
  }
  if (s.ytd) {
    b.spacer(4);
    b.grid(
      [
        ["Taxable earnings this FY before this month", formatInr(s.ytd.taxableEarnings)],
        ["TDS this FY before this month", formatInr(s.ytd.tds)],
        ["Tax regime", s.profile?.taxRegime === "old" ? "Old regime" : "New regime"],
      ],
      3,
    );
  }
  return b.toBytes();
}

const titleFor = (kind: string, label: string) =>
  kind === "full_and_final" ? `Full and final settlement – ${label}` : kind === "adjustment" ? `Payroll adjustment – ${label}` : `Payslip for ${label}`;

/**
 * Generate and publish payslips for a locked run. Idempotent: employees who
 * already have a payslip for this run are skipped, so re-publishing never
 * creates duplicates. Notifications contain no amounts.
 */
export async function publishPayslips(ctx: RequestContext, runId: string) {
  authorizeAny(ctx, ["payroll.approve", "payroll.run"]);
  return ctx.db(async (tx) => {
    const run = await lockRun(tx, runId);
    if (!POSTED_STATUSES.includes(run.status)) throw invalidState("Lock the run before publishing payslips.");
    await verifySnapshot(tx, run);
    const [period] = await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, run.periodId));
    const [le] = await tx.select().from(legalEntities).where(eq(legalEntities.id, run.legalEntityId));
    const results = await tx
      .select({ re: payrollRunEmployees, userId: employees.userId, code: employees.employeeCode })
      .from(payrollRunEmployees)
      .innerJoin(employees, eq(employees.id, payrollRunEmployees.employeeId))
      .where(eq(payrollRunEmployees.runId, run.id));
    const eligible = results.filter((r) => r.re.status === "ok" || r.re.status === "warning");
    const existing = await tx.select().from(payslips).where(eq(payslips.runId, run.id));
    const done = new Set(existing.filter((p) => p.documentId).map((p) => p.runEmployeeId));
    const todo = eligible.filter((r) => !done.has(r.re.id));
    const lines = todo.length ? await tx.select().from(payrollLineItems).where(inArray(payrollLineItems.runEmployeeId, todo.map((t) => t.re.id))).orderBy(asc(payrollLineItems.sortOrder)) : [];
    const label = periodLabel(period.year, period.month);
    const title = titleFor(run.kind, label);
    const a = le.address;
    const company = { name: le.name, legalName: le.legalName, addressLine: [a.line1, a.line2, a.city, a.stateCode, a.postalCode].filter(Boolean).join(", ") || null };
    const now = new Date();
    let created = 0;
    for (const r of todo) {
      const bytes = await payslipPdf({
        company,
        title,
        period: { label, payDate: period.payDate },
        result: { calendarDays: r.re.calendarDays, payableDays: Number(r.re.payableDays), lopDays: Number(r.re.lopDays), gross: r.re.grossEarnings, deductions: r.re.totalDeductions, employer: r.re.employerContributions, net: r.re.netPay },
        snapshot: r.re.snapshot as SnapshotView,
        lines: lines.filter((l) => l.runEmployeeId === r.re.id),
      });
      const doc = await storeGeneratedPdf(tx, {
        tenantId: ctx.tenantId,
        bytes,
        ownerType: "employee",
        ownerId: r.re.employeeId,
        employeeId: r.re.employeeId,
        category: "payslip",
        title,
        fileName: `${run.kind === "regular" ? "payslip" : run.kind.replace(/_/g, "-")}-${period.year}-${String(period.month).padStart(2, "0")}-${r.code}.pdf`,
        employeeVisible: true,
        isSensitive: true,
        createdBy: ctx.userId,
      });
      const prior = existing.find((p) => p.runEmployeeId === r.re.id);
      if (prior) {
        await tx.update(payslips).set({ documentId: doc.id, publishedAt: prior.publishedAt ?? now }).where(eq(payslips.id, prior.id));
      } else {
        await tx.insert(payslips).values({ tenantId: ctx.tenantId, runEmployeeId: r.re.id, runId: run.id, employeeId: r.re.employeeId, periodId: run.periodId, documentId: doc.id, publishedAt: now });
      }
      created++;
    }
    const firstPublish = run.status !== "published";
    if (firstPublish) await tx.update(payrollRuns).set({ status: "published", publishedAt: now }).where(eq(payrollRuns.id, run.id));
    const recipients = todo.map((t) => t.userId).filter(Boolean) as string[];
    for (const t of todo) {
      if (!t.userId) continue;
      await notify(tx, {
        tenantId: ctx.tenantId,
        userIds: [t.userId],
        category: "payroll",
        title: run.kind === "regular" ? `Your payslip for ${label} is ready` : `${title} is ready`,
        body: "Open it from My payslips.",
        href: "/payroll/payslips",
        dedupeKey: `payslip:${run.id}:${t.re.employeeId}`,
      });
    }
    await audit(tx, ctx, { action: "payroll.payslips_published", entityType: "payroll_run", entityId: run.id, metadata: { created, skippedExisting: eligible.length - todo.length, notified: recipients.length } });
    if (created) await emitDomainEvent(tx, ctx.tenantId, "payroll.payslips_published", { runId: run.id, periodId: run.periodId, count: created }, { dedupeKey: `payroll.payslips_published:${run.id}:${now.getTime()}` });
    return { created, skippedExisting: eligible.length - todo.length };
  });
}

export type PayslipItem = { id: string; documentId: string | null; title: string; periodLabel: string; runKind: string; publishedAt: string; net: number; gross: number };

/** Published payslips for the signed-in employee (or, with payslips.view scope, another employee). */
export async function listPayslips(ctx: RequestContext, employeeId?: string): Promise<PayslipItem[]> {
  const target = employeeId ?? ctx.employeeId;
  if (!target) return [];
  if (!can(ctx, "payslips.view")) throw forbidden();
  await authorizeEmployee(ctx, "payslips.view", target);
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ p: payslips, title: documents.title, kind: payrollRuns.kind, snapshot: payrollRunEmployees.snapshot, net: payrollRunEmployees.netPay, gross: payrollRunEmployees.grossEarnings })
      .from(payslips)
      .innerJoin(payrollRunEmployees, eq(payrollRunEmployees.id, payslips.runEmployeeId))
      .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
      .leftJoin(documents, eq(documents.id, payslips.documentId))
      .where(and(eq(payslips.employeeId, target), isNotNull(payslips.publishedAt)))
      .orderBy(desc(payslips.publishedAt));
    return rows.map((r) => ({
      id: r.p.id,
      documentId: r.p.documentId,
      title: r.title ?? "Payslip",
      periodLabel: (r.snapshot as SnapshotView).period?.label ?? "",
      runKind: r.kind,
      publishedAt: r.p.publishedAt!.toISOString(),
      net: r.net,
      gross: r.gross,
    }));
  });
}
