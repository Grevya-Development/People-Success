import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { NoAccess, Page, PageHeader, Reveal, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LinkTabs } from "@/components/documents/link-tabs";
import { can, requireContext, type RequestContext } from "@/server/auth/context";
import { canManageOffers, canManageRecruitment, canSeeOffers, canViewRecruitment } from "@/server/services/recruitment/shared";
import { AnalyticsTab, CandidatesTab, InterviewsTab, OffersTab, OpeningsTab, RequisitionsTab, SettingsTab } from "./_components/tabs";

export const metadata: Metadata = { title: "Recruitment" };

type TabKey = "requisitions" | "openings" | "candidates" | "interviews" | "offers" | "analytics" | "settings";

function tabsFor(ctx: RequestContext): { key: TabKey; label: string }[] {
  const view = canViewRecruitment(ctx);
  const tabs: { key: TabKey; label: string; show: boolean }[] = [
    { key: "openings", label: "Jobs", show: view },
    { key: "candidates", label: "Candidates", show: view },
    { key: "requisitions", label: "Requisitions", show: view || can(ctx, "requisitions.create", "all") || can(ctx, "requisitions.approve", "all") },
    { key: "interviews", label: "Interviews", show: view || can(ctx, "interviews.feedback", "all") },
    { key: "offers", label: "Offers", show: canSeeOffers(ctx) },
    { key: "analytics", label: "Analytics", show: view },
    { key: "settings", label: "Settings", show: canManageRecruitment(ctx) },
  ];
  return tabs.filter((t) => t.show);
}

export default function RecruitmentPage({ searchParams }: PageProps<"/recruitment">) {
  return (
    <Page>
      <PageHeader
        title="Recruitment"
        description="Requisitions, jobs, candidates, interviews and offers — from approved headcount to day one."
        actions={
          <Suspense fallback={<Skeleton className="h-8 w-40" />}>
            <HeaderActions />
          </Suspense>
        }
      />
      <Suspense fallback={<TableSkeleton rows={6} columns={5} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function HeaderActions() {
  const ctx = await requireContext();
  return (
    <>
      {can(ctx, "requisitions.create", "all") ? (
        <Button size="sm" variant="outline" asChild>
          <Link href="/recruitment/requisitions/new">
            <Plus /> Requisition
          </Link>
        </Button>
      ) : null}
      {canManageRecruitment(ctx) ? (
        <Button size="sm" asChild>
          <Link href="/recruitment/openings/new">
            <Plus /> New job
          </Link>
        </Button>
      ) : null}
      {!canManageRecruitment(ctx) && canManageOffers(ctx) ? (
        <Button size="sm" asChild>
          <Link href="/recruitment/offers/new">
            <Plus /> New offer
          </Link>
        </Button>
      ) : null}
    </>
  );
}

async function Body({ searchParams }: { searchParams: PageProps<"/recruitment">["searchParams"] }) {
  const ctx = await requireContext();
  const tabs = tabsFor(ctx);
  if (!tabs.length) return <NoAccess message="Recruitment is available to recruiters, hiring managers and interviewers." />;
  const sp = await searchParams;
  const requested = typeof sp.tab === "string" ? sp.tab : "";
  const active = (tabs.find((t) => t.key === requested) ?? tabs[0]).key;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  return (
    <>
      <LinkTabs label="Recruitment sections" active={active} tabs={tabs.map((t) => ({ key: t.key, label: t.label, href: `/recruitment?tab=${t.key}` }))} />
      <Reveal key={active}>
        {active === "requisitions" ? <RequisitionsTab ctx={ctx} status={str("status")} /> : null}
        {active === "openings" ? <OpeningsTab ctx={ctx} /> : null}
        {active === "candidates" ? <CandidatesTab ctx={ctx} params={{ q: str("q"), source: str("source"), tag: str("tag"), poolId: str("pool"), page: str("page") }} /> : null}
        {active === "interviews" ? <InterviewsTab ctx={ctx} /> : null}
        {active === "offers" ? <OffersTab ctx={ctx} status={str("status")} /> : null}
        {active === "analytics" ? <AnalyticsTab ctx={ctx} openingId={str("opening")} /> : null}
        {active === "settings" ? <SettingsTab ctx={ctx} /> : null}
      </Reveal>
    </>
  );
}
