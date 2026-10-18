import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Boxes, FileSpreadsheet, HandCoins, Layers, Scale } from "lucide-react";
import { EmptyState, NoAccess, Page, PageHeader, Reveal, Section, TableSkeleton } from "@/components/page";
import { LinkTabs } from "@/components/documents/link-tabs";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, requireContext, type RequestContext } from "@/server/auth/context";
import { listComponents, listStructures } from "@/server/services/payroll/config";
import { listRuleSets } from "@/server/services/payroll/rules";
import { listOpenPeriodInputs } from "@/server/services/payroll/inputs";
import { listLoans } from "@/server/services/payroll/loans";
import { currentFyStartYear, listDeclarations } from "@/server/services/payroll/declarations";
import { payrollLookups } from "@/server/services/payroll/lookups";
import { isPayrollStaff } from "@/server/services/payroll/shared";
import { RULE_KIND_LABELS, type RuleKind } from "@/lib/payroll/params";
import { formatDate, formatMoney, titleCase, todayIn } from "@/lib/format";
import { MONTHS } from "@/lib/india";
import { PayrollTabs } from "../_components/payroll-tabs";
import { VerificationBadge } from "../_components/status";
import { ComponentDialog, DeclarationReviewButtons, LoanDialog, SeedButton } from "./component-dialogs";
import { AssignStructureDialog, StructureDialog } from "./structure-dialogs";
import { structureLineLabel } from "../_components/labels";
import { RuleSetVersionDialog, VerifyRuleSetDialog } from "./rule-dialogs";

export const metadata: Metadata = { title: "Payroll configuration" };

type Tab = "components" | "structures" | "statutory" | "inputs" | "loans";
const TABS: { key: Tab; label: string }[] = [
  { key: "components", label: "Components" },
  { key: "structures", label: "Structures" },
  { key: "statutory", label: "Statutory rules" },
  { key: "inputs", label: "Inputs & declarations" },
  { key: "loans", label: "Loans & advances" },
];

export default function ConfigurationPage({ searchParams }: PageProps<"/payroll/configuration">) {
  return (
    <Page>
      <PageHeader title="Payroll configuration" description="Pay components, salary structures, statutory parameters, inputs and loans." />
      <Suspense fallback={<TableSkeleton rows={6} columns={5} />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/payroll/configuration">["searchParams"] }) {
  const ctx = await requireContext();
  if (!isPayrollStaff(ctx)) return <NoAccess />;
  const sp = await searchParams;
  const active = (TABS.find((t) => t.key === sp.tab)?.key ?? "components") as Tab;
  return (
    <>
      <PayrollTabs ctx={ctx} active="configuration" />
      <LinkTabs label="Configuration sections" active={active} tabs={TABS.map((t) => ({ ...t, href: `/payroll/configuration?tab=${t.key}` }))} />
      <Suspense key={active} fallback={<TableSkeleton rows={6} columns={5} />}>
        {active === "components" ? <Components ctx={ctx} /> : null}
        {active === "structures" ? <Structures ctx={ctx} /> : null}
        {active === "statutory" ? <Statutory ctx={ctx} /> : null}
        {active === "inputs" ? <Inputs ctx={ctx} /> : null}
        {active === "loans" ? <Loans ctx={ctx} /> : null}
      </Suspense>
    </>
  );
}

async function Components({ ctx }: { ctx: RequestContext }) {
  const rows = await listComponents(ctx);
  const canConfig = can(ctx, "payroll.config", "all");
  return (
    <Reveal className="space-y-4">
      {canConfig ? (
        <div className="flex flex-wrap justify-end gap-2">
          <SeedButton
            label="Load standard components"
            title="Load the standard components?"
            description="Adds any missing standard components (Basic, HRA, special allowance, PF, ESI, PT, LWF, TDS, bonus, arrears, reimbursements, loans and more) and a default structure if you have none. Existing components are never changed."
            kind="components"
          />
          <ComponentDialog />
        </div>
      ) : null}
      {rows.length ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Component</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="hidden md:table-cell">Calculation</TableHead>
                <TableHead className="hidden lg:table-cell">Wages for</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="pl-4">
                    <p className="font-medium">{c.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{c.code}</p>
                  </TableCell>
                  <TableCell>{titleCase(c.kind)}</TableCell>
                  <TableCell className="hidden md:table-cell">{titleCase(c.calculation)}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {[c.pfWage && "PF", c.esiWage && "ESI", c.ptWage && "PT", c.isTaxable && "Taxable", c.prorate && "Prorated"].filter(Boolean).join(" · ") || "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={c.isActive ? "active" : "inactive"} tone={c.isActive ? "success" : "neutral"} />
                      {c.isSystem ? <StatusBadge status="system" tone="neutral" label="Built-in" /> : null}
                    </div>
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    {canConfig ? (
                      <ComponentDialog
                        isSystem={c.isSystem}
                        values={{
                          id: c.id,
                          code: c.code,
                          name: c.name,
                          kind: c.kind,
                          calculation: c.calculation,
                          value: c.value == null ? null : c.calculation === "fixed" ? c.value / 100 : c.value,
                          isTaxable: c.isTaxable,
                          isPartOfCtc: c.isPartOfCtc,
                          pfWage: c.pfWage,
                          esiWage: c.esiWage,
                          ptWage: c.ptWage,
                          prorate: c.prorate,
                          payslipLabel: c.payslipLabel ?? "",
                          sortOrder: c.sortOrder,
                          isActive: c.isActive,
                        }}
                      />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState icon={Boxes} title="No pay components yet" description={canConfig ? "Load the standard Indian components to get started, then adjust them to your policy." : "Ask a payroll administrator to set up components."} />
      )}
    </Reveal>
  );
}

async function Structures({ ctx }: { ctx: RequestContext }) {
  const canConfig = can(ctx, "payroll.config", "all");
  const [rows, lookups] = await Promise.all([listStructures(ctx), payrollLookups(ctx)]);
  return (
    <Reveal className="space-y-4">
      {canConfig ? (
        <div className="flex flex-wrap justify-end gap-2">
          {can(ctx, "compensation.edit", "all") && lookups.structures.length ? <AssignStructureDialog employees={lookups.employees} structures={lookups.structures} /> : null}
          <StructureDialog components={lookups.components} />
        </div>
      ) : null}
      {rows.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((s) => (
            <Section
              key={s.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {s.name} <span className="text-xs font-normal text-muted-foreground">v{s.version}</span>
                  {s.isDefault ? <StatusBadge status="default" tone="brand" label="Default" /> : null}
                  {!s.isActive ? <StatusBadge status="inactive" /> : null}
                </span>
              }
              description={`${s.assignedCount} employee${s.assignedCount === 1 ? "" : "s"} assigned${s.isDefault ? " (plus everyone without a structure)" : ""}${s.description ? ` · ${s.description}` : ""}`}
              actions={
                canConfig ? (
                  <StructureDialog
                    components={lookups.components}
                    values={{
                      id: s.id,
                      name: s.name,
                      description: s.description ?? "",
                      isDefault: s.isDefault,
                      isActive: s.isActive,
                      lines: s.lines.map((l) => ({ componentCode: l.componentCode, calculation: l.calculation, value: l.value == null ? null : l.calculation === "fixed" ? l.value / 100 : l.value })),
                    }}
                  />
                ) : null
              }
            >
              <ul className="divide-y text-sm">
                {s.lines.map((l) => (
                  <li key={l.componentCode} className="flex items-center justify-between px-5 py-2">
                    <span className="font-mono text-xs">{l.componentCode}</span>
                    <span className="text-muted-foreground">{structureLineLabel(l)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ))}
        </div>
      ) : (
        <EmptyState icon={Layers} title="No salary structures" description="Create a structure, or load the standard components to get a default one." />
      )}
    </Reveal>
  );
}

async function Statutory({ ctx }: { ctx: RequestContext }) {
  const canConfig = can(ctx, "payroll.config", "all");
  const rows = await listRuleSets(ctx);
  const unverified = rows.filter((r) => !r.verified).length;
  return (
    <Reveal className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Parameters for PF, ESI, professional tax, LWF, income tax, gratuity and bonus are configuration, not code. The rule set effective on a period&apos;s end date is used. Default values are offered for convenience only and are stored{" "}
          <span className="font-medium text-warning">unverified</span>: a qualified payroll professional must verify each one before production use.
          {unverified ? ` ${unverified} version${unverified === 1 ? " is" : "s are"} unverified.` : ""}
        </p>
        {canConfig ? (
          <div className="flex flex-wrap gap-2">
            <SeedButton
              label="Load default statutory rule sets"
              title="Load the default statutory rule sets?"
              description="Adds PF, ESI, professional tax (KA, MH, TN, TG, WB, GJ), LWF (KA, MH), income tax FY 2025-26 (both regimes), gratuity and bonus parameters as UNVERIFIED rule sets with their source references. Existing rule sets are not changed."
              kind="rules"
            />
            <RuleSetVersionDialog mode="create" />
          </div>
        ) : null}
      </div>
      {rows.length ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Rule set</TableHead>
                <TableHead>Jurisdiction</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead className="text-right">Version</TableHead>
                <TableHead>Verification</TableHead>
                <TableHead className="pr-4 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className={r.isLatestVersion ? undefined : "opacity-70"}>
                  <TableCell className="max-w-96 pl-4 whitespace-normal">
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{RULE_KIND_LABELS[r.kind as RuleKind] ?? r.kind}</p>
                    {r.sourceReference ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">Source: {r.sourceReference}</p> : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.jurisdiction}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(r.effectiveFrom)}
                    {r.effectiveTo ? ` – ${formatDate(r.effectiveTo)}` : " onwards"}
                  </TableCell>
                  <TableCell className="text-right tabular">
                    v{r.version}
                    {!r.isLatestVersion ? <span className="block text-xs text-muted-foreground">superseded</span> : null}
                  </TableCell>
                  <TableCell>
                    <VerificationBadge verified={r.verified} />
                    {r.verified ? <p className="mt-0.5 text-xs text-muted-foreground">{[r.verifiedByName, r.verifiedAt ? formatDate(r.verifiedAt) : null].filter(Boolean).join(" · ")}</p> : null}
                    {r.usedByPostedRun ? <p className="mt-0.5 text-xs text-muted-foreground">Used by a locked run</p> : null}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <div className="flex justify-end gap-1">
                      {canConfig ? <RuleSetVersionDialog mode="edit" source={r} /> : null}
                      {canConfig && !r.verified ? <VerifyRuleSetDialog id={r.id} name={r.name} version={r.version} /> : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState icon={Scale} title="No statutory rule sets" description={canConfig ? "Load the default rule sets (stored unverified) or add your own." : "Ask a payroll administrator to configure statutory rules."} />
      )}
    </Reveal>
  );
}

async function Inputs({ ctx }: { ctx: RequestContext }) {
  const fy = currentFyStartYear();
  const [inputs, declarations] = await Promise.all([listOpenPeriodInputs(ctx), can(ctx, "payroll.view", "all") ? listDeclarations(ctx, fy) : Promise.resolve([])]);
  const canReview = can(ctx, "payroll.run", "all");
  return (
    <Reveal className="space-y-5">
      <Section title="How inputs arrive" description="One-off amounts are posted to an open period, never to a locked one.">
        <ul className="list-disc space-y-1 py-3 pr-5 pl-10 text-sm text-muted-foreground">
          <li>Payroll enters them on a period page, or imports a CSV (re-importing the same rows never double-posts).</li>
          <li>Other modules post automatically with their own source: expense claims (expense_claim), referral rewards (referral_reward) and leave encashment (leave_encashment). Each source record is posted at most once.</li>
          <li>Inputs that arrive after a period&apos;s cutoff go to the next open period.</li>
        </ul>
      </Section>
      <Section title="Inputs in open periods">
        {inputs.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Employee</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="pr-5">Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inputs.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="pl-5">
                      <Link href={`/payroll/periods/${i.periodId}`} className="font-medium hover:underline">
                        {i.employeeName}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{i.employeeCode}</span>
                    </TableCell>
                    <TableCell>{i.periodLabel}</TableCell>
                    <TableCell>
                      {titleCase(i.kind)} · <span className="font-mono text-xs">{i.componentCode}</span>
                    </TableCell>
                    <TableCell className="text-right tabular">{formatMoney(i.amount)}</TableCell>
                    <TableCell className="pr-5 text-muted-foreground">{titleCase(i.sourceType)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState className="m-4 border-0" icon={FileSpreadsheet} title="No inputs in open periods" />
        )}
      </Section>
      <Section title={`Tax declarations · FY ${fy}-${String((fy + 1) % 100).padStart(2, "0")}`} description="Submitted declarations count in old-regime TDS projections. Verify them against proofs, or return them to the employee.">
        {declarations.length ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Employee</TableHead>
                <TableHead>Regime</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Declared deductions</TableHead>
                <TableHead className="pr-5 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {declarations.map(({ d, name, code }) => (
                <TableRow key={d.id}>
                  <TableCell className="pl-5">
                    {name} <span className="text-xs text-muted-foreground">{code}</span>
                  </TableCell>
                  <TableCell>{titleCase(d.regime)}</TableCell>
                  <TableCell>
                    <StatusBadge status={d.status} tone={d.status === "verified" ? "success" : d.status === "submitted" ? "info" : "neutral"} />
                  </TableCell>
                  <TableCell className="text-right tabular">{formatMoney(Object.entries(d.declarations).filter(([k]) => k !== "metro").reduce((a, [, v]) => a + v, 0))}</TableCell>
                  <TableCell className="pr-5 text-right">{canReview && d.status === "submitted" ? <DeclarationReviewButtons id={d.id} /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState className="m-4 border-0" title="No declarations yet" description="Employees submit their regime choice and declarations from My payslips." />
        )}
      </Section>
    </Reveal>
  );
}

async function Loans({ ctx }: { ctx: RequestContext }) {
  const canRun = can(ctx, "payroll.run", "all");
  const [rows, lookups] = await Promise.all([listLoans(ctx), canRun ? payrollLookups(ctx) : null]);
  const [y, m] = todayIn().split("-").map(Number);
  return (
    <Reveal className="space-y-4">
      {canRun && lookups ? (
        <div className="flex justify-end">
          <LoanDialog employees={lookups.employees} defaults={{ year: y, month: m }} />
        </div>
      ) : null}
      {rows.length ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Employee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Installment</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead>From</TableHead>
                <TableHead className="pr-4">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ l, name, code }) => (
                <TableRow key={l.id}>
                  <TableCell className="pl-4">
                    {name} <span className="text-xs text-muted-foreground">{code}</span>
                  </TableCell>
                  <TableCell>{l.kind === "loan" ? "Loan" : "Salary advance"}</TableCell>
                  <TableCell className="text-right tabular">{formatMoney(l.principal)}</TableCell>
                  <TableCell className="text-right tabular">{formatMoney(l.monthlyInstallment)}</TableCell>
                  <TableCell className="text-right tabular">{formatMoney(l.outstanding)}</TableCell>
                  <TableCell>
                    {MONTHS[l.startPeriodMonth - 1]} {l.startPeriodYear}
                  </TableCell>
                  <TableCell className="pr-4">
                    <StatusBadge status={l.status} tone={l.status === "active" ? "info" : "neutral"} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState icon={HandCoins} title="No loans or advances" description="Recorded loans are recovered automatically in each regular run." />
      )}
    </Reveal>
  );
}
