import { unstable_rethrow } from "next/navigation";
import { HeartPulse, UserRound } from "lucide-react";
import { EmptyState, ErrorState, Reveal } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import type { RequestContext } from "@/server/auth/context";
import { logger } from "@/server/lib/logger";
import { myBenefits } from "@/server/services/benefits/plans";
import { BENEFIT_KIND_LABELS, COVERAGE_LABELS, type BenefitKind, type CoverageOption } from "@/lib/validation/expenses";
import { formatDate, formatMoney } from "@/lib/format";
import { EnrollDialog, WaiveButton } from "./enroll-controls";

export async function MyBenefits({ ctx }: { ctx: RequestContext }) {
  if (!ctx.employeeId) {
    return <EmptyState icon={UserRound} title="Your login is not linked to an employee record" description="Benefits are offered against your employee profile. Ask HR to link your account." />;
  }
  let data: Awaited<ReturnType<typeof myBenefits>>;
  try {
    data = await myBenefits(ctx);
  } catch (err) {
    unstable_rethrow(err);
    logger.error("benefits.mine_failed", { err });
    return <ErrorState title="Could not load your benefits" />;
  }
  if (!data.plans.length) {
    return <EmptyState icon={HeartPulse} title="No benefit plans available to you" description="Plans you are eligible for appear here when HR opens enrollment." />;
  }
  return (
    <Reveal className="grid gap-4 md:grid-cols-2">
      {data.plans.map((p) => {
        const status = p.current?.status;
        const windowText =
          p.window === "open"
            ? p.enrollmentClosesOn
              ? `Enrollment open until ${formatDate(p.enrollmentClosesOn)}`
              : "Enrollment open"
            : p.window === "not_open"
              ? `Enrollment opens ${formatDate(p.enrollmentOpensOn)}`
              : `Enrollment closed on ${formatDate(p.enrollmentClosesOn)}`;
        return (
          <article key={p.id} className="flex flex-col rounded-xl border bg-card p-5">
            <header className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">
                  {BENEFIT_KIND_LABELS[p.kind as BenefitKind] ?? p.kind}
                  {p.provider ? ` · ${p.provider}` : ""}
                </p>
                <h3 className="mt-0.5 font-semibold">{p.name}</h3>
              </div>
              {status ? (
                <StatusBadge status={status} tone={status === "enrolled" ? "success" : "neutral"} />
              ) : (
                <StatusBadge status="not_chosen" label="Not chosen" tone="neutral" />
              )}
            </header>
            {p.description ? <p className="mt-2 text-sm text-muted-foreground">{p.description}</p> : null}
            <dl className="mt-3 mb-4 grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Company pays</dt>
                <dd className="tabular">{formatMoney(p.employerContribution)} / month</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">You pay</dt>
                <dd className="tabular">
                  {formatMoney(p.employeeContribution)} / month
                  {p.deductFromSalary && p.employeeContribution ? <span className="block text-xs text-muted-foreground">Deducted from salary</span> : null}
                </dd>
              </div>
              {p.current?.status === "enrolled" ? (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">Your coverage</dt>
                  <dd>
                    {COVERAGE_LABELS[p.current.coverage as CoverageOption] ?? p.current.coverage}
                    {p.current.dependentIds.length ? ` · ${p.current.dependentIds.length} dependent(s)` : ""} · since {formatDate(p.current.effectiveFrom)}
                  </dd>
                </div>
              ) : null}
            </dl>
            <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <span className="text-xs text-muted-foreground">{windowText}</span>
              {p.window === "open" ? (
                <span className="flex gap-1">
                  {status !== "waived" ? <WaiveButton planId={p.id} planName={p.name} /> : null}
                  <EnrollDialog planId={p.id} planName={p.name} coverageOptions={p.coverageOptions} dependents={data.dependents} current={p.current} />
                </span>
              ) : null}
            </footer>
          </article>
        );
      })}
    </Reveal>
  );
}
