import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Inbox, Plus } from "lucide-react";
import { Page, PageHeader, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LinkTabs, type LinkTab } from "@/components/documents/link-tabs";
import { can, requireContext, type RequestContext } from "@/server/auth/context";
import { canManageExpenses } from "@/server/services/expenses/categories";
import { canSeeExpenseReports } from "@/server/services/expenses/reports";
import { canManageBenefits } from "@/server/services/benefits/plans";
import { MyClaims } from "./_components/my-claims";
import { FinanceClaims } from "./_components/finance-claims";
import { SpendReports } from "./_components/spend-reports";
import { MyBenefits } from "./_components/my-benefits";
import { ManageBenefits } from "./_components/manage-benefits";
import { ExpenseSettings } from "./_components/expense-settings";

export const metadata: Metadata = { title: "Expenses & benefits" };

type TabKey = "mine" | "finance" | "reports" | "benefits" | "plans" | "settings";

function tabsFor(ctx: RequestContext): LinkTab[] {
  const tabs: (LinkTab & { show: boolean })[] = [
    { key: "mine", label: "My claims", href: "/expenses?tab=mine", show: true },
    { key: "finance", label: "Finance", href: "/expenses?tab=finance", show: canManageExpenses(ctx) },
    { key: "reports", label: "Reports", href: "/expenses?tab=reports", show: canSeeExpenseReports(ctx) },
    { key: "benefits", label: "My benefits", href: "/expenses?tab=benefits", show: true },
    { key: "plans", label: "Manage benefits", href: "/expenses?tab=plans", show: canManageBenefits(ctx) },
    { key: "settings", label: "Settings", href: "/expenses?tab=settings", show: canManageExpenses(ctx) },
  ];
  return tabs.filter((t) => t.show).map(({ key, label, href }) => ({ key, label, href }));
}

export default function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  return (
    <Page>
      <Suspense fallback={<PageHeader title="Expenses & benefits" />}>
        <Header />
      </Suspense>
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

async function Header() {
  const ctx = await requireContext();
  return (
    <PageHeader
      title="Expenses & benefits"
      description="Claim business expenses with receipts, track approvals and reimbursements, and manage your benefits."
      actions={
        <>
          {can(ctx, "expenses.approve") ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/inbox?tab=approvals">
                <Inbox data-icon="inline-start" /> Team approvals
              </Link>
            </Button>
          ) : null}
          {ctx.employeeId && can(ctx, "expenses.view") ? (
            <Button asChild size="sm">
              <Link href="/expenses/new">
                <Plus data-icon="inline-start" /> New claim
              </Link>
            </Button>
          ) : null}
        </>
      }
    />
  );
}

async function Body({ searchParams }: { searchParams: PageProps<"/expenses">["searchParams"] }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const tabs = tabsFor(ctx);
  const requested = typeof sp.tab === "string" ? sp.tab : undefined;
  const active = (tabs.find((t) => t.key === requested) ?? tabs[0]).key as TabKey;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  return (
    <>
      <LinkTabs tabs={tabs} active={active} label="Expense sections" />
      <Suspense key={`${active}:${str("status")}:${str("q")}:${str("month")}`} fallback={<TableSkeleton rows={5} columns={6} />}>
        {active === "mine" ? (
          <MyClaims ctx={ctx} />
        ) : active === "finance" ? (
          <FinanceClaims ctx={ctx} filter={{ status: str("status"), q: str("q"), month: str("month") }} />
        ) : active === "reports" ? (
          <SpendReports ctx={ctx} />
        ) : active === "benefits" ? (
          <MyBenefits ctx={ctx} />
        ) : active === "plans" ? (
          <ManageBenefits ctx={ctx} />
        ) : (
          <ExpenseSettings ctx={ctx} />
        )}
      </Suspense>
    </>
  );
}
