import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { AlertTriangle, Plus, Receipt, UserRound } from "lucide-react";
import { EmptyState, ErrorState, Reveal } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RequestContext } from "@/server/auth/context";
import { logger } from "@/server/lib/logger";
import { listMyClaims, type ClaimListItem } from "@/server/services/expenses/claims";
import { formatDate, formatMoney } from "@/lib/format";
import { ClaimStatus } from "./shared";

export async function MyClaims({ ctx }: { ctx: RequestContext }) {
  if (!ctx.employeeId) {
    return (
      <EmptyState
        icon={UserRound}
        title="Your login is not linked to an employee record"
        description="Expense claims are raised against your employee profile. Ask HR to link your account."
      />
    );
  }
  let claims: ClaimListItem[];
  try {
    claims = await listMyClaims(ctx);
  } catch (err) {
    unstable_rethrow(err);
    logger.error("expenses.my_claims_failed", { err });
    return <ErrorState title="Could not load your claims" />;
  }
  if (!claims.length) {
    return (
      <EmptyState
        icon={Receipt}
        title="No expense claims yet"
        description="Create a claim, add each expense with its receipt, and submit it for approval. Approved claims are paid with salary or by bank transfer."
        action={
          <Button asChild size="sm">
            <Link href="/expenses/new">
              <Plus data-icon="inline-start" /> New claim
            </Link>
          </Button>
        }
      />
    );
  }
  return (
    <Reveal>
      <ClaimsTable claims={claims} />
    </Reveal>
  );
}

export function ClaimsTable({ claims, showEmployee = false }: { claims: ClaimListItem[]; showEmployee?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Claim</TableHead>
            {showEmployee ? <TableHead>Employee</TableHead> : null}
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Items</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="hidden md:table-cell">{showEmployee ? "Submitted" : "Updated"}</TableHead>
            <TableHead className="hidden pr-4 lg:table-cell">Reimbursement</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {claims.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="min-w-56 pl-4">
                <Link href={`/expenses/${c.id}`} className="font-medium hover:underline">
                  {c.title}
                </Link>
                <p className="text-xs text-muted-foreground tabular">
                  {c.number}
                  {c.violations ? (
                    <span className="ml-2 inline-flex items-center gap-1 text-warning">
                      <AlertTriangle className="size-3" /> {c.violations} flagged
                    </span>
                  ) : null}
                </p>
              </TableCell>
              {showEmployee ? (
                <TableCell>
                  <span className="block">{c.employee?.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.employee?.code}
                    {c.employee?.department ? ` · ${c.employee.department}` : ""}
                  </span>
                </TableCell>
              ) : null}
              <TableCell>
                <ClaimStatus status={c.status} postedToPayroll={c.postedToPayroll} method={c.reimbursementMethod} />
              </TableCell>
              <TableCell className="text-right tabular">{c.items}</TableCell>
              <TableCell className="text-right font-medium tabular">{formatMoney(c.total, c.currency)}</TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">{formatDate(showEmployee ? c.submittedAt : (c.submittedAt ?? c.createdAt))}</TableCell>
              <TableCell className="hidden pr-4 text-muted-foreground lg:table-cell">{c.reimbursementMethod === "payroll" ? "With salary" : "Bank transfer"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
