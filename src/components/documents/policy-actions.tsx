"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, CheckCircle2, Pencil, Send, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { acknowledgePolicyAction, archivePolicyAction, deletePolicyAction, publishPolicyAction } from "@/app/(app)/documents/actions";
import { useRunAction } from "./use-run-action";

export function PolicyManageActions({ id, status, canDelete, requiresAcknowledgement }: { id: string; status: string; canDelete: boolean; requiresAcknowledgement: boolean }) {
  const router = useRouter();
  const { pending, run } = useRunAction();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "archived" ? (
        <Button asChild variant="outline" size="sm">
          <Link href={`/documents/policies/${id}/edit`}>
            <Pencil data-icon="inline-start" /> Edit
          </Link>
        </Button>
      ) : null}
      {canDelete ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" disabled={pending}>
              <Trash2 data-icon="inline-start" /> Delete draft
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
              <AlertDialogDescription>The draft has never been published. This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => run(() => deletePolicyAction({ id }), { success: "Draft deleted", onSuccess: () => router.push("/documents?tab=policies") })}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
      {status === "published" ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={pending}>
              <Archive data-icon="inline-start" /> Archive
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive this policy?</AlertDialogTitle>
              <AlertDialogDescription>Employees will no longer see it. Acknowledgements are kept and you can restore it later.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => run(() => archivePolicyAction({ id }), { success: "Policy archived" })}>Archive</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : status === "archived" ? <Undo2 data-icon="inline-start" /> : <Send data-icon="inline-start" />}
              {status === "archived" ? "Restore" : "Publish"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{status === "archived" ? "Restore this policy?" : "Publish this policy?"}</AlertDialogTitle>
              <AlertDialogDescription>
                Every employee will be able to read it{requiresAcknowledgement ? " and will be asked to acknowledge it" : ""}. They are notified in the app.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => run(() => publishPolicyAction({ id }), { success: "Policy published" })}>
                {status === "archived" ? "Restore" : "Publish"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

export function AcknowledgePolicy({ id, version }: { id: string; version: number }) {
  const checkboxId = useId();
  const [confirmed, setConfirmed] = useState(false);
  const { pending, run } = useRunAction();
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <label htmlFor={checkboxId} className="flex items-start gap-2.5 text-sm">
        <Checkbox id={checkboxId} checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" />
        <span>I have read and understood this policy (version {version}) and agree to follow it.</span>
      </label>
      <Button
        disabled={!confirmed || pending}
        onClick={() => run(() => acknowledgePolicyAction({ id }), { success: "Thank you. Your acknowledgement is recorded." })}
      >
        {pending ? <Spinner data-icon="inline-start" /> : <CheckCircle2 data-icon="inline-start" />}
        Acknowledge
      </Button>
    </div>
  );
}
