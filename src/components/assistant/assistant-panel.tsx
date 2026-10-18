"use client";

import { RelativeTime } from "@/components/relative-time";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { ArrowUp, BookOpen, History, LifeBuoy, MessageSquarePlus, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Markdown } from "@/components/documents/markdown";
import type { AssistantMessage } from "@/server/services/assistant/conversations";
import {
  askAssistantAction,
  assistantFeedbackAction,
  getConversationAction,
  listConversationsAction,
  raiseTicketFromAssistantAction,
} from "./actions";

type Conversation = { id: string; title: string; updatedAt: string };

const SUGGESTIONS = ["How many days of casual leave do I get?", "What is the reimbursement limit for meals?", "How do I download my Form 16?"];

export function AssistantPanel({ onNavigate }: { onNavigate: () => void }) {
  const inputId = useId();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [asking, startAsk] = useTransition();
  const [loading, startLoad] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const refreshList = useCallback(() => {
    void listConversationsAction({}).then((r) => {
      if (r.ok) setConversations(r.data);
    });
  }, []);

  useEffect(() => {
    refreshList();
    inputRef.current?.focus();
  }, [refreshList]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pendingQuestion]);

  const open = (id: string) =>
    startLoad(async () => {
      const r = await getConversationAction({ id });
      if (!r.ok) return void toast.error(r.error.message);
      setConversationId(r.data.id);
      setMessages(r.data.messages);
    });

  const reset = () => {
    setConversationId(null);
    setMessages([]);
    setDraft("");
    inputRef.current?.focus();
  };

  const ask = (question: string) => {
    const q = question.trim();
    if (q.length < 3 || asking) return;
    setDraft("");
    setPendingQuestion(q);
    startAsk(async () => {
      const r = await askAssistantAction({ conversationId, question: q });
      setPendingQuestion(null);
      if (!r.ok) {
        setDraft(q);
        toast.error(r.error.message);
        return;
      }
      setConversationId(r.data.conversationId);
      setMessages((m) => [...m, r.data.userMessage, r.data.assistantMessage]);
      refreshList();
    });
  };

  const update = (id: string, patch: Partial<AssistantMessage>) => setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <DropdownMenu onOpenChange={(o) => o && refreshList()}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <History data-icon="inline-start" /> Recent
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>Your conversations</DropdownMenuLabel>
            {conversations === null ? (
              <div className="flex justify-center p-3">
                <Spinner />
              </div>
            ) : conversations.length ? (
              conversations.map((c) => (
                <DropdownMenuItem key={c.id} onSelect={() => open(c.id)} className="flex flex-col items-start gap-0">
                  <span className="line-clamp-1">{c.title}</span>
                  <span className="text-xs text-muted-foreground"><RelativeTime value={c.updatedAt} /></span>
                </DropdownMenuItem>
              ))
            ) : (
              <p className="px-2 py-3 text-sm text-muted-foreground">No conversations yet.</p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="sm" onClick={reset} disabled={!messages.length && !conversationId}>
          <MessageSquarePlus data-icon="inline-start" /> New chat
        </Button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite" aria-busy={asking || loading}>
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : !messages.length && !pendingQuestion ? (
          <div className="space-y-4 py-6 text-center">
            <BookOpen className="mx-auto size-8 text-muted-foreground" aria-hidden />
            <div>
              <p className="font-medium">Ask about your company&apos;s HR policies</p>
              <p className="mt-1 text-sm text-muted-foreground">Answers quote your published policies and link to them. For anything personal or sensitive, I&apos;ll help you raise a ticket with HR.</p>
            </div>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} className="rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m) => (m.role === "user" ? <UserBubble key={m.id} text={m.content} /> : <AssistantBubble key={m.id} message={m} onNavigate={onNavigate} onChange={(p) => update(m.id, p)} />))}
            {pendingQuestion ? (
              <>
                <UserBubble text={pendingQuestion} />
                <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                  <span className="flex gap-1" aria-hidden>
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.2s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.1s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
                  </span>
                  Searching your company&apos;s policies…
                </div>
              </>
            ) : null}
          </>
        )}
      </div>

      <form
        className="border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          ask(draft);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Ask a question
        </label>
        <div className="flex items-end gap-2">
          <Textarea
            id={inputId}
            ref={inputRef}
            rows={2}
            value={draft}
            maxLength={1000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(draft);
              }
            }}
            placeholder="e.g. Can I carry forward unused leave?"
            className="max-h-40 min-h-10 resize-none"
          />
          <Button type="submit" size="icon" disabled={asking || draft.trim().length < 3} aria-label="Send question">
            {asking ? <Spinner /> : <ArrowUp />}
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">Enter to send · Shift+Enter for a new line. Don&apos;t share passwords or ID numbers.</p>
      </form>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground">{text}</p>
    </div>
  );
}

function AssistantBubble({ message: m, onNavigate, onChange }: { message: AssistantMessage; onNavigate: () => void; onChange: (patch: Partial<AssistantMessage>) => void }) {
  const [raising, startRaise] = useTransition();
  const [, startFeedback] = useTransition();
  const notAnswered = m.outcome !== "answered";

  const raise = () =>
    startRaise(async () => {
      const r = await raiseTicketFromAssistantAction({ messageId: m.id });
      if (!r.ok) return void toast.error(r.error.message);
      onChange({ ticket: { id: r.data.ticketId, number: r.data.number }, outcome: "escalated" });
      toast.success(r.data.alreadyRaised ? `Already raised as ${r.data.number}` : `Ticket ${r.data.number} raised. HR will reply in the service desk.`);
    });

  const feedback = (value: 1 | -1) => {
    const next = m.feedback === value ? 0 : value;
    onChange({ feedback: next || null });
    startFeedback(async () => {
      const r = await assistantFeedbackAction({ messageId: m.id, value: next as 0 | 1 | -1 });
      if (!r.ok) toast.error(r.error.message);
    });
  };

  return (
    <div className="space-y-2">
      <div className={cn("rounded-2xl rounded-bl-sm border px-3.5 py-2.5 text-sm", notAnswered ? "border-warning/30 bg-warning-soft/40" : "bg-card")}>
        {m.source === "rules" ? <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Rule-based: quoted from your policies (AI unavailable)</p> : null}
        <div className="[&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm [&_p]:text-sm">
          <Markdown source={m.content} />
        </div>
      </div>
      {m.citations.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Sources">
          {m.citations.map((c) => (
            <li key={c.chunkId}>
              <Link
                href={c.href}
                onClick={onNavigate}
                className="inline-flex max-w-full items-center gap-1 rounded-full border bg-brand-soft px-2.5 py-0.5 text-xs text-brand hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                title={`${c.title}${c.heading ? ` — ${c.heading}` : ""} (version ${c.version})`}
              >
                <BookOpen className="size-3 shrink-0" />
                <span className="truncate">
                  {c.title}
                  {c.heading && c.heading !== c.title ? ` › ${c.heading}` : ""}
                </span>
                <span className="text-brand/70">v{c.version}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {m.ticket ? (
          <Link href={`/helpdesk/${m.ticket.id}`} onClick={onNavigate} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
            <LifeBuoy className="size-3.5" /> Ticket {m.ticket.number} raised — view
          </Link>
        ) : notAnswered ? (
          <Button size="xs" variant="outline" onClick={raise} disabled={raising}>
            {raising ? <Spinner /> : <LifeBuoy data-icon="inline-start" />} Raise HR ticket
          </Button>
        ) : null}
        {m.outcome === "answered" ? (
          <span className="ml-auto flex items-center gap-0.5">
            <span className="sr-only">Was this helpful?</span>
            <Button size="icon-xs" variant="ghost" aria-label="Helpful" aria-pressed={m.feedback === 1} onClick={() => feedback(1)} className={cn(m.feedback === 1 && "text-success")}>
              <ThumbsUp />
            </Button>
            <Button size="icon-xs" variant="ghost" aria-label="Not helpful" aria-pressed={m.feedback === -1} onClick={() => feedback(-1)} className={cn(m.feedback === -1 && "text-danger")}>
              <ThumbsDown />
            </Button>
          </span>
        ) : null}
      </div>
    </div>
  );
}
