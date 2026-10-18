"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { EyeOff, Pencil, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Spinner } from "@/components/ui/spinner";
import { useRunAction } from "@/components/documents/use-run-action";
import { deleteKbArticleAction, publishKbArticleAction, unpublishKbArticleAction } from "../../actions";

export function KbManageActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const published = status === "published";
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline" size="sm">
        <Link href={`/helpdesk/kb/${id}/edit`}>
          <Pencil data-icon="inline-start" /> Edit
        </Link>
      </Button>
      {published ? (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => unpublishKbArticleAction({ id }), { success: "Unpublished and removed from the assistant" })}>
          {pending ? <Spinner /> : <EyeOff data-icon="inline-start" />} Unpublish
        </Button>
      ) : (
        <>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" disabled={pending}>
                <Trash2 data-icon="inline-start" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
                <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => run(() => deleteKbArticleAction({ id }), { success: "Article deleted", onSuccess: () => router.push("/helpdesk?tab=kb") })}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button size="sm" disabled={pending} onClick={() => run(() => publishKbArticleAction({ id }), { success: "Published and indexed for the assistant" })}>
            {pending ? <Spinner /> : <Send data-icon="inline-start" />} Publish
          </Button>
        </>
      )}
    </div>
  );
}
