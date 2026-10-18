import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { CalendarCheck2, Download } from "lucide-react";
import { EmptyState, ErrorState, Reveal, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import type { RequestContext } from "@/server/auth/context";
import { expiringDocuments } from "@/server/services/documents/documents";
import { logger } from "@/server/lib/logger";
import { formatDate } from "@/lib/format";
import { DOCUMENT_CATEGORY_LABELS } from "@/lib/validation/documents";

export const EXPIRING_WINDOW_DAYS = 60;

export async function ExpiringList({ ctx }: { ctx: RequestContext }) {
  let rows;
  try {
    rows = await expiringDocuments(ctx, EXPIRING_WINDOW_DAYS);
  } catch (err) {
    unstable_rethrow(err);
    logger.error("documents.expiring_failed", { err });
    return <ErrorState title="Could not load expiring documents" />;
  }
  const expired = rows.filter((r) => r.daysLeft < 0).length;

  return (
    <Reveal>
      <Section
        title="Expiring documents"
        description={`Current documents that have expired or expire in the next ${EXPIRING_WINDOW_DAYS} days${expired ? ` · ${expired} already expired` : ""}.`}
      >
        {rows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Document</TableHead>
                <TableHead>Belongs to</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-5 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-[18rem] pl-5">
                    <div className="truncate font-medium">{r.title}</div>
                    <div className="text-xs text-muted-foreground">{DOCUMENT_CATEGORY_LABELS[r.category]}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.employeeId && r.employeeName ? (
                      <Link href={`/employees/${r.employeeId}`} className="hover:underline">
                        {r.employeeName}
                        <span className="ml-1.5 text-xs text-muted-foreground">{r.employeeCode}</span>
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Company</span>
                    )}
                  </TableCell>
                  <TableCell className="tabular whitespace-nowrap">{formatDate(r.expiresOn)}</TableCell>
                  <TableCell>
                    <StatusBadge
                      status="expiry"
                      className="normal-case"
                      tone={r.daysLeft <= 0 ? "danger" : r.daysLeft < 30 ? "warning" : "neutral"}
                      label={r.daysLeft < 0 ? `Expired ${-r.daysLeft} d ago` : r.daysLeft === 0 ? "Expires today" : `In ${r.daysLeft} days`}
                    />
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <Button asChild variant="ghost" size="icon-sm">
                      <a href={`/api/documents/${r.id}/download`} aria-label={`Download ${r.title}`} title="Download">
                        <Download />
                      </a>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={CalendarCheck2}
              title="Nothing expiring soon"
              description={`No documents expire in the next ${EXPIRING_WINDOW_DAYS} days. Add expiry dates to passports, visas and certificates to track them here.`}
              className="border-0"
            />
          </div>
        )}
      </Section>
    </Reveal>
  );
}
