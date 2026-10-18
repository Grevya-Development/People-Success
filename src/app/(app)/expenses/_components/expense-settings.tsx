import { unstable_rethrow } from "next/navigation";
import { Tags } from "lucide-react";
import { EmptyState, ErrorState, NoAccess, Reveal, Section } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RequestContext } from "@/server/auth/context";
import { logger } from "@/server/lib/logger";
import { canManageExpenses, listExpenseCategories, type ExpenseCategory } from "@/server/services/expenses/categories";
import { formatMoney } from "@/lib/format";
import { EditCategoryButton, NewCategoryButton, SeedCategoriesButton } from "./category-controls";

export async function ExpenseSettings({ ctx }: { ctx: RequestContext }) {
  if (!canManageExpenses(ctx)) return <NoAccess />;
  let cats: ExpenseCategory[];
  try {
    cats = await listExpenseCategories(ctx, { includeInactive: true });
  } catch (err) {
    unstable_rethrow(err);
    logger.error("expenses.categories_failed", { err });
    return <ErrorState title="Could not load categories" />;
  }
  if (!cats.length) {
    return (
      <EmptyState
        icon={Tags}
        title="No expense categories"
        description="Start with the standard Indian reimbursement heads (travel, conveyance, meals, stay, internet & phone, learning, client entertainment) and adjust limits, or create your own."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <SeedCategoriesButton variant="default" />
            <NewCategoryButton />
          </div>
        }
      />
    );
  }
  return (
    <Reveal>
      <Section
        title="Expense categories"
        description="Limits and receipt rules are checked on every item; breaches are flagged to approvers. Missing receipts block submission."
        actions={
          <>
            <SeedCategoriesButton />
            <NewCategoryButton />
          </>
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">Category</TableHead>
              <TableHead className="text-right">Per item</TableHead>
              <TableHead className="text-right">Per month</TableHead>
              <TableHead className="text-right">Receipt above</TableHead>
              <TableHead className="hidden md:table-cell">GL code</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12 pr-5" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {cats.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="pl-5">
                  <span className="font-medium">{c.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground tabular">{c.code}</span>
                  {c.isTaxable ? <StatusBadge status="taxable" tone="warning" className="ml-2" /> : null}
                </TableCell>
                <TableCell className="text-right tabular">{c.maxPerItem == null ? "No limit" : formatMoney(c.maxPerItem)}</TableCell>
                <TableCell className="text-right tabular">{c.maxPerMonth == null ? "No limit" : formatMoney(c.maxPerMonth)}</TableCell>
                <TableCell className="text-right tabular">{c.receiptRequiredAbove ? formatMoney(c.receiptRequiredAbove) : "Always"}</TableCell>
                <TableCell className="hidden text-muted-foreground tabular md:table-cell">{c.glCode ?? "—"}</TableCell>
                <TableCell>
                  <StatusBadge status={c.isActive ? "active" : "inactive"} tone={c.isActive ? "success" : "neutral"} />
                </TableCell>
                <TableCell className="pr-5 text-right">
                  <EditCategoryButton category={c} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </Reveal>
  );
}
