import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, unstable_rethrow } from "next/navigation";
import { ArrowLeft, CheckCircle2, Paperclip, Users } from "lucide-react";
import { EmptyState, ErrorState, Page, PageHeader, Reveal, Section, TableSkeleton } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext, type RequestContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { canManagePolicies, getPolicy, pendingAcknowledgements, type PolicyDetail } from "@/server/services/documents/policies";
import { Markdown } from "@/components/documents/markdown";
import { CoverageBar } from "@/components/documents/policies-list";
import { AcknowledgePolicy, PolicyManageActions } from "@/components/documents/policy-actions";
import { formatDate, formatDateTime } from "@/lib/format";
import { POLICY_CATEGORY_LABELS } from "@/lib/validation/documents";

export const metadata: Metadata = { title: "Policy" };

export default function PolicyPage({ params }: PageProps<"/documents/policies/[id]">) {
  return (
    <Page width="narrow">
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/documents?tab=policies">
          <ArrowLeft data-icon="inline-start" /> Policies
        </Link>
      </Button>
      <Suspense
        fallback={
          <>
            <PageHeader title={<Skeleton className="h-7 w-72" />} />
            <TableSkeleton rows={6} columns={1} />
          </>
        }
      >
        <PolicyContent params={params} />
      </Suspense>
    </Page>
  );
}

async function PolicyContent({ params }: { params: PageProps<"/documents/policies/[id]">["params"] }) {
  const { id } = await params;
  const ctx = await requireContext();
  let policy: PolicyDetail;
  try {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    policy = await getPolicy(ctx, id);
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    logger.error("documents.policy_load_failed", { err });
    return <ErrorState title="Could not load this policy" />;
  }
  const manage = canManagePolicies(ctx);
  const category = POLICY_CATEGORY_LABELS[policy.category as keyof typeof POLICY_CATEGORY_LABELS] ?? policy.category;

  return (
    <Reveal className="space-y-5">
      <PageHeader
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-2">
            {category} · Version {policy.version}
            {manage ? <StatusBadge status={policy.status} /> : null}
          </span>
        }
        title={policy.title}
        description={policy.summary ?? undefined}
        actions={
          manage ? (
            <PolicyManageActions
              id={policy.id}
              status={policy.status}
              canDelete={policy.status === "draft" && !policy.publishedAt}
              requiresAcknowledgement={policy.requiresAcknowledgement}
            />
          ) : null
        }
        className="mb-0"
      />
      <p className="text-xs text-muted-foreground">
        Effective {formatDate(policy.effectiveFrom)}
        {policy.publishedAt ? ` · Published ${formatDate(policy.publishedAt)}` : " · Not published yet"}
      </p>

      {policy.requiresAcknowledgement && policy.status === "published" ? (
        policy.myAcknowledgedAt ? (
          <p className="flex items-center gap-2 rounded-lg border border-success/20 bg-success-soft px-4 py-2.5 text-sm text-success">
            <CheckCircle2 className="size-4" /> You acknowledged version {policy.version} on {formatDateTime(policy.myAcknowledgedAt)}.
          </p>
        ) : policy.canAcknowledge ? (
          <section className="rounded-xl border border-warning/30 bg-warning-soft/40 p-4">
            <AcknowledgePolicy id={policy.id} version={policy.version} />
          </section>
        ) : null
      ) : null}

      <Section>
        <article className="px-5 py-5 sm:px-7 sm:py-6">
          <Markdown source={policy.body} />
        </article>
        {policy.document ? (
          <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-sm">
            <span className="inline-flex min-w-0 items-center gap-2">
              <Paperclip className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{policy.document.title}</span>
            </span>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/documents/${policy.document.id}/download`}>Download</a>
            </Button>
          </div>
        ) : null}
      </Section>

      {manage && policy.status === "published" && policy.requiresAcknowledgement && policy.coverage ? (
        <Section
          title="Acknowledgements"
          description={`Active employees who acknowledged version ${policy.version}.`}
          actions={<CoverageBar {...policy.coverage} />}
        >
          <Suspense fallback={<div className="p-5"><TableSkeleton rows={4} columns={3} /></div>}>
            <PendingList ctx={ctx} policyId={policy.id} />
          </Suspense>
        </Section>
      ) : null}
    </Reveal>
  );
}

async function PendingList({ ctx, policyId }: { ctx: RequestContext; policyId: string }) {
  let rows;
  try {
    rows = await pendingAcknowledgements(ctx, policyId);
  } catch (err) {
    unstable_rethrow(err);
    logger.error("documents.policy_pending_failed", { err });
    return <ErrorState title="Could not load pending employees" />;
  }
  if (!rows.length) {
    return (
      <div className="p-5">
        <EmptyState icon={Users} title="Everyone has acknowledged" description="All active employees have acknowledged the current version." className="border-0" />
      </div>
    );
  }
  const shown = rows.slice(0, 200);
  return (
    <>
      <h3 className="px-5 pt-3 text-xs font-medium text-muted-foreground">Pending ({rows.length})</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Employee</TableHead>
            <TableHead>Code</TableHead>
            <TableHead className="pr-5">Department</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((r) => (
            <TableRow key={r.employeeId}>
              <TableCell className="pl-5">
                <Link href={`/employees/${r.employeeId}`} className="hover:underline">
                  {r.name}
                </Link>
              </TableCell>
              <TableCell className="tabular text-muted-foreground">{r.employeeCode}</TableCell>
              <TableCell className="pr-5 text-muted-foreground">{r.department ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > shown.length ? (
        <p className="border-t px-5 py-2.5 text-xs text-muted-foreground">Showing the first {shown.length} of {rows.length} pending employees.</p>
      ) : null}
    </>
  );
}
