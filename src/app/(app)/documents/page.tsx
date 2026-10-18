import type { Metadata } from "next";
import { Suspense } from "react";
import { UserRound } from "lucide-react";
import { EmptyState, Page, PageHeader, TableSkeleton } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { can, requireContext, type RequestContext } from "@/server/auth/context";
import { EmployeeDocuments } from "@/components/documents/employee-documents";
import { CompanyDocuments } from "@/components/documents/company-documents";
import { PoliciesList } from "@/components/documents/policies-list";
import { TemplatesList } from "@/components/documents/templates-list";
import { ExpiringList } from "@/components/documents/expiring-list";
import { LinkTabs, type LinkTab } from "@/components/documents/link-tabs";

export const metadata: Metadata = { title: "Documents" };

type TabKey = "mine" | "company" | "policies" | "templates" | "expiring";

function tabsFor(ctx: RequestContext): LinkTab[] {
  const tabs: (LinkTab & { key: TabKey; show: boolean })[] = [
    { key: "mine", label: "My documents", href: "/documents?tab=mine", show: true },
    { key: "company", label: "Company documents", href: "/documents?tab=company", show: true },
    { key: "policies", label: "Policies", href: "/documents?tab=policies", show: true },
    { key: "templates", label: "Templates", href: "/documents?tab=templates", show: can(ctx, "templates.manage", "all") },
    { key: "expiring", label: "Expiring", href: "/documents?tab=expiring", show: can(ctx, "documents.manage", "all") },
  ];
  return tabs.filter((t) => t.show).map(({ key, label, href }) => ({ key, label, href }));
}

export default function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  return (
    <Page>
      <PageHeader title="Documents" description="Personal records, company documents, policies and letter templates in one secure place." />
      <Suspense
        fallback={
          <>
            <div className="mb-5 flex gap-2 border-b pb-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-28" />
              ))}
            </div>
            <TableSkeleton rows={5} columns={6} />
          </>
        }
      >
        <DocumentsContent searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function DocumentsContent({ searchParams }: { searchParams: PageProps<"/documents">["searchParams"] }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const requested = typeof sp.tab === "string" ? sp.tab : undefined;
  const tabs = tabsFor(ctx);
  const active = (tabs.find((t) => t.key === requested) ?? tabs[0]).key as TabKey;

  return (
    <>
      <LinkTabs tabs={tabs} active={active} label="Document sections" />
      <Suspense key={active} fallback={<TableSkeleton rows={5} columns={6} />}>
        <TabBody tab={active} ctx={ctx} />
      </Suspense>
    </>
  );
}

function TabBody({ tab, ctx }: { tab: TabKey; ctx: RequestContext }) {
  switch (tab) {
    case "mine":
      return ctx.employeeId ? (
        <EmployeeDocuments employeeId={ctx.employeeId} title="My documents" />
      ) : (
        <EmptyState
          icon={UserRound}
          title="Your login is not linked to an employee record"
          description="Personal documents appear here once HR links your account to your employee profile. Company documents and policies are still available in the other tabs."
        />
      );
    case "company":
      return <CompanyDocuments ctx={ctx} />;
    case "policies":
      return <PoliciesList ctx={ctx} />;
    case "templates":
      return <TemplatesList ctx={ctx} />;
    case "expiring":
      return <ExpiringList ctx={ctx} />;
  }
}
