import type { Metadata } from "next";
import { Suspense, cache } from "react";
import { notFound } from "next/navigation";
import { Page, NoAccess } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { requireContext } from "@/server/auth/context";
import { getEmployeeHeader } from "@/server/services/employees/queries";
import { employeeFormLookups } from "@/server/services/employees/lookups";
import { AppError } from "@/server/lib/errors";
import { todayIn } from "@/lib/format";
import { ProfileHeader } from "./profile-header";
import { ProfileTabs, tabsFor, type TabKey } from "./profile-tabs";
import { TabContent } from "./tab-content";

export const metadata: Metadata = { title: "Employee" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const loadHeader = cache(async (id: string) => {
  const ctx = await requireContext();
  if (!UUID.test(id)) notFound();
  try {
    return { ctx, header: await getEmployeeHeader(ctx, id) };
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    if (err instanceof AppError && err.code === "FORBIDDEN") return { ctx, header: null };
    throw err;
  }
});

export default function EmployeeProfilePage({ params, searchParams }: PageProps<"/employees/[id]">) {
  return (
    <Page>
      <Suspense fallback={<HeaderSkeleton />}>
        <Header params={params} />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <Body params={params} searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

function HeaderSkeleton() {
  return (
    <div className="mb-6 flex items-center gap-4">
      <Skeleton className="size-14 rounded-full" />
      <div className="space-y-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
    </div>
  );
}

async function Header({ params }: { params: PageProps<"/employees/[id]">["params"] }) {
  const { id } = await params;
  const { ctx, header } = await loadHeader(id);
  if (!header) return null;
  const needsLookups = header.access.canEditAll;
  const lookups = needsLookups ? await employeeFormLookups(ctx) : null;
  return <ProfileHeader header={header} lookups={lookups} today={todayIn()} canCreate={!!ctx.grants["employees.create"]} canDelete={!!ctx.grants["employees.delete"]} />;
}

async function Body({ params, searchParams }: { params: PageProps<"/employees/[id]">["params"]; searchParams: PageProps<"/employees/[id]">["searchParams"] }) {
  const { id } = await params;
  const { ctx, header } = await loadHeader(id);
  if (!header) return <NoAccess message="You do not have access to this employee's profile." />;
  const sp = await searchParams;
  const tabs = tabsFor(header.access);
  const requested = (typeof sp.tab === "string" ? sp.tab : "overview") as TabKey;
  const tab = tabs.some((t) => t.key === requested) ? requested : "overview";
  return (
    <>
      <ProfileTabs tabs={tabs} active={tab} />
      <div className="mt-5 animate-enter" key={tab}>
        <TabContent ctx={ctx} header={header} tab={tab} />
      </div>
    </>
  );
}
