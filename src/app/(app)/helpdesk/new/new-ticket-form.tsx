"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { FormError } from "@/components/forms/fields";
import { ACCEPT_ATTRIBUTE, MAX_UPLOAD_BYTES } from "@/lib/validation/documents";
import { createTicketSchema, type TicketPriority } from "@/lib/validation/helpdesk";
import { createTicketAction } from "../actions";

type Category = { id: string; name: string; description: string | null; isSensitive: boolean; firstResponseHours: number };

const NONE = "__none__";
const MAX_FILES = 5;

export function NewTicketForm({ categories }: { categories: Category[] }) {
  const id = useId();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState(NONE);
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [root, setRoot] = useState<string>();
  const [pending, start] = useTransition();
  const category = categories.find((c) => c.id === categoryId);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setRoot(undefined);
    const parsed = createTicketSchema.safeParse({ subject, description, categoryId: categoryId === NONE ? null : categoryId, priority });
    const next: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) next[String(i.path[0])] ??= i.message;
    if (files.length > MAX_FILES) next.files = `Attach at most ${MAX_FILES} files`;
    if (files.some((f) => f.size > MAX_UPLOAD_BYTES)) next.files = "Files can be at most 25 MB each";
    setErrors(next);
    if (Object.keys(next).length) return;
    const fd = new FormData();
    fd.set("subject", subject);
    fd.set("description", description);
    if (categoryId !== NONE) fd.set("categoryId", categoryId);
    fd.set("priority", priority);
    for (const f of files) fd.append("files", f);
    start(async () => {
      try {
        const r = await createTicketAction(fd);
        if (r.ok) {
          toast.success(`Ticket ${r.data.number} raised`);
          router.push(`/helpdesk/${r.data.id}`);
        } else {
          setErrors(Object.fromEntries(Object.entries(r.error.fieldErrors ?? {}).map(([k, v]) => [k, v[0]])));
          setRoot(r.error.message);
        }
      } catch {
        setRoot("The ticket could not be sent. An attachment may be too large, or the connection dropped.");
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate className="rounded-xl border bg-card p-5">
      <FieldGroup>
        <FormError message={root} />
        <Field data-invalid={!!errors.subject}>
          <FieldLabel htmlFor={`${id}-subject`}>Subject</FieldLabel>
          <Input id={`${id}-subject`} value={subject} onChange={(e) => setSubject(e.target.value)} aria-invalid={!!errors.subject} placeholder="Payslip shows wrong TDS for September" />
          <FieldError>{errors.subject}</FieldError>
        </Field>
        <Field data-invalid={!!errors.description}>
          <FieldLabel htmlFor={`${id}-desc`}>Details</FieldLabel>
          <Textarea id={`${id}-desc`} rows={6} value={description} onChange={(e) => setDescription(e.target.value)} aria-invalid={!!errors.description} />
          <FieldDescription>Don&apos;t include passwords, Aadhaar or bank numbers.</FieldDescription>
          <FieldError>{errors.description}</FieldError>
        </Field>
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <Field data-invalid={!!errors.categoryId}>
            <FieldLabel htmlFor={`${id}-cat`}>Category</FieldLabel>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id={`${id}-cat`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not sure — let HR route it</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {category ? (
              <FieldDescription className="flex items-start gap-1.5">
                {category.isSensitive ? <Lock className="mt-0.5 size-3.5 shrink-0" /> : null}
                {category.description ?? ""} {`First reply within ${category.firstResponseHours} hours.`}
              </FieldDescription>
            ) : null}
            <FieldError>{errors.categoryId}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-prio`}>Priority</FieldLabel>
            <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
              <SelectTrigger id={`${id}-prio`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field data-invalid={!!errors.files || !!errors.file}>
          <FieldLabel htmlFor={`${id}-files`}>Attachments</FieldLabel>
          <Input id={`${id}-files`} ref={fileRef} type="file" multiple accept={ACCEPT_ATTRIBUTE} onChange={(e) => setFiles([...(e.target.files ?? [])])} />
          <FieldDescription>Up to {MAX_FILES} files, 25 MB each. Visible only to you and the HR team working the ticket.</FieldDescription>
          <FieldError>{errors.files ?? errors.file}</FieldError>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null} Raise ticket
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
