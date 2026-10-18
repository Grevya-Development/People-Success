import type { Metadata } from "next";
import { Suspense } from "react";
import { NoAccess, Page, PageHeader, StatGridSkeleton, TableSkeleton } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { can, requireContext, type RequestContext } from "@/server/auth/context";
import { LinkTabs, type LinkTab } from "@/components/documents/link-tabs";
import { DepartmentsSection, InsightsSection, OrgChartSection, PositionsSection } from "@/components/organization/org-sections";

export const metadata: Metadata = { title: "Organization" };

type TabKey = "chart" | "departments" | "positions" | "insights";

const TABS: (LinkTab & { key: TabKey })[] = [
  { key: "chart", label: "Org chart", href: "/organization?tab=chart" },
  { key: "departments", label: "Departments", href: "/organization?tab=departments" },
  { key: "positions", label: "Positions", href: "/organization?tab=positions" },
  { key: "insights", label: "Insights", href: "/organization?tab=insights" },
];

export default function OrganizationPage({ searchParams }: PageProps<"/organization">) {
  return (
    <Page>
      <PageHeader title="Organization" description="Reporting structure, departments, positions and workforce planning." />
      <Suspense
        fallback={
          <>
            <div className="mb-5 flex gap-2 border-b pb-2">
              {TABS.map((t) => (
                <Skeleton key={t.key} className="h-6 w-24" />
              ))}
            </div>
            <TableSkeleton rows={8} columns={3} />
          </>
        }
      >
        <OrganizationContent searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function OrganizationContent({ searchParams }: { searchParams: PageProps<"/organization">["searchParams"] }) {
  const ctx = await requireContext();
  if (!can(ctx, "org.view")) return <NoAccess />;
  const sp = await searchParams;
  const active = (TABS.find((t) => t.key === sp.tab)?.key ?? "chart") as TabKey;

  return (
    <>
      <LinkTabs tabs={TABS} active={active} label="Organization sections" />
      <Suspense key={active} fallback={active === "insights" ? <StatGridSkeleton /> : <TableSkeleton rows={8} columns={active === "chart" ? 2 : 5} />}>
        <TabBody tab={active} ctx={ctx} />
      </Suspense>
    </>
  );
}

function TabBody({ tab, ctx }: { tab: TabKey; ctx: RequestContext }) {
  switch (tab) {
    case "chart":
      return <OrgChartSection ctx={ctx} />;
    case "departments":
      return <DepartmentsSection ctx={ctx} />;
    case "positions":
      return <PositionsSection ctx={ctx} />;
    case "insights":
      return <InsightsSection ctx={ctx} />;
  }
}
