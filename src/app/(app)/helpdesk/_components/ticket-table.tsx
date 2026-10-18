import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { Lock } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TicketListItem } from "@/server/services/helpdesk/tickets";
import { TICKET_STATUS_LABELS, type TicketPriority, type TicketStatus } from "@/lib/validation/helpdesk";

const STATUS_TONES: Record<TicketStatus, "info" | "warning" | "success" | "neutral"> = {
  open: "info",
  in_progress: "info",
  waiting_on_employee: "warning",
  resolved: "success",
  closed: "neutral",
};

export function TicketStatus({ status }: { status: TicketStatus }) {
  return <StatusBadge status={status} tone={STATUS_TONES[status]} label={TICKET_STATUS_LABELS[status]} />;
}

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  if (priority === "normal") return <span className="text-xs text-muted-foreground">Normal</span>;
  return <StatusBadge status={priority} tone={priority === "urgent" ? "danger" : priority === "high" ? "warning" : "neutral"} />;
}

function Due({ t }: { t: TicketListItem }) {
  if (t.status === "resolved" || t.status === "closed") return <span className="text-muted-foreground">—</span>;
  const due = !t.firstRespondedAt ? t.firstResponseDueAt : t.resolutionDueAt;
  if (!due) return <span className="text-muted-foreground">—</span>;
  const label = !t.firstRespondedAt ? "response" : "resolution";
  const late = t.overdue;
  return (
    <span className={late ? "text-danger" : "text-muted-foreground"}>
      {late ? `${label} overdue ${formatDistanceToNowStrict(new Date(due))}` : `${label} in ${formatDistanceToNowStrict(new Date(due))}`}
    </span>
  );
}

export function TicketTable({ tickets, agentView }: { tickets: TicketListItem[]; agentView: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Ticket</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Category</TableHead>
            {agentView ? <TableHead className="hidden lg:table-cell">Requester</TableHead> : null}
            {agentView ? <TableHead className="hidden lg:table-cell">Assignee</TableHead> : null}
            <TableHead>Priority</TableHead>
            <TableHead className="hidden pr-4 sm:table-cell">{agentView ? "SLA" : "Updated"}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tickets.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="min-w-64 pl-4">
                <Link href={`/helpdesk/${t.id}`} className="font-medium hover:underline">
                  {t.subject}
                </Link>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground tabular">
                  {t.number}
                  {t.isSensitive ? (
                    <span className="inline-flex items-center gap-0.5">
                      <Lock className="size-3" /> Confidential
                    </span>
                  ) : null}
                  {t.channel === "assistant" ? <span>· via assistant</span> : null}
                  {t.escalated && agentView ? <span className="text-danger">· escalated</span> : null}
                </p>
              </TableCell>
              <TableCell>
                <TicketStatus status={t.status} />
              </TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">{t.categoryName ?? "Uncategorized"}</TableCell>
              {agentView ? <TableCell className="hidden lg:table-cell">{t.requesterName ?? "—"}</TableCell> : null}
              {agentView ? <TableCell className="hidden text-muted-foreground lg:table-cell">{t.assigneeName ?? "Unassigned"}</TableCell> : null}
              <TableCell>
                <PriorityBadge priority={t.priority} />
              </TableCell>
              <TableCell className="hidden pr-4 text-sm sm:table-cell">
                {agentView ? <Due t={t} /> : <span className="text-muted-foreground">{formatDistanceToNowStrict(new Date(t.updatedAt), { addSuffix: true })}</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
