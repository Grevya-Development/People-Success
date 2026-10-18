import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Settings2 } from "lucide-react";
import { NoAccess, Page, PageHeader, StatGridSkeleton, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LinkTabs, type LinkTab } from "@/components/documents/link-tabs";
import { can, requireContext, scopeOf, type RequestContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { canManageHolidays } from "@/server/services/time/holidays";
import { todayIn } from "@/lib/format";
import { weekStartOf } from "@/server/services/time/timesheets";
import { MineTab } from "./_components/mine-tab";
import { TeamTab } from "./_components/team-tab";
import { AllTab } from "./_components/all-tab";
import { RegularizationsTab } from "./_components/regularizations-tab";
import { TimesheetsTab } from "./_components/timesheets-tab";
import { isDate, isMonth } from "./_components/status";

export const metadata: Metadata = { title: "Attendance" };

type TabKey = "mine" | "team" | "all" | "regularizations" | "timesheets";

function tabsFor(ctx: RequestContext): LinkTab[] {
  const scope = scopeOf(ctx, "attendance.view");
  const tabs: (LinkTab & { show: boolean })[] = [
    { key: "mine", label: "My attendance", href: "/attendance?tab=mine", show: true },
    { key: "team", label: "Team", href: "/attendance?tab=team", show: scope === "team" || scope === "all" },
    { key: "all", label: "All employees", href: "/attendance?tab=all", show: scope === "all" },
    { key: "regularizations", label: "Corrections", href: "/attendance?tab=regularizations", show: true },
    { key: "timesheets", label: "Timesheets", href: "/attendance?tab=timesheets", show: true },
  ];
  return tabs.filter((t) => t.show).map(({ key, label, href }) => ({ key, label, href }));
}

export default function AttendancePage({ searchParams }: PageProps<"/attendance">) {
  return (
    <Page>
      <PageHeader
        title="Attendance"
        description="Check in, see your month at a glance and keep payable days accurate for payroll."
        actions={
          <Suspense fallback={<Skeleton className="h-8 w-28" />}>
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
              <Skeleton className="h-36 w-full rounded-xl" />
              <StatGridSkeleton count={8} />
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
  if (!can(ctx, "attendance.manage", "all") && !canManageHolidays(ctx)) return null;
  return (
    <Button variant="outline" size="sm" asChild>
      <Link href="/attendance/settings">
        <Settings2 /> Settings
      </Link>
    </Button>
  );
}

async function Body({ searchParams }: { searchParams: PageProps<"/attendance">["searchParams"] }) {
  const ctx = await requireContext();
  if (!ctx.grants["attendance.view"]) return <NoAccess />;
  const sp = await searchParams;
  const tabs = tabsFor(ctx);
  const requested = typeof sp.tab === "string" ? sp.tab : "mine";
  const tab = (tabs.find((t) => t.key === requested) ?? tabs[0]).key as TabKey;
  const today = todayIn();
  const month = isMonth(sp.month) ? sp.month : today.slice(0, 7);
  const date = isDate(sp.date) ? sp.date : today;
  const week = isDate(sp.week) ? weekStartOf(sp.week) : weekStartOf(today);

  return (
    <>
      <LinkTabs tabs={tabs} active={tab} label="Attendance sections" />
      <Suspense key={`${tab}:${month}:${date}:${week}`} fallback={<TableSkeleton rows={6} columns={5} />}>
        <TabBody ctx={ctx} tab={tab} month={month} date={date} week={week} today={today} />
      </Suspense>
    </>
  );
}

async function TabBody({ ctx, tab, month, date, week, today }: { ctx: RequestContext; tab: TabKey; month: string; date: string; week: string; today: string }) {
  try {
    switch (tab) {
      case "mine":
        return await MineTab({ ctx, month });
      case "team":
        return await TeamTab({ ctx });
      case "all":
        return await AllTab({ ctx, date, today });
      case "regularizations":
        return await RegularizationsTab({ ctx });
      case "timesheets":
        return await TimesheetsTab({ ctx, week });
    }
  } catch (err) {
    if (err instanceof AppError && err.code === "FORBIDDEN") return <NoAccess />;
    throw err;
  }
}
