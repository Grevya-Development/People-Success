import type { Metadata } from "next";
import { Suspense } from "react";
import { NoAccess, Page, PageHeader } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { can, requireContext } from "@/server/auth/context";
import { recruitmentLookups } from "@/server/services/recruitment/lookups";
import { canSeeBudget } from "@/server/services/recruitment/shared";
import { RequisitionForm } from "../../_components/requisition-form";

export const metadata: Metadata = { title: "New requisition" };

export default function NewRequisitionPage() {
  return (
    <Page width="narrow">
      <PageHeader
        eyebrow="Recruitment"
        title="Raise a requisition"
        description="Ask for approved headcount. The hiring manager's department head approves first, then finance."
      />
      <Suspense fallback={<Skeleton className="h-[640px] w-full rounded-xl" />}>
        <FormLoader />
      </Suspense>
    </Page>
  );
}

async function FormLoader() {
  const ctx = await requireContext();
  if (!can(ctx, "requisitions.create", "all")) return <NoAccess message="You need permission to raise job requisitions." />;
  const lookups = await recruitmentLookups(ctx);
  return <RequisitionForm lookups={lookups} canSeeBudget={canSeeBudget(ctx)} defaultHiringManager={ctx.employeeId} />;
}
