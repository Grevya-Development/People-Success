import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { Page, PageHeader, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LinkTabs, type LinkTab } from "@/components/documents/link-tabs";
import { requireContext } from "@/server/auth/context";
import { queueAccess } from "@/server/services/helpdesk/tickets";
import { canManageHelpdesk, isHelpdeskAgent } from "@/server/services/helpdesk/rules";
import { MyTickets } from "./_components/my-tickets";
import { Queue } from "./_components/queue";
import { KnowledgeBase } from "./_components/knowledge-base";
import { Insights } from "./_components/insights";
import { HelpdeskSettings } from "./_components/settings";

export const metadata: Metadata = { title: "HR service desk" };

type TabKey = "mine" | "queue" | "kb" | "insights" | "settings";

export default function HelpdeskPage({ searchParams }: PageProps<"/helpdesk">) {
  return (
    <Page>
      <PageHeader
        title="HR service desk"
        description="Ask HR anything — payroll, leave, letters, policies — and track the answer. Confidential concerns go only to the HR team that handles them."
        actions={
          <Button asChild size="sm">
            <Link href="/helpdesk/new">
              <Plus data-icon="inline-start" /> Raise a ticket
            </Link>
          </Button>
        }
      />
      <Suspense
        fallback={
          <>
            <div className="mb-5 flex gap-2 border-b pb-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-24" />
              ))}
            </div>
            <TableSkeleton rows={5} columns={6} />
          </>
        }
      >
        <Body searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Body({ searchParams }: { searchParams: PageProps<"/helpdesk">["searchParams"] }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const queue = await queueAccess(ctx);
  const tabs: (LinkTab & { show: boolean })[] = [
    { key: "mine", label: "My tickets", href: "/helpdesk?tab=mine", show: true },
    { key: "queue", label: queue === "assignee" ? "Assigned to me" : "Queue", href: "/helpdesk?tab=queue", show: !!queue },
    { key: "kb", label: "Knowledge base", href: "/helpdesk?tab=kb", show: true },
    { key: "insights", label: "Insights", href: "/helpdesk?tab=insights", show: isHelpdeskAgent(ctx) },
    { key: "settings", label: "Settings", href: "/helpdesk?tab=settings", show: canManageHelpdesk(ctx) },
  ];
  const visible = tabs.filter((t) => t.show).map(({ key, label, href }) => ({ key, label, href }));
  const requested = typeof sp.tab === "string" ? sp.tab : undefined;
  const active = (visible.find((t) => t.key === requested) ?? visible[0]).key as TabKey;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  return (
    <>
      <LinkTabs tabs={visible} active={active} label="Service desk sections" />
      <Suspense key={`${active}:${str("view")}:${str("status")}:${str("category")}`} fallback={<TableSkeleton rows={5} columns={6} />}>
        {active === "mine" ? (
          <MyTickets ctx={ctx} />
        ) : active === "queue" ? (
          <Queue ctx={ctx} view={str("view")} status={str("status")} category={str("category")} />
        ) : active === "kb" ? (
          <KnowledgeBase ctx={ctx} />
        ) : active === "insights" ? (
          <Insights ctx={ctx} />
        ) : (
          <HelpdeskSettings ctx={ctx} />
        )}
      </Suspense>
    </>
  );
}
