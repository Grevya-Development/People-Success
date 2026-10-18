import type { Metadata } from "next";
import { Suspense } from "react";
import { EmptyState, NoAccess, Page, PageHeader } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { requireContext } from "@/server/auth/context";
import { recruitmentLookups } from "@/server/services/recruitment/lookups";
import { applicationsReadyForOffer } from "@/server/services/recruitment/applications";
import { offerDefaults } from "@/server/services/recruitment/offers";
import { canManageOffers } from "@/server/services/recruitment/shared";
import { AppError } from "@/server/lib/errors";
import { todayIn } from "@/lib/format";
import { OfferForm } from "../../_components/offer-form";

export const metadata: Metadata = { title: "New offer" };

const plusDays = (n: number) => {
  const d = new Date(`${todayIn()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export default function NewOfferPage({ searchParams }: PageProps<"/recruitment/offers/new">) {
  return (
    <Page width="narrow">
      <PageHeader eyebrow="Recruitment" title="Create an offer" description="Drafts go to HR and finance for approval. The letter is generated on approval; you send it when ready." />
      <Suspense fallback={<Skeleton className="h-[560px] w-full rounded-xl" />}>
        <FormLoader searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function FormLoader({ searchParams }: { searchParams: PageProps<"/recruitment/offers/new">["searchParams"] }) {
  const ctx = await requireContext();
  if (!canManageOffers(ctx)) return <NoAccess message="Creating offers needs the “Create and send offers” permission." />;
  const sp = await searchParams;
  const appId = typeof sp.application === "string" && /^[0-9a-f-]{36}$/i.test(sp.application) ? sp.application : null;
  const [lookups, applications] = await Promise.all([recruitmentLookups(ctx), applicationsReadyForOffer(ctx)]);
  let defaults = null;
  if (appId) {
    try {
      defaults = await offerDefaults(ctx, appId);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
    }
  }
  if (!applications.length && !defaults?.atOfferStage) {
    return <EmptyState title="No candidates at the Offer stage" description="Move a candidate to the Offer stage on the job's board, then create their offer here." />;
  }
  return (
    <OfferForm
      lookups={lookups}
      applications={applications}
      initial={{
        applicationId: defaults?.atOfferStage ? appId! : "",
        departmentId: defaults?.departmentId ?? null,
        locationId: defaults?.locationId ?? null,
        designationId: defaults?.designationId ?? null,
        legalEntityId: defaults?.legalEntityId ?? lookups.defaultLegalEntityId ?? undefined,
        reportingManagerId: defaults?.reportingManagerId ?? null,
        employmentType: defaults?.employmentType ?? "full_time",
        joiningDate: plusDays(30),
        expiresOn: plusDays(7),
      }}
    />
  );
}
