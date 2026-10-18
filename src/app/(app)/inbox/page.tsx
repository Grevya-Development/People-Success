import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CheckCircle2, Inbox, ListChecks, Send } from "lucide-react";
import { cn } from "cn";
import { EmptyState, Page, PageHeader, Reveal, TableSkeleton } from "@/components/page";
import { can, requireContext } from "@/server/auth/context";
import { allApprovals, myRequests, myTasks, pendingApprovalsFor } from "@/server/services/inbox";
import { ApprovalList } from "./approval-list";
import { TaskList } from "./task-list";

export const metadata: Metadata = { title: "Approvals & tasks" };

type Tab = "approvals" | "tasks" | "requests" | "all";

export default function InboxPage({ searchParams }: PageProps<"/inbox">) {
  return (
    <Page>
      <PageHeader title="Approvals & tasks" description="Everything waiting on you, and the requests you have raised." />
      <Suspense fallback={<TableSkeleton rows={6} columns={4} />}>
        <InboxBody searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function InboxBody({ searchParams }: { searchParams: PageProps<"/inbox">["searchParams"] }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const canSeeAll = can(ctx, "approvals.view", "all");
  const requested = (typeof sp.tab === "string" ? sp.tab : "approvals") as Tab;
  const tab: Tab = requested === "all" && !canSeeAll ? "approvals" : requested;
  const highlight = typeof sp.request === "string" ? sp.request : undefined;

  const [pending, tasks] = await Promise.all([pendingApprovalsFor(ctx), myTasks(ctx)]);
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "approvals", label: "To approve", count: pending.length },
    { key: "tasks", label: "My tasks", count: tasks.length },
    { key: "requests", label: "My requests" },
    ...(canSeeAll ? [{ key: "all" as Tab, label: "All approvals" }] : []),
  ];

  return (
    <>
      <nav aria-label="Inbox sections" className="mb-5 border-b">
        <ul className="flex gap-1">
          {tabs.map((t) => (
            <li key={t.key}>
              <Link
                href={`?tab=${t.key}`}
                scroll={false}
                aria-current={t.key === tab ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-10 items-center gap-1.5 px-3 text-sm text-muted-foreground hover:text-foreground",
                  t.key === tab && "font-medium text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground",
                )}
              >
                {t.label}
                {t.count ? <span className="rounded-full bg-muted px-1.5 text-xs tabular text-muted-foreground">{t.count}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Reveal key={tab}>
        {tab === "approvals" ? (
          pending.length ? (
            <ApprovalList items={pending} highlight={highlight} />
          ) : (
            <EmptyState icon={CheckCircle2} title="Nothing to approve" description="Requests that need your decision will appear here." />
          )
        ) : tab === "tasks" ? (
          tasks.length ? (
            <TaskList items={tasks} />
          ) : (
            <EmptyState icon={ListChecks} title="No open tasks" description="Onboarding, exit and workflow tasks assigned to you will appear here." />
          )
        ) : tab === "requests" ? (
          <MyRequests />
        ) : (
          <AllApprovals status={typeof sp.status === "string" ? sp.status : undefined} />
        )}
      </Reveal>
    </>
  );
}

async function MyRequests() {
  const ctx = await requireContext();
  const items = await myRequests(ctx);
  return items.length ? (
    <ApprovalList items={items} />
  ) : (
    <EmptyState icon={Send} title="No requests yet" description="Leave, expenses, corrections and other requests you raise are tracked here." />
  );
}

async function AllApprovals({ status }: { status?: string }) {
  const ctx = await requireContext();
  const items = await allApprovals(ctx, status);
  return items.length ? <ApprovalList items={items} /> : <EmptyState icon={Inbox} title="No approvals" />;
}
