import { unstable_rethrow } from "next/navigation";
import { HeartPulse } from "lucide-react";
import { EmptyState, ErrorState, NoAccess, Reveal, Section } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RequestContext } from "@/server/auth/context";
import { logger } from "@/server/lib/logger";
import { canManageBenefits, eligibilityOptions, listBenefitPlans, windowState } from "@/server/services/benefits/plans";
import { BENEFIT_KIND_LABELS, type BenefitKind } from "@/lib/validation/expenses";
import { formatDate, formatMoney } from "@/lib/format";
import { PlanDialog } from "./plan-dialog";
import { Stat, StatStrip } from "./shared";

export async function ManageBenefits({ ctx }: { ctx: RequestContext }) {
  if (!canManageBenefits(ctx)) return <NoAccess />;
  let data;
  try {
    data = await Promise.all([listBenefitPlans(ctx), eligibilityOptions(ctx)]);
  } catch (err) {
    unstable_rethrow(err);
    logger.error("benefits.manage_failed", { err });
    return <ErrorState title="Could not load benefit plans" />;
  }
  const [plans, options] = data;
  if (!plans.length) {
    return (
      <EmptyState
        icon={HeartPulse}
        title="No benefit plans yet"
        description="Add group health or life insurance, NPS, meal cards or wellness plans. Set eligibility, contributions and an enrollment window."
        action={<PlanDialog options={options} />}
      />
    );
  }
  const totalEmployer = plans.reduce((s, p) => s + p.monthlyEmployerCost, 0);
  const totalDeductions = plans.reduce((s, p) => s + p.monthlyEmployeeDeductions, 0);
  const enrolled = plans.reduce((s, p) => s + p.enrolled, 0);
  return (
    <Reveal className="space-y-5">
      <StatStrip>
        <Stat label="Active plans" value={plans.filter((p) => p.isActive).length} />
        <Stat label="Current enrollments" value={enrolled} />
        <Stat label="Employer cost / month" value={formatMoney(totalEmployer, "INR", { compact: true })} />
        <Stat label="Salary deductions / month" value={formatMoney(totalDeductions, "INR", { compact: true })} hint="Posted to open payroll periods daily" />
      </StatStrip>
      <Section title="Plans" actions={<PlanDialog options={options} />}>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">Plan</TableHead>
              <TableHead>Window</TableHead>
              <TableHead className="text-right">Enrolled</TableHead>
              <TableHead className="text-right">Waived</TableHead>
              <TableHead className="text-right">Employer / month</TableHead>
              <TableHead className="hidden text-right md:table-cell">Employee / month</TableHead>
              <TableHead className="w-12 pr-5" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.map((p) => {
              const w = windowState(p);
              return (
                <TableRow key={p.id}>
                  <TableCell className="pl-5">
                    <span className="font-medium">{p.name}</span>
                    {!p.isActive ? <StatusBadge status="inactive" tone="neutral" className="ml-2" /> : null}
                    <p className="text-xs text-muted-foreground">
                      {BENEFIT_KIND_LABELS[p.kind as BenefitKind] ?? p.kind}
                      {p.provider ? ` · ${p.provider}` : ""}
                      {Object.keys(p.eligibility).length ? " · restricted eligibility" : " · everyone"}
                    </p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <StatusBadge status={w} tone={w === "open" ? "success" : "neutral"} label={w === "open" ? "Open" : w === "not_open" ? "Not open" : "Closed"} />
                    <span className="ml-2 hidden text-xs lg:inline">
                      {p.enrollmentOpensOn || p.enrollmentClosesOn ? `${formatDate(p.enrollmentOpensOn)} – ${formatDate(p.enrollmentClosesOn)}` : "Always"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular">{p.enrolled}</TableCell>
                  <TableCell className="text-right tabular">{p.waived}</TableCell>
                  <TableCell className="text-right tabular">{formatMoney(p.monthlyEmployerCost)}</TableCell>
                  <TableCell className="hidden text-right tabular md:table-cell">
                    {formatMoney(p.employeeContribution)}
                    {p.deductFromSalary ? <span className="block text-xs text-muted-foreground">from salary</span> : null}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <PlanDialog plan={p} options={options} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Section>
    </Reveal>
  );
}
