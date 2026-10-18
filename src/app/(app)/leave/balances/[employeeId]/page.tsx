import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";
import { EmptyState, NoAccess, Page, PageHeader, Reveal, Section, StatGridSkeleton, TableSkeleton } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { balancesFor, leaveEmployeeHeader, ledgerFor } from "@/server/services/time/leave-ledger";
import { listLeaveTypes } from "@/server/services/time/leave-types";
import { employeeFormLookups } from "@/server/services/employees/lookups";
import { formatDate, formatDateTime, titleCase, todayIn } from "@/lib/format";
import { BalanceCards } from "../../_components/balance-cards";
import { AdjustDialog } from "../../_components/adjust-dialog";

export const metadata: Metadata = { title: "Leave ledger" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KIND_TONE: Record<string, "success" | "danger" | "info" | "neutral" | "warning" | "brand"> = {
  opening: "neutral",
  accrual: "success",
  grant: "success",
  deduction: "info",
  reversal: "brand",
  carry_forward: "success",
  expiry: "warning",
  encashment: "neutral",
  adjustment: "neutral",
};

export default function LedgerPage({ params }: PageProps<"/leave/balances/[employeeId]">) {
  return (
    <Page>
      <Suspense
        fallback={
          <div className="space-y-6">
            <StatGridSkeleton count={4} />
            <TableSkeleton rows={8} columns={6} />
          </div>
        }
      >
        <Content params={params} />
      </Suspense>
    </Page>
  );
}

async function Content({ params }: { params: PageProps<"/leave/balances/[employeeId]">["params"] }) {
  const { employeeId } = await params;
  if (!UUID.test(employeeId)) notFound();
  const ctx = await requireContext();
  let cards: Awaited<ReturnType<typeof balancesFor>>;
  let ledger: Awaited<ReturnType<typeof ledgerFor>>;
  let person: Awaited<ReturnType<typeof leaveEmployeeHeader>>;
  try {
    [cards, ledger, person] = await Promise.all([balancesFor(ctx, employeeId), ledgerFor(ctx, employeeId), leaveEmployeeHeader(ctx, employeeId)]);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    if (err instanceof AppError && err.code === "FORBIDDEN") return <NoAccess message="You do not have access to this employee's leave." />;
    throw err;
  }
  const canAdjust = can(ctx, "leave.manage", "all");
  const [types, lookups] = canAdjust ? await Promise.all([listLeaveTypes(ctx), employeeFormLookups(ctx)]) : [[], null];
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={canAdjust || employeeId !== ctx.employeeId ? "/leave?tab=balances" : "/leave"} className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3" /> Leave
          </Link>
        }
        title={employeeId === ctx.employeeId ? "My leave ledger" : `${person.name} · leave ledger`}
        description="Every balance change is an append-only posting: accruals, approved leave, reversals, carry forward, expiry and HR adjustments."
        actions={
          canAdjust && lookups ? (
            <AdjustDialog employees={lookups.managers} types={types.filter((t) => t.isPaid).map((t) => ({ value: t.id, label: t.name, category: t.category }))} employeeId={employeeId} today={todayIn()} />
          ) : null
        }
      />
      <Reveal className="space-y-6">
        <BalanceCards cards={cards} />
        <Section title="Ledger">
          {ledger.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Effective</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead className="hidden md:table-cell">Note</TableHead>
                    <TableHead className="hidden lg:table-cell">Expires</TableHead>
                    <TableHead className="hidden pr-5 lg:table-cell">Posted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="pl-5 tabular">{formatDate(t.effectiveOn)}</TableCell>
                      <TableCell>{t.typeCode}</TableCell>
                      <TableCell>
                        <StatusBadge status={t.kind} label={titleCase(t.kind)} tone={KIND_TONE[t.kind]} />
                      </TableCell>
                      <TableCell className={t.days < 0 ? "text-right font-medium tabular" : "text-right font-medium text-success tabular"}>
                        {t.days > 0 ? `+${t.days}` : t.days}
                      </TableCell>
                      <TableCell className="hidden max-w-72 truncate text-muted-foreground md:table-cell" title={t.note ?? undefined}>
                        {t.leaveRequestId ? (
                          <Link href={`/leave/requests/${t.leaveRequestId}`} className="hover:underline">
                            {t.note ?? "Leave request"}
                          </Link>
                        ) : (
                          (t.note ?? "—")
                        )}
                      </TableCell>
                      <TableCell className="hidden tabular text-muted-foreground lg:table-cell">{t.expiresOn ? formatDate(t.expiresOn) : "—"}</TableCell>
                      <TableCell className="hidden pr-5 text-xs text-muted-foreground lg:table-cell">{formatDateTime(t.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyState className="m-4 border-0" icon={BookOpen} title="No postings yet" description="Accruals run on the first of each month; approved leave and HR adjustments also appear here." />
          )}
        </Section>
      </Reveal>
    </>
  );
}
