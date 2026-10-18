import type { Metadata } from "next";
import { Suspense } from "react";
import { NoAccess, Page, PageHeader } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { requireContext } from "@/server/auth/context";
import { canManageHelpdesk } from "@/server/services/helpdesk/rules";
import { KbArticleForm } from "../kb-form";

export const metadata: Metadata = { title: "New article" };

export default function NewKbArticlePage() {
  return (
    <Page width="narrow">
      <PageHeader title="New knowledge base article" description="Articles start as drafts. Publishing makes them visible to everyone and searchable by the HR assistant." />
      <Suspense fallback={<Skeleton className="h-[520px] w-full rounded-xl" />}>
        <Gate />
      </Suspense>
    </Page>
  );
}

async function Gate() {
  const ctx = await requireContext();
  if (!canManageHelpdesk(ctx)) return <NoAccess />;
  return <KbArticleForm />;
}
