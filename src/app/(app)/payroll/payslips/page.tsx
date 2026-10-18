import type { Metadata } from "next";
import { Suspense } from "react";
import { Download, FileText, UserRound } from "lucide-react";
import { EmptyState, NoAccess, Page, PageHeader, Reveal, Section, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { can, requireContext } from "@/server/auth/context";
import { listPayslips } from "@/server/services/payroll/payslips";
import { getMyDeclaration } from "@/server/services/payroll/declarations";
import { formatDate, formatMoney } from "@/lib/format";
import { PayrollTabs } from "../_components/payroll-tabs";
import { RUN_KIND_LABEL } from "../_components/status";
import { DeclarationForm } from "./declaration-form";

export const metadata: Metadata = { title: "My payslips" };

export default function MyPayslipsPage() {
  return (
    <Page>
      <PageHeader title="My payslips" description="Your published payslips and your income tax declaration for this financial year." />
      <Suspense fallback={<TableSkeleton rows={4} columns={4} />}>
        <Payslips />
      </Suspense>
      <Suspense fallback={<Skeleton className="mt-6 h-96 w-full rounded-xl" />}>
        <Declaration />
      </Suspense>
    </Page>
  );
}

async function Payslips() {
  const ctx = await requireContext();
  if (!can(ctx, "payslips.view")) return <NoAccess />;
  if (!ctx.employeeId) {
    return <EmptyState icon={UserRound} title="Your login is not linked to an employee record" description="Payslips appear here once HR links your account to your employee profile." />;
  }
  const rows = await listPayslips(ctx);
  return (
    <Reveal className="space-y-6">
      <PayrollTabs ctx={ctx} active="payslips" />
      <Section title="Payslips">
        {rows.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Period</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Net pay</TableHead>
                  <TableHead className="hidden sm:table-cell">Published</TableHead>
                  <TableHead className="pr-5 text-right">
                    <span className="sr-only">Download</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="pl-5 font-medium">{p.periodLabel || p.title}</TableCell>
                    <TableCell>{p.runKind === "regular" ? "Payslip" : <StatusBadge status={p.runKind} tone="info" label={RUN_KIND_LABEL[p.runKind] ?? p.runKind} />}</TableCell>
                    <TableCell className="text-right tabular">{formatMoney(p.gross)}</TableCell>
                    <TableCell className="text-right font-medium tabular">{formatMoney(p.net)}</TableCell>
                    <TableCell className="hidden sm:table-cell">{formatDate(p.publishedAt)}</TableCell>
                    <TableCell className="pr-5 text-right">
                      {p.documentId ? (
                        <Button variant="ghost" size="sm" asChild>
                          <a href={`/api/documents/${p.documentId}/download`}>
                            <Download /> PDF
                          </a>
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState className="m-4 border-0" icon={FileText} title="No payslips yet" description="Payslips appear here after payroll publishes them for a period." />
        )}
      </Section>
    </Reveal>
  );
}

async function Declaration() {
  const ctx = await requireContext();
  if (!can(ctx, "payslips.view") || !ctx.employeeId) return null;
  const value = await getMyDeclaration(ctx);
  if (!value) return null;
  const fy = `${value.fyStartYear}-${String((value.fyStartYear + 1) % 100).padStart(2, "0")}`;
  return (
    <Section
      className="mt-6"
      title={
        <span className="flex items-center gap-2">
          Income tax declaration · FY {fy} <StatusBadge status={value.status} tone={value.status === "verified" ? "success" : value.status === "submitted" ? "info" : "neutral"} />
        </span>
      }
      description="Choose your tax regime and declare investments so TDS is spread correctly through the year. Payroll uses submitted declarations; keep proofs ready for verification."
    >
      <div className="p-5">
        <DeclarationForm value={value} />
      </div>
    </Section>
  );
}
