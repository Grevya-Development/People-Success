import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, unstable_rethrow } from "next/navigation";
import { ArrowLeft, Lock, Paperclip, Sparkles } from "lucide-react";
import { cn } from "cn";
import { ErrorState, Page, PageHeader, Reveal, Section, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { assignableUsers, getTicket, type TicketDetail } from "@/server/services/helpdesk/tickets";
import { listTicketCategories } from "@/server/services/helpdesk/categories";
import { canManageHelpdesk } from "@/server/services/helpdesk/rules";
import { formatBytes } from "@/components/documents/format";
import { formatDateTime, formatPercent } from "@/lib/format";
import { PriorityBadge, TicketStatus } from "../_components/ticket-table";
import { AcceptTriageButton, AgentControls, RateTicket, ReopenButton, ReplyBox } from "./ticket-controls";

export const metadata: Metadata = { title: "Ticket" };

export default function TicketPage({ params }: PageProps<"/helpdesk/[id]">) {
  return (
    <Page>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/helpdesk">
          <ArrowLeft data-icon="inline-start" /> Service desk
        </Link>
      </Button>
      <Suspense
        fallback={
          <>
            <PageHeader title={<Skeleton className="h-7 w-80" />} />
            <TableSkeleton rows={5} columns={2} />
          </>
        }
      >
        <TicketContent params={params} />
      </Suspense>
    </Page>
  );
}

function sla(due: string | null, done: string | null) {
  if (!due) return { text: "—", tone: "" };
  const late = done ? new Date(done) > new Date(due) : new Date(due).getTime() < Date.now();
  return { text: `${done ? (late ? "Missed" : "Met") : late ? "Overdue since" : "Due"} ${done ? `(due ${formatDateTime(due)})` : formatDateTime(due)}`, tone: late ? "text-danger" : done ? "text-success" : "" };
}

async function TicketContent({ params }: { params: PageProps<"/helpdesk/[id]">["params"] }) {
  const { id } = await params;
  const ctx = await requireContext();
  let t: TicketDetail;
  try {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    t = await getTicket(ctx, id);
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    logger.error("helpdesk.ticket_load_failed", { err });
    return <ErrorState title="Could not load this ticket" />;
  }
  const [categories, assignees] = t.canWork ? await Promise.all([listTicketCategories(ctx), assignableUsers(ctx, t.id)]) : [[], []];
  const manage = canManageHelpdesk(ctx);
  const categoryOptions = categories.filter((c) => manage || !c.isSensitive || c.id === t.categoryId).map((c) => ({ value: c.id, label: c.name }));
  const assigneeOptions = assignees.map((a) => ({ value: a.userId, label: a.name }));
  const first = sla(t.firstResponseDueAt, t.firstRespondedAt);
  const resolution = sla(t.resolutionDueAt, t.resolvedAt);
  const closed = t.status === "closed";

  return (
    <Reveal className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-5">
        <PageHeader
          eyebrow={
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="tabular">{t.number}</span>
              <TicketStatus status={t.status} />
              <PriorityBadge priority={t.priority} />
              {t.isSensitive ? (
                <span className="inline-flex items-center gap-1">
                  <Lock className="size-3" /> Confidential
                </span>
              ) : null}
            </span>
          }
          title={t.subject}
          description={`${t.categoryName ?? "Uncategorized"} · raised ${formatDateTime(t.createdAt)}${t.channel === "assistant" ? " from the HR assistant" : ""}`}
          className="mb-0"
          actions={t.canReopen ? <ReopenButton ticketId={t.id} /> : null}
        />

        {t.canRate ? (
          <div className="rounded-xl border bg-card px-4 py-3">
            <RateTicket ticketId={t.id} current={t.satisfaction} />
            {t.canReopen ? <p className="mt-1 text-xs text-muted-foreground">Still not sorted? Reopen within 7 days of it being resolved.</p> : null}
          </div>
        ) : null}

        <ol className="space-y-3" aria-label="Conversation">
          <li className="rounded-xl border bg-card p-4">
            <p className="mb-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{t.isRequester ? "You" : (t.requester.name ?? "Requester")}</span> · {formatDateTime(t.createdAt)}
            </p>
            <p className="text-sm whitespace-pre-wrap">{t.description}</p>
            {t.attachments.length ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {t.attachments.map((a) => (
                  <li key={a.id}>
                    <a href={`/helpdesk/attachments/${a.id}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                      <Paperclip className="size-3" /> {a.fileName} <span className="text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
          {t.messages.map((m) => (
            <li
              key={m.id}
              className={cn(
                "rounded-xl border p-4",
                m.isInternal ? "border-warning/30 bg-warning-soft/40" : m.fromRequester ? "bg-card" : "bg-muted/40",
                !m.fromRequester && !m.isInternal && "sm:ml-8",
                m.fromRequester && "sm:mr-8",
              )}
            >
              <p className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{m.mine ? "You" : (m.authorName ?? "HR")}</span>
                {!m.fromRequester ? <span>HR</span> : null}
                <span>· {formatDateTime(m.createdAt)}</span>
                {m.isInternal ? <StatusBadge status="internal" tone="warning" label="Internal note" /> : null}
                {m.aiAssisted && t.canWork ? <StatusBadge status="ai" tone="brand" label="AI-assisted" /> : null}
              </p>
              <p className="text-sm whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ol>

        {closed ? (
          <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            This ticket is closed.{" "}
            <Link href="/helpdesk/new" className="underline underline-offset-2">
              Raise a new ticket
            </Link>{" "}
            if you still need help.
          </p>
        ) : (
          <ReplyBox ticketId={t.id} canWork={t.canWork} status={t.status} />
        )}
      </div>

      <aside className="space-y-4">
        {t.canWork && t.triage ? (
          <Section title={t.triage.model.startsWith("rules") ? "Suggested routing (rules)" : "AI suggestion"}>
            <div className="space-y-2 px-5 py-4 text-sm">
              <p>
                <Sparkles className="mr-1 inline size-3.5 text-brand" />
                {t.triage.categoryName ?? "No category"} · {t.triage.priority ?? "normal"} priority
                <span className="ml-1 text-xs text-muted-foreground">({formatPercent(t.triage.confidence)} confidence)</span>
              </p>
              <p className="text-xs text-muted-foreground">{t.triage.rationale}</p>
              {t.triage.categoryId && t.triage.categoryId !== t.categoryId && !t.triage.model.startsWith("rules:sensitive") ? <AcceptTriageButton ticketId={t.id} /> : null}
            </div>
          </Section>
        ) : null}
        {t.canWork && !closed ? (
          <Section title="Manage">
            <div className="px-5 py-4">
              <AgentControls
                ticketId={t.id}
                status={t.status}
                priority={t.priority}
                categoryId={t.categoryId}
                assigneeUserId={t.assigneeUserId}
                categories={categoryOptions}
                assignees={assigneeOptions}
              />
            </div>
          </Section>
        ) : null}
        <Section title="Details">
          <dl className="divide-y text-sm">
            {t.canWork ? (
              <div className="px-5 py-2.5">
                <dt className="text-xs text-muted-foreground">Requester</dt>
                <dd>
                  {t.requester.employeeId ? (
                    <Link href={`/employees/${t.requester.employeeId}`} className="hover:underline">
                      {t.requester.name}
                    </Link>
                  ) : (
                    t.requester.name
                  )}
                  {t.requester.employeeCode ? <span className="ml-1 text-xs text-muted-foreground tabular">{t.requester.employeeCode}</span> : null}
                </dd>
              </div>
            ) : null}
            <div className="px-5 py-2.5">
              <dt className="text-xs text-muted-foreground">Assigned to</dt>
              <dd>{t.assigneeName ?? "Not yet assigned"}</dd>
            </div>
            <div className="px-5 py-2.5">
              <dt className="text-xs text-muted-foreground">First response</dt>
              <dd className={first.tone}>{t.firstRespondedAt ? formatDateTime(t.firstRespondedAt) : first.text}</dd>
              {t.firstRespondedAt ? <dd className={cn("text-xs", first.tone)}>{first.text}</dd> : null}
            </div>
            <div className="px-5 py-2.5">
              <dt className="text-xs text-muted-foreground">Resolution</dt>
              <dd className={resolution.tone}>{t.resolvedAt ? formatDateTime(t.resolvedAt) : resolution.text}</dd>
              {t.resolvedAt ? <dd className={cn("text-xs", resolution.tone)}>{resolution.text}</dd> : null}
            </div>
            {t.escalated && t.canWork ? (
              <div className="px-5 py-2.5 text-danger">
                <dt className="text-xs">Escalated</dt>
                <dd>SLA breached; helpdesk managers were notified.</dd>
              </div>
            ) : null}
          </dl>
        </Section>
      </aside>
    </Reveal>
  );
}
