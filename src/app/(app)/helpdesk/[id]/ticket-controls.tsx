"use client";

import { useId, useState, useTransition } from "react";
import { RotateCcw, Sparkles, Star, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { useRunAction } from "@/components/documents/use-run-action";
import { TICKET_PRIORITIES, TICKET_STATUSES, TICKET_STATUS_LABELS, type TicketPriority, type TicketStatus } from "@/lib/validation/helpdesk";
import { titleCase } from "@/lib/format";
import { acceptTriageAction, draftReplyAction, rateTicketAction, reopenTicketAction, replyAction, updateTicketAction } from "../actions";

const KEEP = "__keep__";

export function ReplyBox({ ticketId, canWork, status }: { ticketId: string; canWork: boolean; status: TicketStatus }) {
  const id = useId();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [nextStatus, setNextStatus] = useState<string>(KEEP);
  const [aiAssisted, setAiAssisted] = useState(false);
  const [draftInfo, setDraftInfo] = useState<{ note: string | null; source: "ai" | "rules"; sources: { title: string; heading: string | null; href: string }[] } | null>(null);
  const [sending, startSend] = useTransition();
  const [drafting, startDraft] = useTransition();

  const draft = () =>
    startDraft(async () => {
      const r = await draftReplyAction({ id: ticketId });
      if (!r.ok) return void toast.error(r.error.message);
      setBody(r.data.body);
      setAiAssisted(true);
      setInternal(false);
      setDraftInfo({ note: r.data.note, source: r.data.source, sources: r.data.sources });
    });

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return void toast.error("Write a reply first");
    startSend(async () => {
      const r = await replyAction({
        ticketId,
        body,
        internal: canWork && internal,
        aiAssisted: canWork && aiAssisted && !internal,
        status: canWork && nextStatus !== KEEP ? (nextStatus as TicketStatus) : undefined,
      });
      if (!r.ok) return void toast.error(r.error.message);
      toast.success(internal ? "Internal note added" : "Reply sent");
      setBody("");
      setAiAssisted(false);
      setDraftInfo(null);
      setNextStatus(KEEP);
      setInternal(false);
    });
  };

  return (
    <form onSubmit={send} className={cn("rounded-xl border bg-card p-4", internal && "border-warning/40 bg-warning-soft/30")}>
      <label htmlFor={`${id}-body`} className="sr-only">
        {internal ? "Internal note" : "Reply"}
      </label>
      <Textarea
        id={`${id}-body`}
        rows={draftInfo ? 10 : 4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={internal ? "Internal note — only HR can see this" : canWork ? "Reply to the employee" : "Add a reply for HR"}
      />
      {draftInfo ? (
        <div className="mt-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          <p>
            {draftInfo.source === "ai" ? "Drafted by AI from the ticket and published policies — review before sending." : (draftInfo.note ?? "Rule-based draft.")}
          </p>
          {draftInfo.sources.length ? (
            <p className="mt-1">
              Sources:{" "}
              {draftInfo.sources.map((s, i) => (
                <a key={s.href + i} href={s.href} target="_blank" rel="noopener" className="underline underline-offset-2">
                  {s.title}
                  {s.heading && s.heading !== s.title ? ` — ${s.heading}` : ""}
                  {i < draftInfo.sources.length - 1 ? ", " : ""}
                </a>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {canWork ? (
            <>
              <Field orientation="horizontal" className="w-auto">
                <Switch id={`${id}-internal`} checked={internal} onCheckedChange={setInternal} />
                <FieldLabel htmlFor={`${id}-internal`} className="font-normal">
                  Internal note
                </FieldLabel>
              </Field>
              <Select value={nextStatus} onValueChange={setNextStatus}>
                <SelectTrigger size="sm" className="w-48" aria-label="Status after sending">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP}>Keep status ({TICKET_STATUS_LABELS[status]})</SelectItem>
                  {TICKET_STATUSES.filter((s) => s !== status).map((s) => (
                    <SelectItem key={s} value={s}>
                      Set to {TICKET_STATUS_LABELS[s].toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          ) : null}
        </div>
        <div className="flex gap-2">
          {canWork && !internal ? (
            <Button type="button" variant="outline" size="sm" onClick={draft} disabled={drafting}>
              {drafting ? <Spinner /> : <Wand2 data-icon="inline-start" />} Draft reply
            </Button>
          ) : null}
          <Button type="submit" size="sm" disabled={sending}>
            {sending ? <Spinner /> : null} {internal ? "Add note" : "Send"}
          </Button>
        </div>
      </div>
    </form>
  );
}

type Option = { value: string; label: string };

export function AgentControls({
  ticketId,
  status,
  priority,
  categoryId,
  assigneeUserId,
  categories,
  assignees,
}: {
  ticketId: string;
  status: TicketStatus;
  priority: TicketPriority;
  categoryId: string | null;
  assigneeUserId: string | null;
  categories: Option[];
  assignees: Option[];
}) {
  const id = useId();
  const { pending, run } = useRunAction();
  const update = (patch: Parameters<typeof updateTicketAction>[0]) => run(() => updateTicketAction(patch), { success: "Ticket updated" });
  const UNASSIGNED = "__none__";
  return (
    <div className={cn("space-y-3", pending && "opacity-70")}>
      <Field>
        <FieldLabel htmlFor={`${id}-status`}>Status</FieldLabel>
        <Select value={status} onValueChange={(v) => update({ id: ticketId, status: v as TicketStatus })}>
          <SelectTrigger id={`${id}-status`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TICKET_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {TICKET_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-priority`}>Priority</FieldLabel>
        <Select value={priority} onValueChange={(v) => update({ id: ticketId, priority: v as TicketPriority })}>
          <SelectTrigger id={`${id}-priority`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TICKET_PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {titleCase(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-category`}>Category</FieldLabel>
        <Select value={categoryId ?? ""} onValueChange={(v) => update({ id: ticketId, categoryId: v })}>
          <SelectTrigger id={`${id}-category`} className="w-full">
            <SelectValue placeholder="Uncategorized" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-assignee`}>Assignee</FieldLabel>
        <Select value={assigneeUserId ?? UNASSIGNED} onValueChange={(v) => update({ id: ticketId, assigneeUserId: v === UNASSIGNED ? null : v })}>
          <SelectTrigger id={`${id}-assignee`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
            {assignees.map((a) => (
              <SelectItem key={a.value} value={a.value}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

export function AcceptTriageButton({ ticketId }: { ticketId: string }) {
  const { pending, run } = useRunAction();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => acceptTriageAction({ id: ticketId }), { success: "Suggestion applied" })}>
      {pending ? <Spinner /> : <Sparkles data-icon="inline-start" />} Accept suggestion
    </Button>
  );
}

export function ReopenButton({ ticketId }: { ticketId: string }) {
  const { pending, run } = useRunAction();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reopenTicketAction({ id: ticketId }), { success: "Ticket reopened" })}>
      {pending ? <Spinner /> : <RotateCcw data-icon="inline-start" />} Reopen
    </Button>
  );
}

export function RateTicket({ ticketId, current }: { ticketId: string; current: number | null }) {
  const [value, setValue] = useState(current);
  const [hover, setHover] = useState<number | null>(null);
  const { pending, run } = useRunAction();
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">{value ? "Your rating" : "How did we do?"}</span>
      <div role="radiogroup" aria-label="Rate the help you received" className="flex" onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            disabled={pending}
            onMouseEnter={() => setHover(n)}
            onClick={() => run(() => rateTicketAction({ id: ticketId, rating: n }), { success: "Thanks for the feedback", onSuccess: () => setValue(n) })}
            className="rounded p-0.5 text-muted-foreground hover:text-warning focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Star className={cn("size-5", (hover ?? value ?? 0) >= n && "fill-warning text-warning")} />
          </button>
        ))}
      </div>
    </div>
  );
}
