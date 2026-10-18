import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, unstable_rethrow } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, Circle, Inbox, Paperclip, Receipt, XCircle } from "lucide-react";
import { EmptyState, ErrorState, PageHeader, Page, Reveal, Section, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { getClaim, type ClaimDetail } from "@/server/services/expenses/claims";
import { listExpenseCategories } from "@/server/services/expenses/categories";
import { formatDate, formatDateTime, formatMoney, todayIn } from "@/lib/format";
import { ClaimStatus } from "../_components/shared";
import {
  AddItemDialog,
  CancelClaimButton,
  EditClaimButton,
  MarkReimbursedButton,
  RemoveItemButton,
  SubmitClaimButton,
  WithdrawClaimButton,
} from "./claim-controls";

export const metadata: Metadata = { title: "Expense claim" };

export default function ClaimPage({ params }: PageProps<"/expenses/[id]">) {
  return (
    <Page>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/expenses">
          <ArrowLeft data-icon="inline-start" /> Expenses
        </Link>
      </Button>
      <Suspense
        fallback={
          <>
            <PageHeader title={<Skeleton className="h-7 w-72" />} />
            <TableSkeleton rows={4} columns={5} />
          </>
        }
      >
        <ClaimContent params={params} />
      </Suspense>
    </Page>
  );
}

async function ClaimContent({ params }: { params: PageProps<"/expenses/[id]">["params"] }) {
  const { id } = await params;
  const ctx = await requireContext();
  let claim: ClaimDetail;
  try {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    claim = await getClaim(ctx, id);
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    logger.error("expenses.claim_load_failed", { err });
    return <ErrorState title="Could not load this claim" />;
  }
  const categories = claim.canEdit ? await listExpenseCategories(ctx) : [];
  const pendingStep = claim.approval?.status === "pending" ? claim.approval.steps.find((s) => s.status === "pending") : null;

  return (
    <Reveal className="space-y-5">
      <PageHeader
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="tabular">{claim.number}</span>
            <ClaimStatus status={claim.status} postedToPayroll={claim.postedToPayroll} method={claim.reimbursementMethod} />
          </span>
        }
        title={claim.title}
        description={
          claim.access === "owner"
            ? `${claim.reimbursementMethod === "payroll" ? "Paid with salary" : "Paid by bank transfer"} after approval.`
            : `${claim.employee.name} · ${claim.employee.code}${claim.employee.department ? ` · ${claim.employee.department}` : ""}`
        }
        className="mb-0"
        actions={
          <>
            {claim.canEdit ? <EditClaimButton id={claim.id} title={claim.title} reimbursementMethod={claim.reimbursementMethod as "payroll" | "bank_transfer"} /> : null}
            {claim.canEdit ? <CancelClaimButton id={claim.id} /> : null}
            {claim.canWithdraw ? <WithdrawClaimButton id={claim.id} /> : null}
            {claim.access === "approver" && pendingStep ? (
              <Button asChild size="sm">
                <Link href={`/inbox?tab=approvals&request=${claim.approval!.requestId}`}>
                  <Inbox data-icon="inline-start" /> Review in inbox
                </Link>
              </Button>
            ) : null}
            {claim.canMarkReimbursed ? <MarkReimbursedButton id={claim.id} total={claim.total} /> : null}
            {claim.canSubmit ? <SubmitClaimButton id={claim.id} total={claim.total} /> : null}
          </>
        }
      />

      <ReimbursementNote claim={claim} />

      <Section
        title="Expenses"
        description={claim.canEdit ? "Add each expense with its receipt. Flags are shown to your approvers." : undefined}
        actions={claim.canEdit ? <AddItemDialog claimId={claim.id} categories={categories} today={todayIn()} /> : null}
      >
        {claim.lineItems.length ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Date</TableHead>
                <TableHead>Expense</TableHead>
                <TableHead className="hidden md:table-cell">Category</TableHead>
                <TableHead>Receipt</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                {claim.canEdit ? <TableHead className="w-10 pr-5" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {claim.lineItems.map((i) => (
                <TableRow key={i.id} className="align-top">
                  <TableCell className="pl-5 whitespace-nowrap text-muted-foreground tabular">{formatDate(i.spentOn)}</TableCell>
                  <TableCell className="min-w-56">
                    <span className="font-medium">{i.description}</span>
                    {i.merchant ? <span className="block text-xs text-muted-foreground">{i.merchant}</span> : null}
                    <span className="block text-xs text-muted-foreground md:hidden">{i.categoryName}</span>
                    {i.violations.length ? (
                      <ul className="mt-1.5 space-y-0.5">
                        {i.violations.map((v) => (
                          <li key={v} className="flex items-start gap-1.5 text-xs text-warning">
                            <AlertTriangle className="mt-px size-3 shrink-0" /> {v}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {i.categoryName}
                    {i.glCode && claim.access !== "owner" ? <span className="block text-xs text-muted-foreground tabular">GL {i.glCode}</span> : null}
                  </TableCell>
                  <TableCell>
                    {i.receipt ? (
                      <a href={`/expenses/receipts/${i.receipt.id}`} className="inline-flex max-w-40 items-center gap-1 text-sm hover:underline" target="_blank" rel="noopener">
                        <Paperclip className="size-3.5 shrink-0" />
                        <span className="truncate">{i.receipt.fileName}</span>
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">None</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular">{formatMoney(i.amount)}</TableCell>
                  {claim.canEdit ? (
                    <TableCell className="pr-5 text-right">
                      <RemoveItemButton id={i.id} label={i.description} />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4} className="pl-5 font-medium">
                  Total
                </TableCell>
                <TableCell className="text-right font-semibold tabular">{formatMoney(claim.total)}</TableCell>
                {claim.canEdit ? <TableCell /> : null}
              </TableRow>
            </TableFooter>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState icon={Receipt} title="No expenses yet" description="Add the first expense with its receipt to build this claim." className="border-0" />
          </div>
        )}
      </Section>

      {claim.approval ? (
        <Section title="Approval" description={claim.approval.status === "cancelled" ? "The last approval was withdrawn." : undefined}>
          <ol className="divide-y">
            {claim.approval.steps.map((s) => (
              <li key={s.stepNo} className="flex items-start gap-3 px-5 py-3 text-sm">
                {s.status === "approved" ? (
                  <CheckCircle2 className="mt-0.5 size-4 text-success" aria-label="Approved" />
                ) : s.status === "rejected" ? (
                  <XCircle className="mt-0.5 size-4 text-danger" aria-label="Rejected" />
                ) : (
                  <Circle className="mt-0.5 size-4 text-muted-foreground" aria-label={s.status} />
                )}
                <div className="min-w-0">
                  <p className="font-medium">
                    {s.name} <span className="font-normal text-muted-foreground">· {s.status === "pending" ? `waiting for ${s.approvers.join(", ")}` : s.status}</span>
                  </p>
                  {s.decidedBy ? (
                    <p className="text-xs text-muted-foreground">
                      {s.decidedBy} · {formatDateTime(s.decidedAt)}
                    </p>
                  ) : null}
                  {s.comment ? <p className="mt-1 text-sm">“{s.comment}”</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}
    </Reveal>
  );
}

function ReimbursementNote({ claim }: { claim: ClaimDetail }) {
  if (claim.status === "approved" && claim.reimbursementMethod === "payroll") {
    return claim.postedToPayroll ? (
      <p className="rounded-lg border border-success/20 bg-success-soft px-4 py-2.5 text-sm text-success">
        Added to {claim.payrollPeriod ?? "the open"} payroll{claim.payrollPeriod ? "" : " period"}. It will be paid with salary.
      </p>
    ) : (
      <p className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-sm text-warning">
        Approved and awaiting a payroll period. It is added automatically when the next payroll period opens.
      </p>
    );
  }
  if (claim.status === "approved" && claim.reimbursementMethod === "bank_transfer") {
    return <p className="rounded-lg border border-info/20 bg-info-soft px-4 py-2.5 text-sm text-info">Approved. Finance will transfer the amount to your bank account.</p>;
  }
  if (claim.status === "reimbursed") {
    return (
      <p className="rounded-lg border border-success/20 bg-success-soft px-4 py-2.5 text-sm text-success">
        Reimbursed on {formatDate(claim.reimbursedAt)}
        {claim.paymentReference ? ` · reference ${claim.paymentReference}` : ""}.
      </p>
    );
  }
  return null;
}
