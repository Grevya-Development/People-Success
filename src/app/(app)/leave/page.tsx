import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CalendarPlus, Settings2 } from "lucide-react";
import { NoAccess, Page, PageHeader, StatGridSkeleton, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LinkTabs, type LinkTab } from "@/components/documents/link-tabs";
import { can, requireContext, scopeOf, type RequestContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { leaveListSchema } from "@/lib/validation/time";
import { todayIn } from "@/lib/format";
import { isMonth } from "@/app/(app)/attendance/_components/status";
import { MineTab } from "./_components/mine-tab";
import { CalendarTab } from "./_components/calendar-tab";
import { RequestsTab } from "./_components/requests-tab";
import { BalancesTab } from "./_components/balances-tab";

export const metadata: Metadata = { title: "Leave" };

type TabKey = "mine" | "calendar" | "requests" | "balances";

function tabsFor(ctx: RequestContext): LinkTab[] {
  const scope = scopeOf(ctx, "leave.view");
  const manage = can(ctx, "leave.manage", "all");
  const tabs: (LinkTab & { show: boolean })[] = [
    { key: "mine", label: "My leave", href: "/leave?tab=mine", show: true },
    { key: "calendar", label: "Team calendar", href: "/leave?tab=calendar", show: scope === "team" || scope === "all" },
    { key: "requests", label: "Requests", href: "/leave?tab=requests", show: scope === "team" || scope === "all" },
    { key: "balances", label: "Balances", href: "/leave?tab=balances", show: scope === "all" || manage },
  ];
  return tabs.filter((t) => t.show).map(({ key, label, href }) => ({ key, label, href }));
}

export default function LeavePage({ searchParams }: PageProps<"/leave">) {
  return (
    <Page>
      <PageHeader
        title="Leave"
        description="Balances, requests and who is away, with every balance change kept in an auditable ledger."
        actions={
          <Suspense fallback={<Skeleton className="h-8 w-48" />}>
            <HeaderActions />
          </Suspense>
        }
      />
      <Suspense
        fallback={
          <>
            <div className="mb-5 flex gap-2 border-b pb-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-28" />
              ))}
            </div>
            <div className="space-y-6">
              <StatGridSkeleton count={4} />
              <TableSkeleton rows={4} columns={5} />
            </div>
          </>
        }
      >
        <Body searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function HeaderActions() {
  const ctx = await requireContext();
  return (
    <>
      {can(ctx, "leave.manage", "all") ? (
        <Button variant="outline" size="sm" asChild>
          <Link href="/leave/settings">
            <Settings2 /> Settings
          </Link>
        </Button>
      ) : null}
      {ctx.employeeId || can(ctx, "leave.manage", "all") ? (
        <Button size="sm" asChild>
          <Link href="/leave/new">
            <CalendarPlus /> Apply leave
          </Link>
        </Button>
      ) : null}
    </>
  );
}

async function Body({ searchParams }: { searchParams: PageProps<"/leave">["searchParams"] }) {
  const ctx = await requireContext();
  if (!ctx.grants["leave.view"] && !can(ctx, "leave.manage", "all")) return <NoAccess />;
  const sp = await searchParams;
  const tabs = tabsFor(ctx);
  const requested = typeof sp.tab === "string" ? sp.tab : "mine";
  const tab = (tabs.find((t) => t.key === requested) ?? tabs[0]).key as TabKey;
  const flat = Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  const month = isMonth(flat.month) ? flat.month : todayIn().slice(0, 7);
  return (
    <>
      <LinkTabs tabs={tabs} active={tab} label="Leave sections" />
      <Suspense key={`${tab}:${JSON.stringify(flat)}`} fallback={<TableSkeleton rows={6} columns={5} />}>
        <TabBody ctx={ctx} tab={tab} month={month} flat={flat} />
      </Suspense>
    </>
  );
}

async function TabBody({ ctx, tab, month, flat }: { ctx: RequestContext; tab: TabKey; month: string; flat: Record<string, string> }) {
  try {
    switch (tab) {
      case "mine":
        return await MineTab({ ctx });
      case "calendar":
        return await CalendarTab({ ctx, month });
      case "requests":
        return await RequestsTab({ ctx, query: leaveListSchema.parse(flat) });
      case "balances":
        return await BalancesTab({ ctx, q: flat.q?.slice(0, 80), page: Math.max(1, Number(flat.page) || 1) });
    }
  } catch (err) {
    if (err instanceof AppError && err.code === "FORBIDDEN") return <NoAccess />;
    throw err;
  }
}
