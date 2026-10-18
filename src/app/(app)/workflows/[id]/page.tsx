import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { NoAccess, Page, PageHeader } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { can, requireContext } from "@/server/auth/context";
import { employeeFormLookups } from "@/server/services/employees/lookups";
import { getWorkflow } from "@/server/services/workflows/definitions";
import { WORKFLOW_ACTIONS, WORKFLOW_TRIGGERS } from "@/server/services/workflows/catalog";
import { AppError } from "@/server/lib/errors";
import { WorkflowBuilder } from "../workflow-builder";
import { ActiveToggle } from "../workflow-controls";

export const metadata: Metadata = { title: "Workflow" };

export default function WorkflowPage({ params }: PageProps<"/workflows/[id]">) {
  return (
    <Page width="narrow">
      <Suspense fallback={<Skeleton className="h-[640px] rounded-xl" />}>
        <Loader params={params} />
      </Suspense>
    </Page>
  );
}

async function Loader({ params }: { params: PageProps<"/workflows/[id]">["params"] }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!can(ctx, "workflows.manage", "all")) return <NoAccess />;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let wf: Awaited<ReturnType<typeof getWorkflow>>;
  try {
    wf = await getWorkflow(ctx, id);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const lookups = await employeeFormLookups(ctx);
  return (
    <>
      <PageHeader
        title={wf.def.name}
        eyebrow={<StatusBadge status={wf.def.isActive ? "active" : "draft"} label={wf.def.isActive ? "Active" : "Inactive"} />}
        description={`Version ${wf.def.currentVersion} · ${wf.versions.length} version${wf.versions.length === 1 ? "" : "s"}`}
        actions={
          <label className="flex items-center gap-2 text-sm">
            Active <ActiveToggle id={wf.def.id} active={wf.def.isActive} />
          </label>
        }
      />
      <WorkflowBuilder
        initial={{ id: wf.def.id, name: wf.def.name, description: wf.def.description, trigger: wf.def.trigger, conditions: wf.def.conditions, steps: wf.steps }}
        triggers={WORKFLOW_TRIGGERS}
        actions={WORKFLOW_ACTIONS}
        departments={lookups.departments}
        locations={lookups.locations}
      />
    </>
  );
}
