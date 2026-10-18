import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, unstable_rethrow } from "next/navigation";
import { Archive, ArrowLeft } from "lucide-react";
import { EmptyState, ErrorState, NoAccess, Page, PageHeader, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { canManagePolicies, getPolicy } from "@/server/services/documents/policies";
import { companyDocumentOptions } from "@/server/services/documents/documents";
import { PolicyForm } from "@/components/documents/policy-form";
import { todayIn } from "@/lib/format";
import { POLICY_CATEGORIES } from "@/lib/validation/documents";

export const metadata: Metadata = { title: "Edit policy" };

export default function EditPolicyPage({ params }: PageProps<"/documents/policies/[id]/edit">) {
  return (
    <Page width="narrow">
      <Suspense fallback={<TableSkeleton rows={6} columns={1} />}>
        <EditPolicy params={params} />
      </Suspense>
    </Page>
  );
}

async function EditPolicy({ params }: { params: PageProps<"/documents/policies/[id]/edit">["params"] }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!canManagePolicies(ctx)) return <NoAccess message="Only policy managers can edit policies." />;
  let data;
  try {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    const [policy, documentOptions] = await Promise.all([getPolicy(ctx, id), companyDocumentOptions(ctx)]);
    data = { policy, documentOptions };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    logger.error("documents.policy_edit_load_failed", { err });
    return <ErrorState title="Could not load this policy" />;
  }
  const { policy, documentOptions } = data;
  const category = (POLICY_CATEGORIES as readonly string[]).includes(policy.category) ? (policy.category as (typeof POLICY_CATEGORIES)[number]) : "other";

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href={`/documents/policies/${policy.id}`}>
          <ArrowLeft data-icon="inline-start" /> {policy.title}
        </Link>
      </Button>
      <PageHeader title="Edit policy" description={`Version ${policy.version} · ${policy.status}`} />
      {policy.status === "archived" ? (
        <EmptyState icon={Archive} title="This policy is archived" description="Restore it from the policy page before editing." />
      ) : (
        <PolicyForm
          policy={{
            id: policy.id,
            status: policy.status,
            version: policy.version,
            title: policy.title,
            category,
            summary: policy.summary,
            body: policy.body,
            effectiveFrom: policy.effectiveFrom,
            requiresAcknowledgement: policy.requiresAcknowledgement,
            documentId: policy.documentId,
          }}
          documentOptions={documentOptions}
          today={todayIn()}
        />
      )}
    </>
  );
}
