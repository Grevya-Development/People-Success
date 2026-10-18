import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { NoAccess, Page, PageHeader, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { requireContext } from "@/server/auth/context";
import { canManagePolicies } from "@/server/services/documents/policies";
import { companyDocumentOptions } from "@/server/services/documents/documents";
import { PolicyForm } from "@/components/documents/policy-form";
import { todayIn } from "@/lib/format";

export const metadata: Metadata = { title: "New policy" };

export default function NewPolicyPage() {
  return (
    <Page width="narrow">
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/documents?tab=policies">
          <ArrowLeft data-icon="inline-start" /> Policies
        </Link>
      </Button>
      <PageHeader title="New policy" description="Policies start as drafts. Publish when ready to share with employees." />
      <Suspense fallback={<TableSkeleton rows={6} columns={1} />}>
        <NewPolicy />
      </Suspense>
    </Page>
  );
}

async function NewPolicy() {
  const ctx = await requireContext();
  if (!canManagePolicies(ctx)) return <NoAccess message="Only policy managers can create policies." />;
  const documentOptions = await companyDocumentOptions(ctx);
  return <PolicyForm documentOptions={documentOptions} today={todayIn()} />;
}
