import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { cn } from "cn";
import { EmptyState, ErrorState, NoAccess, Reveal } from "@/components/page";
import { Button } from "@/components/ui/button";
import type { RequestContext } from "@/server/auth/context";
import { logger } from "@/server/lib/logger";
import { listTicketCategories } from "@/server/services/helpdesk/categories";
import { listQueue, queueAccess, queueCounts } from "@/server/services/helpdesk/tickets";
import { QUEUE_VIEWS, TICKET_STATUSES, TICKET_STATUS_LABELS, queueFilterSchema, type QueueView } from "@/lib/validation/helpdesk";
import { TicketTable } from "./ticket-table";

const VIEW_LABELS: Record<QueueView, string> = { mine: "Assigned to me", unassigned: "Unassigned", overdue: "Overdue", all: "All open" };

const selectClass =
  "h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export async function Queue({ ctx, view, status, category }: { ctx: RequestContext; view?: string; status?: string; category?: string }) {
  const access = await queueAccess(ctx);
  if (!access) return <NoAccess />;
  const parsed = queueFilterSchema.safeParse({ view: view ?? (access === "agent" ? "all" : "mine"), status: status || undefined, categoryId: category || undefined });
  const filter = parsed.success ? parsed.data : queueFilterSchema.parse({});
  let data;
  try {
    data = await Promise.all([listQueue(ctx, filter), queueCounts(ctx), listTicketCategories(ctx)]);
  } catch (err) {
    unstable_rethrow(err);
    logger.error("helpdesk.queue_failed", { err });
    return <ErrorState title="Could not load the queue" />;
  }
  const [rows, counts, categories] = data;
  const href = (v: QueueView) => `/helpdesk?tab=queue&view=${v}${filter.status ? `&status=${filter.status}` : ""}${filter.categoryId ? `&category=${filter.categoryId}` : ""}`;

  return (
    <Reveal className="space-y-4">
      {access === "agent" ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <nav aria-label="Queue views" className="flex flex-wrap gap-1.5">
            {QUEUE_VIEWS.map((v) => (
              <Link
                key={v}
                href={href(v)}
                scroll={false}
                aria-current={filter.view === v ? "page" : undefined}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium text-muted-foreground hover:text-foreground",
                  filter.view === v && "border-foreground/20 bg-muted text-foreground",
                  v === "overdue" && counts?.overdue ? "text-danger" : null,
                )}
              >
                {VIEW_LABELS[v]}
                {counts ? <span className="tabular">{counts[v]}</span> : null}
              </Link>
            ))}
          </nav>
          <form method="get" className="flex flex-wrap items-end gap-2" aria-label="Filter queue">
            <input type="hidden" name="tab" value="queue" />
            <input type="hidden" name="view" value={filter.view} />
            <select name="status" defaultValue={filter.status ?? "active"} className={selectClass} aria-label="Status">
              <option value="active">Open statuses</option>
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TICKET_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <select name="category" defaultValue={filter.categoryId ?? ""} className={selectClass} aria-label="Category">
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" variant="outline">
              Apply
            </Button>
          </form>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Tickets in your queues are assigned to you automatically because of your role.</p>
      )}
      {rows.length ? (
        <TicketTable tickets={rows} agentView />
      ) : (
        <EmptyState icon={CheckCircle2} title="Nothing here" description={filter.view === "overdue" ? "No tickets are past their SLA." : "No tickets match this view."} />
      )}
    </Reveal>
  );
}
