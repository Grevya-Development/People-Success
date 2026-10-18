import type { Metadata } from "next";
import { Suspense } from "react";
import { NoAccess, Page, PageHeader } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { requireContext } from "@/server/auth/context";
import { recruitmentLookups } from "@/server/services/recruitment/lookups";
import { approvedRequisitionOptions } from "@/server/services/recruitment/requisitions";
import { openingDefaultsFromRequisition } from "@/server/services/recruitment/openings";
import { canManageRecruitment } from "@/server/services/recruitment/shared";
import { OpeningForm } from "../../_components/opening-form";

export const metadata: Metadata = { title: "New job" };

export default function NewOpeningPage({ searchParams }: PageProps<"/recruitment/openings/new">) {
  return (
    <Page width="narrow">
      <PageHeader eyebrow="Recruitment" title="Create a job" description="Jobs start as drafts. Publish to show them on your careers page and to employees for referrals." />
      <Suspense fallback={<Skeleton className="h-[720px] w-full rounded-xl" />}>
        <FormLoader searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function FormLoader({ searchParams }: { searchParams: PageProps<"/recruitment/openings/new">["searchParams"] }) {
  const ctx = await requireContext();
  if (!canManageRecruitment(ctx)) return <NoAccess message="Creating jobs needs the “Manage jobs and candidates” permission." />;
  const sp = await searchParams;
  const reqId = typeof sp.requisition === "string" && /^[0-9a-f-]{36}$/i.test(sp.requisition) ? sp.requisition : null;
  const [lookups, requisitions, defaults] = await Promise.all([
    recruitmentLookups(ctx),
    approvedRequisitionOptions(ctx),
    reqId ? openingDefaultsFromRequisition(ctx, reqId) : Promise.resolve(null),
  ]);
  return <OpeningForm lookups={lookups} requisitions={requisitions} initial={defaults ?? undefined} />;
}
