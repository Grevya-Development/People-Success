import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { NoAccess, Page, PageHeader, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { requireContext } from "@/server/auth/context";
import { canManageTemplates } from "@/server/services/documents/templates";
import { TemplateForm } from "@/components/documents/template-form";

export const metadata: Metadata = { title: "New template" };

export default function NewTemplatePage() {
  return (
    <Page width="narrow">
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/documents?tab=templates">
          <ArrowLeft data-icon="inline-start" /> Templates
        </Link>
      </Button>
      <PageHeader title="New template" description="Write a letter or email once and reuse it with each employee's details." />
      <Suspense fallback={<TableSkeleton rows={6} columns={1} />}>
        <NewTemplate />
      </Suspense>
    </Page>
  );
}

async function NewTemplate() {
  const ctx = await requireContext();
  if (!canManageTemplates(ctx)) return <NoAccess message="Only template managers can create templates." />;
  return <TemplateForm />;
}
