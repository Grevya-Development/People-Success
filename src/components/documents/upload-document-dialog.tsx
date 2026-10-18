"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { FormError } from "@/components/forms/fields";
import {
  ACCEPT_ATTRIBUTE,
  ALLOWED_FILE_TYPES,
  DOCUMENT_CATEGORY_LABELS,
  MAX_UPLOAD_BYTES,
  type DocumentCategory,
  type DocumentOwnerType,
} from "@/lib/validation/documents";
import { uploadDocumentAction } from "@/app/(app)/documents/actions";
import { formatBytes } from "./format";

export type UploadTarget = { ownerType: DocumentOwnerType; employeeId?: string | null };

type Props = {
  target: UploadTarget;
  categories: readonly DocumentCategory[];
  /** HR can choose visibility and sensitivity; self-service cannot. */
  manage: boolean;
  /** Upload a new version of an existing document. */
  supersedes?: { id: string; title: string; category: DocumentCategory };
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

type Errors = Record<string, string | undefined>;

const titleFromFile = (name: string) =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

export function UploadDocumentDialog({ target, categories, manage, supersedes, trigger, open: controlledOpen, onOpenChange }: Props) {
  const id = useId();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (v: boolean) => {
    onOpenChange?.(v);
    if (controlledOpen === undefined) setUncontrolledOpen(v);
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(supersedes?.title ?? "");
  const [category, setCategory] = useState<DocumentCategory | "">(supersedes?.category ?? (categories.length === 1 ? categories[0] : ""));
  const [expiresOn, setExpiresOn] = useState("");
  const [employeeVisible, setEmployeeVisible] = useState(true);
  const [isSensitive, setIsSensitive] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [rootError, setRootError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function reset() {
    setFile(null);
    setTitle(supersedes?.title ?? "");
    setCategory(supersedes?.category ?? (categories.length === 1 ? categories[0] : ""));
    setExpiresOn("");
    setEmployeeVisible(true);
    setIsSensitive(false);
    setErrors({});
    setRootError(undefined);
    if (fileRef.current) fileRef.current.value = "";
  }

  function onFile(f: File | null) {
    setErrors((e) => ({ ...e, file: undefined }));
    setFile(f);
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!(ext in ALLOWED_FILE_TYPES)) setErrors((e) => ({ ...e, file: "This file type is not allowed" }));
    else if (f.size > MAX_UPLOAD_BYTES) setErrors((e) => ({ ...e, file: "Files can be at most 25 MB" }));
    if (!title.trim()) setTitle(titleFromFile(f.name));
  }

  function validate(): boolean {
    const next: Errors = {};
    if (!file) next.file = "Choose a file";
    else if (file.size > MAX_UPLOAD_BYTES) next.file = "Files can be at most 25 MB";
    else if (!((file.name.split(".").pop()?.toLowerCase() ?? "") in ALLOWED_FILE_TYPES)) next.file = "This file type is not allowed";
    if (!title.trim()) next.title = "Enter a title";
    if (!category) next.category = "Choose a category";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setRootError(undefined);
    if (!validate() || !file) return;
    const fd = new FormData();
    fd.set("file", file);
    fd.set("ownerType", target.ownerType);
    if (target.employeeId) fd.set("employeeId", target.employeeId);
    fd.set("category", category);
    fd.set("title", title.trim());
    if (expiresOn) fd.set("expiresOn", expiresOn);
    if (manage) {
      fd.set("employeeVisible", String(employeeVisible));
      fd.set("isSensitive", String(isSensitive));
    }
    if (supersedes) fd.set("supersedesId", supersedes.id);

    startTransition(async () => {
      try {
        const result = await uploadDocumentAction(fd);
        if (result.ok) {
          toast.success(supersedes ? `Uploaded version ${result.data.version}` : "Document uploaded");
          reset();
          setOpen(false);
          return;
        }
        const fe = result.error.fieldErrors ?? {};
        setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0]])));
        setRootError(result.error.message);
      } catch {
        // The request never reached the action (e.g. the body exceeded the server's upload limit).
        setRootError("The upload could not be sent. The file may be larger than the server currently accepts, or the connection dropped.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && pending) return;
        setOpen(v);
        if (!v) reset();
      }}
    >
      {trigger !== undefined ? (
        trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null
      ) : (
        <DialogTrigger asChild>
          <Button size="sm">
            <Upload data-icon="inline-start" /> Upload
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{supersedes ? "Upload new version" : "Upload document"}</DialogTitle>
          <DialogDescription>
            {supersedes
              ? `The current file of “${supersedes.title}” is kept as an earlier version.`
              : "PDF, images, Word, Excel, CSV or text. Up to 25 MB."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup className="gap-4">
            <Field data-invalid={!!errors.file}>
              <FieldLabel htmlFor={`${id}-file`}>
                File<span className="text-destructive" aria-hidden>*</span>
              </FieldLabel>
              <Input
                ref={fileRef}
                id={`${id}-file`}
                type="file"
                accept={ACCEPT_ATTRIBUTE}
                aria-invalid={!!errors.file}
                disabled={pending}
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
              {file && !errors.file ? (
                <FieldDescription>
                  {file.name} · {formatBytes(file.size)}
                </FieldDescription>
              ) : null}
              <FieldError>{errors.file}</FieldError>
            </Field>
            <Field data-invalid={!!errors.title}>
              <FieldLabel htmlFor={`${id}-title`}>
                Title<span className="text-destructive" aria-hidden>*</span>
              </FieldLabel>
              <Input
                id={`${id}-title`}
                value={title}
                maxLength={160}
                aria-invalid={!!errors.title}
                disabled={pending}
                onChange={(e) => setTitle(e.target.value)}
              />
              <FieldError>{errors.title}</FieldError>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!errors.category}>
                <FieldLabel htmlFor={`${id}-category`}>
                  Category<span className="text-destructive" aria-hidden>*</span>
                </FieldLabel>
                <Select value={category} onValueChange={(v) => setCategory(v as DocumentCategory)} disabled={pending || !!supersedes}>
                  <SelectTrigger id={`${id}-category`} className="w-full" aria-invalid={!!errors.category}>
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c}>
                        {DOCUMENT_CATEGORY_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError>{errors.category}</FieldError>
              </Field>
              <Field data-invalid={!!errors.expiresOn}>
                <FieldLabel htmlFor={`${id}-expires`}>Expires on</FieldLabel>
                <Input id={`${id}-expires`} type="date" value={expiresOn} disabled={pending} onChange={(e) => setExpiresOn(e.target.value)} />
                <FieldError>{errors.expiresOn}</FieldError>
              </Field>
            </div>
            {manage ? (
              <>
                {target.ownerType === "employee" || target.ownerType === "company" ? (
                  <Field orientation="horizontal">
                    <div className="flex-1">
                      <FieldLabel htmlFor={`${id}-visible`}>{target.ownerType === "company" ? "Visible to all employees" : "Visible to the employee"}</FieldLabel>
                      <FieldDescription>Turn off for HR-only records.</FieldDescription>
                    </div>
                    <Switch id={`${id}-visible`} checked={employeeVisible} onCheckedChange={setEmployeeVisible} disabled={pending} />
                  </Field>
                ) : null}
                <Field orientation="horizontal">
                  <div className="flex-1">
                    <FieldLabel htmlFor={`${id}-sensitive`}>Sensitive</FieldLabel>
                    <FieldDescription>Hidden from managers; every download is audited. Identity proofs are always sensitive.</FieldDescription>
                  </div>
                  <Switch
                    id={`${id}-sensitive`}
                    checked={isSensitive || category === "identity"}
                    onCheckedChange={setIsSensitive}
                    disabled={pending || category === "identity"}
                  />
                </Field>
              </>
            ) : null}
            <FormError message={rootError} />
          </FieldGroup>
          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : <Upload data-icon="inline-start" />}
              {pending ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
