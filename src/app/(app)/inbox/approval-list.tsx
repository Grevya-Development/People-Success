"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/status-badge";
import type { InboxApproval } from "@/server/services/inbox";
import { decideAction, withdrawAction } from "./actions";
import { RelativeTime } from "@/components/relative-time";

export function ApprovalList({ items, highlight }: { items: InboxApproval[]; highlight?: string }) {
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {items.map((a) => (
        <ApprovalRow key={a.requestId} item={a} highlighted={a.requestId === highlight} />
      ))}
    </ul>
  );
}

function ApprovalRow({ item, highlighted }: { item: InboxApproval; highlighted: boolean }) {
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      if (!decision) return;
      const res = await decideAction({ requestId: item.requestId, decision, comment: comment || null });
      if (res.ok) {
        toast.success(decision === "approve" ? (res.data.status === "approved" ? "Approved" : "Approved, sent to the next step") : "Rejected");
        setDecision(null);
        setComment("");
      } else toast.error(res.error.message);
    });

  const withdraw = () =>
    start(async () => {
      const res = await withdrawAction({ requestId: item.requestId });
      if (res.ok) toast.success("Request withdrawn");
      else toast.error(res.error.message);
    });

  return (
    <li className={cn("flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center", highlighted && "bg-brand-soft/40")}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">{item.subjectLabel}</span>
          <StatusBadge status={item.status} />
        </div>
        <Link href={item.href} className="mt-0.5 block truncate font-medium hover:underline">
          {item.title}
        </Link>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {item.requestedByName ? `Requested by ${item.requestedByName}` : null}
          {item.requestedForName && item.requestedForName !== item.requestedByName ? ` for ${item.requestedForName}` : null}
          {" · "}
          <RelativeTime value={item.createdAt} />
        </p>
        <ol className="mt-2 flex flex-wrap items-center gap-1 text-xs" aria-label="Approval steps">
          {item.steps.map((s, i) => (
            <li key={s.stepNo} className="flex items-center gap-1">
              {i > 0 ? <ChevronRight className="size-3 text-muted-foreground" /> : null}
              <span
                className={cn(
                  "rounded-full px-2 py-0.5",
                  s.status === "approved" && "bg-success-soft text-success",
                  s.status === "rejected" && "bg-danger-soft text-danger",
                  s.status === "pending" && "bg-warning-soft text-warning",
                  s.status === "cancelled" && "bg-muted text-muted-foreground",
                )}
                title={s.comment ?? undefined}
              >
                {s.name}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex shrink-0 gap-2">
        {item.canDecide ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setDecision("reject")} disabled={pending}>
              <X /> Reject
            </Button>
            <Button size="sm" onClick={() => setDecision("approve")} disabled={pending}>
              <Check /> Approve
            </Button>
          </>
        ) : null}
        {item.canCancel ? (
          <Button size="sm" variant="ghost" onClick={withdraw} disabled={pending}>
            Withdraw
          </Button>
        ) : null}
      </div>

      <Dialog open={decision !== null} onOpenChange={(o) => !o && setDecision(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{decision === "approve" ? "Approve request" : "Reject request"}</DialogTitle>
            <DialogDescription>{item.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor={`comment-${item.requestId}`}>
              Comment {decision === "reject" ? <span className="text-destructive">*</span> : <span className="text-muted-foreground">(optional)</span>}
            </Label>
            <Textarea id={`comment-${item.requestId}`} value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending || (decision === "reject" && !comment.trim())} variant={decision === "reject" ? "destructive" : "default"}>
              {pending ? <Spinner /> : null}
              {decision === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
