"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRightLeft, CalendarClock, ChevronDown, MoreHorizontal, Sparkles, Star, UserRoundCheck } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRunAction } from "@/components/documents/use-run-action";
import { formatDate, titleCase } from "@/lib/format";
import { formatIst, SOURCE_LABELS } from "@/lib/validation/recruitment";
import type { Board, BoardCard } from "@/server/services/recruitment/applications";
import { moveStageAction, rejectApplicationAction, reopenApplicationAction, withdrawApplicationAction } from "../actions";

type Stage = Board["stages"][number];

/* ------------------------------------------------------------------ */
/* Reject / withdraw                                                   */
/* ------------------------------------------------------------------ */

export function rejectionTemplate(firstName: string, jobTitle: string, company: string) {
  return `Dear ${firstName},\n\nThank you for the time you invested in applying for the ${jobTitle} role. After careful consideration, we have decided not to take your application further at this time.\n\nWe appreciate your interest in ${company} and wish you the very best.`;
}

export function RejectDialog({
  open,
  onOpenChange,
  applicationId,
  candidateName,
  jobTitle,
  companyName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  applicationId: string;
  candidateName: string;
  jobTitle: string;
  companyName: string;
}) {
  const { pending, run } = useRunAction();
  const [reason, setReason] = useState("");
  const [sendEmail, setSendEmail] = useState(false);
  const [body, setBody] = useState(() => rejectionTemplate(candidateName.split(" ")[0] ?? candidateName, jobTitle, companyName));
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reject {candidateName}?</DialogTitle>
          <DialogDescription>The reason stays internal. Scheduled interviews are cancelled. Nothing is sent to the candidate unless you choose to.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="reject-reason">
              Reason<span className="text-destructive" aria-hidden>*</span>
            </FieldLabel>
            <Textarea id="reject-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Role needs production Kubernetes experience" />
            <FieldDescription>Job-related reasons only.</FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <Checkbox id="reject-email" checked={sendEmail} onCheckedChange={(v) => setSendEmail(v === true)} />
            <FieldLabel htmlFor="reject-email" className="font-normal">
              Send a rejection email to the candidate
            </FieldLabel>
          </Field>
          {sendEmail ? (
            <Field>
              <FieldLabel htmlFor="reject-body">Email</FieldLabel>
              <Textarea id="reject-body" rows={7} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} />
            </Field>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending || reason.trim().length < 3 || (sendEmail && body.trim().length < 10)}
            onClick={() =>
              run(() => rejectApplicationAction({ applicationId, reason: reason.trim(), sendEmail, emailBody: sendEmail ? body : null }), {
                success: sendEmail ? "Rejected and email queued" : "Application rejected",
                onSuccess: () => onOpenChange(false),
              })
            }
          >
            {pending ? <Spinner /> : null}
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WithdrawDialog({ open, onOpenChange, applicationId, candidateName }: { open: boolean; onOpenChange: (o: boolean) => void; applicationId: string; candidateName: string }) {
  const { pending, run } = useRunAction();
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark {candidateName} as withdrawn?</DialogTitle>
          <DialogDescription>Use this when the candidate pulls out. You can reopen the application later.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="withdraw-reason">Note</FieldLabel>
          <Textarea id="withdraw-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Accepted another offer" />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => run(() => withdrawApplicationAction({ applicationId, reason: reason.trim() || null }), { success: "Marked as withdrawn", onSuccess: () => onOpenChange(false) })}>
            {pending ? <Spinner /> : null}
            Mark withdrawn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Move menu (keyboard accessible)                                     */
/* ------------------------------------------------------------------ */

export function MoveMenu({
  card,
  stages,
  jobTitle,
  companyName,
  trigger = "icon",
}: {
  card: Pick<BoardCard, "applicationId" | "stageId" | "status" | "name">;
  stages: Stage[];
  jobTitle: string;
  companyName: string;
  trigger?: "icon" | "button";
}) {
  const { pending, run } = useRunAction();
  const [reject, setReject] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  if (card.status !== "active") return null;
  const targets = stages.filter((s) => s.id !== card.stageId && s.kind !== "hired");
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {trigger === "icon" ? (
            <Button size="icon-xs" variant="ghost" aria-label={`Actions for ${card.name}`} disabled={pending}>
              {pending ? <Spinner /> : <MoreHorizontal />}
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={pending}>
              {pending ? <Spinner /> : <ArrowRightLeft />} Move to… <ChevronDown />
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>Move to…</DropdownMenuLabel>
          {targets.map((s) => (
            <DropdownMenuItem key={s.id} onSelect={() => run(() => moveStageAction({ applicationId: card.applicationId, stageId: s.id, note: null }), { success: `Moved to ${s.name}` })}>
              {s.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setWithdraw(true)}>Candidate withdrew…</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setReject(true)}>
            Reject…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {reject ? <RejectDialog open={reject} onOpenChange={setReject} applicationId={card.applicationId} candidateName={card.name} jobTitle={jobTitle} companyName={companyName} /> : null}
      {withdraw ? <WithdrawDialog open={withdraw} onOpenChange={setWithdraw} applicationId={card.applicationId} candidateName={card.name} /> : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Board                                                               */
/* ------------------------------------------------------------------ */

function CardMeta({ c }: { c: BoardCard }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
      <span>{formatDate(c.appliedAt, "dd MMM")}</span>
      <span>· {SOURCE_LABELS[c.source] ?? titleCase(c.source)}</span>
      {c.averageRating != null ? (
        <span className="inline-flex items-center gap-0.5 tabular">
          · <Star className="size-3" aria-hidden /> {c.averageRating.toFixed(1)}
        </span>
      ) : null}
      {c.nextInterviewAt ? (
        <span className="inline-flex items-center gap-0.5">
          · <CalendarClock className="size-3" aria-hidden /> {formatIst(c.nextInterviewAt, { withZone: false })}
        </span>
      ) : null}
      {c.hasAiSummary ? (
        <span className="inline-flex items-center gap-0.5" title="Job match summary available">
          · <Sparkles className="size-3" aria-hidden /> Match notes
        </span>
      ) : null}
    </div>
  );
}

export function PipelineBoard({ board, canManage, jobTitle, companyName }: { board: Board; canManage: boolean; jobTitle: string; companyName: string }) {
  const { pending, run } = useRunAction();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const byStage = (id: string) => board.cards.filter((c) => c.stageId === id);

  const drop = (stage: Stage) => {
    const card = board.cards.find((c) => c.applicationId === dragging);
    setDragging(null);
    setOver(null);
    if (!card || card.stageId === stage.id || card.status !== "active" || stage.kind === "hired") return;
    run(() => moveStageAction({ applicationId: card.applicationId, stageId: stage.id, note: null }), { success: `Moved to ${stage.name}` });
  };

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0" aria-busy={pending}>
      <p className="mb-2 text-xs text-muted-foreground">
        Cards are in the order they entered each stage. {canManage ? "Use the ⋯ menu (keyboard friendly) or drag a card to move it." : null}
      </p>
      <ol className="flex min-w-max gap-3" aria-label="Pipeline stages">
        {board.stages.map((s) => {
          const cards = byStage(s.id);
          const droppable = canManage && s.kind !== "hired";
          return (
            <li
              key={s.id}
              className={cn("flex w-64 shrink-0 flex-col rounded-xl border bg-muted/40", over === s.id && "ring-2 ring-ring/50")}
              onDragOver={droppable && dragging ? (e) => (e.preventDefault(), setOver(s.id)) : undefined}
              onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
              onDrop={droppable ? () => drop(s) : undefined}
              aria-label={`${s.name}: ${cards.length} candidate${cards.length === 1 ? "" : "s"}`}
            >
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-sm font-medium">{s.name}</span>
                <span className="rounded-full bg-background px-1.5 text-xs text-muted-foreground tabular">{cards.length}</span>
              </div>
              <ul className="flex min-h-24 flex-col gap-2 px-2 pb-2">
                {cards.map((c) => (
                  <li
                    key={c.applicationId}
                    draggable={canManage && c.status === "active"}
                    onDragStart={() => setDragging(c.applicationId)}
                    onDragEnd={() => setDragging(null)}
                    className={cn("rounded-lg border bg-card p-3 shadow-xs", dragging === c.applicationId && "opacity-50", canManage && c.status === "active" && "cursor-grab")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/recruitment/candidates/${c.candidateId}`} className="block truncate text-sm font-medium hover:underline">
                          {c.name}
                        </Link>
                        <div className="truncate text-xs text-muted-foreground">{[c.currentTitle, c.currentCompany].filter(Boolean).join(" · ") || "—"}</div>
                      </div>
                      {canManage ? <MoveMenu card={c} stages={board.stages} jobTitle={jobTitle} companyName={companyName} /> : null}
                      {c.status === "hired" ? <UserRoundCheck className="size-4 text-success" aria-label="Hired" /> : null}
                    </div>
                    <CardMeta c={c} />
                    {c.referred || c.tags.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.referred ? <StatusBadge status="referral" tone="brand" /> : null}
                        {c.tags.slice(0, 2).map((t) => (
                          <StatusBadge key={t} status={t} tone={t === "possible-duplicate" ? "warning" : "neutral"} className="normal-case" />
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
                {!cards.length ? <li className="px-1 py-3 text-center text-xs text-muted-foreground">No candidates</li> : null}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Table view and closed applications                                  */
/* ------------------------------------------------------------------ */

export function PipelineTable({ board, canManage, jobTitle, companyName }: { board: Board; canManage: boolean; jobTitle: string; companyName: string }) {
  const stageName = new Map(board.stages.map((s) => [s.id, s.name]));
  const order = new Map(board.stages.map((s, i) => [s.id, i]));
  const rows = [...board.cards].sort((a, b) => (order.get(a.stageId) ?? 0) - (order.get(b.stageId) ?? 0));
  if (!rows.length) return <p className="rounded-xl border bg-card px-5 py-8 text-center text-sm text-muted-foreground">No candidates in the pipeline yet.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Candidate</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Applied</TableHead>
            <TableHead>In stage since</TableHead>
            <TableHead>Source</TableHead>
            <TableHead className="text-right">Rating</TableHead>
            {canManage ? <TableHead className="w-40" /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.applicationId}>
              <TableCell className="min-w-48">
                <Link href={`/recruitment/candidates/${c.candidateId}`} className="font-medium hover:underline">
                  {c.name}
                </Link>
                <div className="text-xs text-muted-foreground">{[c.currentTitle, c.currentCompany].filter(Boolean).join(" · ")}</div>
              </TableCell>
              <TableCell>{c.status === "hired" ? <StatusBadge status="hired" /> : stageName.get(c.stageId)}</TableCell>
              <TableCell className="text-muted-foreground">{formatDate(c.appliedAt)}</TableCell>
              <TableCell className="text-muted-foreground">{formatDate(c.stageEnteredAt)}</TableCell>
              <TableCell className="text-muted-foreground">{SOURCE_LABELS[c.source] ?? titleCase(c.source)}</TableCell>
              <TableCell className="text-right tabular">{c.averageRating?.toFixed(1) ?? "—"}</TableCell>
              {canManage ? (
                <TableCell className="text-right">
                  <MoveMenu card={c} stages={board.stages} jobTitle={jobTitle} companyName={companyName} trigger="button" />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ClosedApplications({ cards, canManage }: { cards: BoardCard[]; canManage: boolean }) {
  const { pending, run } = useRunAction();
  if (!cards.length) return null;
  return (
    <details className="rounded-xl border bg-card">
      <summary className="cursor-pointer px-5 py-3 text-sm font-medium">
        Rejected and withdrawn <span className="text-muted-foreground tabular">({cards.length})</span>
      </summary>
      <ul className="divide-y border-t">
        {cards.map((c) => (
          <li key={c.applicationId} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
            <span className="min-w-0">
              <Link href={`/recruitment/candidates/${c.candidateId}`} className="font-medium hover:underline">
                {c.name}
              </Link>{" "}
              <StatusBadge status={c.status} className="ml-1" />
            </span>
            {canManage ? (
              <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => reopenApplicationAction({ applicationId: c.applicationId }), { success: "Application reopened" })}>
                Reopen
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
