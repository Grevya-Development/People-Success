import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { CheckCircle2, ChevronRight, Plus, ScrollText } from "lucide-react";
import { EmptyState, ErrorState, Reveal, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import type { RequestContext } from "@/server/auth/context";
import { canManagePolicies, listPolicies } from "@/server/services/documents/policies";
import { logger } from "@/server/lib/logger";
import { formatDate, formatPercent } from "@/lib/format";
import { POLICY_CATEGORY_LABELS } from "@/lib/validation/documents";

const categoryLabel = (c: string) => POLICY_CATEGORY_LABELS[c as keyof typeof POLICY_CATEGORY_LABELS] ?? c;

export function CoverageBar({ acknowledged, total }: { acknowledged: number; total: number }) {
  const ratio = total ? acknowledged / total : 0;
  return (
    <div className="flex min-w-36 items-center gap-2">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Acknowledgement coverage"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={acknowledged}
      >
        <div className={ratio >= 1 ? "h-full rounded-full bg-success" : "h-full rounded-full bg-brand"} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      <span className="tabular text-xs whitespace-nowrap text-muted-foreground">
        {acknowledged}/{total} · {formatPercent(total ? ratio : null)}
      </span>
    </div>
  );
}

export async function PoliciesList({ ctx }: { ctx: RequestContext }) {
  let policies;
  try {
    policies = await listPolicies(ctx);
  } catch (err) {
    unstable_rethrow(err);
    logger.error("documents.policies_list_failed", { err });
    return <ErrorState title="Could not load policies" />;
  }
  const manage = canManagePolicies(ctx);
  const pendingMine = policies.filter((p) => p.status === "published" && p.requiresAcknowledgement && !p.myAcknowledgedAt).length;

  return (
    <Reveal className="space-y-4">
      {!manage && ctx.employeeId && pendingMine ? (
        <p className="rounded-lg border border-warning/20 bg-warning-soft px-4 py-2.5 text-sm text-warning">
          {pendingMine} {pendingMine === 1 ? "policy needs" : "policies need"} your acknowledgement.
        </p>
      ) : null}
      <Section
        title="Policies"
        description={manage ? "Draft, publish and track acknowledgement of company policies." : "Company policies that apply to you."}
        actions={
          manage ? (
            <Button asChild size="sm">
              <Link href="/documents/policies/new">
                <Plus data-icon="inline-start" /> New policy
              </Link>
            </Button>
          ) : null
        }
      >
        {policies.length ? (
          <ul className="divide-y">
            {policies.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/documents/policies/${p.id}`}
                  className="group flex flex-col gap-2 px-5 py-3.5 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{p.title}</span>
                      {manage ? <StatusBadge status={p.status} /> : null}
                      <span className="text-xs text-muted-foreground">
                        {categoryLabel(p.category)} · v{p.version} · Effective {formatDate(p.effectiveFrom)}
                      </span>
                    </div>
                    {p.summary ? <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{p.summary}</p> : null}
                  </div>
                  <div className="flex items-center gap-3 sm:justify-end">
                    {manage && p.coverage && p.requiresAcknowledgement ? <CoverageBar {...p.coverage} /> : null}
                    {manage && p.status === "published" && !p.requiresAcknowledgement ? (
                      <span className="text-xs text-muted-foreground">No acknowledgement needed</span>
                    ) : null}
                    {!manage && p.requiresAcknowledgement ? (
                      p.myAcknowledgedAt ? (
                        <span className="inline-flex items-center gap-1 text-xs text-success">
                          <CheckCircle2 className="size-3.5" /> Acknowledged {formatDate(p.myAcknowledgedAt)}
                        </span>
                      ) : ctx.employeeId ? (
                        <StatusBadge status="pending" label="Needs acknowledgement" className="normal-case" />
                      ) : null
                    ) : null}
                    <ChevronRight className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" aria-hidden />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={ScrollText}
              title={manage ? "No policies yet" : "No policies published"}
              description={manage ? "Write your first policy, such as a code of conduct or leave policy, and publish it for employees." : "Published company policies will appear here."}
              className="border-0"
              action={
                manage ? (
                  <Button asChild size="sm">
                    <Link href="/documents/policies/new">
                      <Plus data-icon="inline-start" /> New policy
                    </Link>
                  </Button>
                ) : null
              }
            />
          </div>
        )}
      </Section>
    </Reveal>
  );
}
