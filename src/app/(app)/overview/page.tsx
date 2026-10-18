import type { Metadata } from "next";
import { Suspense } from "react";
import { Page, PageHeader, StatGridSkeleton } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { OverviewContent, OverviewGreeting } from "./overview-content";
import { Insights } from "./insights";
import { Panels } from "./panels";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage({ searchParams }: PageProps<"/overview">) {
  return (
    <Page>
      <Suspense fallback={<PageHeader title={<Skeleton className="h-7 w-56" />} />}>
        <OverviewGreeting />
      </Suspense>
      <div className="space-y-8">
        <Suspense fallback={<StatGridSkeleton />}>
          <OverviewContent />
        </Suspense>
        <Suspense fallback={<StatGridSkeleton count={4} />}>
          <Panels />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-[520px] rounded-xl" />}>
          <Insights searchParams={searchParams} />
        </Suspense>
      </div>
    </Page>
  );
}
