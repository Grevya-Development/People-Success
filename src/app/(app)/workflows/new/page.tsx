import type { Metadata } from "next";
import { Suspense } from "react";
import { NoAccess, Page, PageHeader } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { can, requireContext } from "@/server/auth/context";
import { employeeFormLookups } from "@/server/services/employees/lookups";
import { WORKFLOW_ACTIONS, WORKFLOW_TRIGGERS } from "@/server/services/workflows/catalog";
import { WorkflowBuilder } from "../workflow-builder";

export const metadata: Metadata = { title: "New workflow" };

export default function NewWorkflowPage() {
  return (
    <Page width="narrow">
      <PageHeader title="New workflow" description="Workflows start inactive. Turn them on from the list when you are ready." />
      <Suspense fallback={<Skeleton className="h-[560px] rounded-xl" />}>
        <Loader />
      </Suspense>
    </Page>
  );
}

async function Loader() {
  const ctx = await requireContext();
  if (!can(ctx, "workflows.manage", "all")) return <NoAccess />;
  const lookups = await employeeFormLookups(ctx);
  return <WorkflowBuilder triggers={WORKFLOW_TRIGGERS} actions={WORKFLOW_ACTIONS} departments={lookups.departments} locations={lookups.locations} />;
}
