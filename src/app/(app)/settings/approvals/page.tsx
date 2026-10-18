import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { NoAccess, PageHeader, Reveal, Section } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireContext } from "@/server/auth/context";
import { canManagePolicies, listApprovalPolicies } from "@/server/services/settings/approval-policies";
import { roleOptions, memberOptions } from "@/server/services/settings/lookups";
import { APPROVER_LABELS, CONDITION_OP_LABELS, conditionsFromJson } from "@/lib/validation/settings";
import type { ApprovalStepDefinition } from "@/server/db/schema/platform";
import { ConfirmAction } from "../_components/run-action";
import { setApprovalPolicyActiveAction } from "./actions";

export const metadata: Metadata = { title: "Approval policies" };

export default function ApprovalsPage() {
  return (
    <>
      <PageHeader
        title="Approval policies"
        description="For each request type, the active policy with the highest priority whose conditions match is used. Requests already in progress keep the version they started with."
      />
      <Suspense fallback={<PoliciesSkeleton />}>
        <PoliciesData />
      </Suspense>
    </>
  );
}

async function PoliciesData() {
  const ctx = await requireContext();
  if (!canManagePolicies(ctx)) return <NoAccess />;
  const [groups, roles, members] = await Promise.all([
    listApprovalPolicies(ctx),
    ctx.db((tx) => roleOptions(tx, { builtInOnly: true })),
    ctx.db((tx) => memberOptions(tx, ctx.tenantId)),
  ]);
  const roleName = new Map(roles.map((r) => [r.key!, r.name]));
  const userName = new Map(members.map((m) => [m.value, m.label]));
  const approver = (s: ApprovalStepDefinition) =>
    s.approver.kind === "role"
      ? (roleName.get(s.approver.roleKey) ?? s.approver.roleKey)
      : s.approver.kind === "user"
        ? (userName.get(s.approver.userId) ?? "Former member")
        : APPROVER_LABELS[s.approver.kind];

  return (
    <Reveal className="space-y-5">
      {groups.map((g) => (
        <Section
          key={g.subjectType}
          title={g.label}
          description={`${g.policies.filter((p) => p.isActive).length} active polic${g.policies.filter((p) => p.isActive).length === 1 ? "y" : "ies"}`}
          actions={
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/settings/approvals/new?subject=${g.subjectType}`}>
                <Plus /> Add policy
              </Link>
            </Button>
          }
        >
          {g.policies.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">
              No policy. Requests fall back to HR administrators and the owner.
            </p>
          ) : (
            <ul className="divide-y">
              {g.policies.map((p) => {
                const conds = conditionsFromJson(p.conditions);
                return (
                  <li key={p.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/settings/approvals/${p.id}`} className="font-medium underline-offset-4 hover:underline">
                          {p.name}
                        </Link>
                        <StatusBadge status={p.isActive ? "active" : "inactive"} tone={p.isActive ? "success" : "neutral"} />
                        <span className="text-xs text-muted-foreground tabular">
                          Priority {p.priority} · v{p.version}
                        </span>
                      </div>
                      <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                        {p.steps.map((s, i) => (
                          <span key={i} className="inline-flex items-center gap-1">
                            {i > 0 ? <ArrowRight className="size-3" aria-hidden /> : null}
                            <span className="text-foreground">{s.name}</span>
                            <span>({approver(s)})</span>
                          </span>
                        ))}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {conds.length
                          ? `When ${conds.map((c) => `${c.field} ${CONDITION_OP_LABELS[c.op]} ${c.value}`).join(" and ")}`
                          : "Applies to every request (default policy)"}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/settings/approvals/${p.id}`}>Edit</Link>
                      </Button>
                      <ConfirmAction
                        trigger={
                          <Button variant="ghost" size="sm">
                            {p.isActive ? "Deactivate" : "Activate"}
                          </Button>
                        }
                        title={p.isActive ? `Deactivate “${p.name}”?` : `Activate “${p.name}”?`}
                        description={
                          p.isActive
                            ? "New requests will no longer use this policy. Requests already in progress are not affected."
                            : "New matching requests will start using this policy."
                        }
                        confirmLabel={p.isActive ? "Deactivate" : "Activate"}
                        destructive={p.isActive}
                        action={setApprovalPolicyActiveAction}
                        input={{ id: p.id, isActive: !p.isActive }}
                        success={p.isActive ? "Policy deactivated" : "Policy activated"}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      ))}
    </Reveal>
  );
}

function PoliciesSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-28 rounded-xl" />
      ))}
    </div>
  );
}
