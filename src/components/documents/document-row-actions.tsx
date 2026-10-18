"use client";

import { useId, useState } from "react";
import { BadgeCheck, Download, FileUp, MoreHorizontal, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import type { DocumentCategory } from "@/lib/validation/documents";
import { deleteDocumentAction, updateRetentionAction, verifyDocumentAction } from "@/app/(app)/documents/actions";
import { UploadDocumentDialog, type UploadTarget } from "./upload-document-dialog";
import { useRunAction } from "./use-run-action";

export type RowDocument = {
  id: string;
  title: string;
  category: DocumentCategory;
  verifiedAt: string | null;
  legalHold: boolean;
  retainUntil: string | null;
};

type Props = {
  doc: RowDocument;
  manage: boolean;
  /** Can upload a replacement version (HR, or the employee for their own uploads). */
  canReplace: boolean;
  target: UploadTarget;
  categories: readonly DocumentCategory[];
};

export const downloadHref = (id: string) => `/api/documents/${id}/download`;

export function DocumentRowActions({ doc, manage, canReplace, target, categories }: Props) {
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [retentionOpen, setRetentionOpen] = useState(false);
  const { pending, run } = useRunAction();
  const hasMenu = manage || canReplace;

  return (
    <div className="flex items-center justify-end gap-1">
      <Button asChild variant="ghost" size="icon-sm">
        <a href={downloadHref(doc.id)} aria-label={`Download ${doc.title}`} title="Download">
          <Download />
        </a>
      </Button>
      {hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${doc.title}`} disabled={pending}>
              {pending ? <Spinner /> : <MoreHorizontal />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {canReplace ? (
              <DropdownMenuItem onSelect={() => setReplaceOpen(true)}>
                <FileUp /> Upload new version
              </DropdownMenuItem>
            ) : null}
            {manage && !doc.verifiedAt ? (
              <DropdownMenuItem onSelect={() => run(() => verifyDocumentAction({ id: doc.id }), { success: "Marked as verified" })}>
                <BadgeCheck /> Mark verified
              </DropdownMenuItem>
            ) : null}
            {manage ? (
              <DropdownMenuItem onSelect={() => setRetentionOpen(true)}>
                <ShieldAlert /> Retention & legal hold
              </DropdownMenuItem>
            ) : null}
            {manage ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={doc.legalHold} onSelect={() => setDeleteOpen(true)}>
                  <Trash2 /> {doc.legalHold ? "On legal hold" : "Delete"}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {canReplace ? (
        <UploadDocumentDialog
          target={target}
          categories={categories.includes(doc.category) ? categories : [...categories, doc.category]}
          manage={manage}
          supersedes={{ id: doc.id, title: doc.title, category: doc.category }}
          trigger={null}
          open={replaceOpen}
          onOpenChange={setReplaceOpen}
        />
      ) : null}

      {manage ? (
        <>
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{doc.title}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  The document is removed from everyone&apos;s view. The file is retained for audit until its retention date; earlier versions become current again.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => run(() => deleteDocumentAction({ id: doc.id }), { success: "Document deleted" })}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <RetentionDialog doc={doc} open={retentionOpen} onOpenChange={setRetentionOpen} />
        </>
      ) : null}
    </div>
  );
}

function RetentionDialog({ doc, open, onOpenChange }: { doc: RowDocument; open: boolean; onOpenChange: (v: boolean) => void }) {
  const id = useId();
  const [retainUntil, setRetainUntil] = useState(doc.retainUntil ?? "");
  const [legalHold, setLegalHold] = useState(doc.legalHold);
  const { pending, run } = useRunAction();

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) {
          setRetainUntil(doc.retainUntil ?? "");
          setLegalHold(doc.legalHold);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Retention & legal hold</DialogTitle>
          <DialogDescription>{doc.title}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => updateRetentionAction({ id: doc.id, retainUntil: retainUntil || null, legalHold }), {
              success: "Retention updated",
              onSuccess: () => onOpenChange(false),
            });
          }}
        >
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor={`${id}-retain`}>Retain until</FieldLabel>
              <Input id={`${id}-retain`} type="date" value={retainUntil} onChange={(e) => setRetainUntil(e.target.value)} disabled={pending} />
              <FieldDescription>Leave empty to follow the company&apos;s default retention.</FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <div className="flex-1">
                <FieldLabel htmlFor={`${id}-hold`}>Legal hold</FieldLabel>
                <FieldDescription>Prevents deletion while a dispute, audit or investigation is open.</FieldDescription>
              </div>
              <Switch id={`${id}-hold`} checked={legalHold} onCheckedChange={setLegalHold} disabled={pending} />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
