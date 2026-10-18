"use client";

import { useId, useState, useTransition } from "react";
import { CheckCircle2, Info, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormError } from "@/components/forms/fields";
import { RELATIONSHIP_LABELS, RESUME_ACCEPT, RESUME_MAX_BYTES } from "@/lib/validation/recruitment";
import { submitReferralAction } from "./actions";

type Errors = Record<string, string | undefined>;

export function ReferDialog({ openingId, jobTitle }: { openingId: string; jobTitle: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [relationship, setRelationship] = useState("former_colleague");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [root, setRoot] = useState<string>();
  const [result, setResult] = useState<{ status: string; message: string } | null>(null);
  const [pending, start] = useTransition();

  const reset = () => {
    setErrors({});
    setRoot(undefined);
    setResult(null);
    setConsent(false);
    setRelationship("former_colleague");
  };

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("openingId", openingId);
    fd.set("relationship", relationship);
    fd.set("consentConfirmed", consent ? "true" : "false");
    const next: Errors = {};
    if (!String(fd.get("firstName") ?? "").trim()) next.firstName = "Enter a first name";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(fd.get("email") ?? "").trim())) next.email = "Enter a valid email";
    const file = fd.get("resume");
    if (file instanceof File && file.size > RESUME_MAX_BYTES) next.resume = "Resumes can be at most 5 MB";
    if (!consent) next.consentConfirmed = "Confirm the candidate agreed to be referred";
    setErrors(next);
    if (Object.keys(next).length) return;
    start(async () => {
      try {
        const r = await submitReferralAction(fd);
        if (r.ok) {
          setResult({ status: r.data.status, message: r.data.message });
          return;
        }
        setErrors(Object.fromEntries(Object.entries(r.error.fieldErrors ?? {}).map(([k, v]) => [k, v[0]])));
        setRoot(r.error.message);
      } catch {
        setRoot("The referral could not be sent. Please try again.");
      }
    });
  }

  const f = (n: string) => `${id}-${n}`;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (pending) return;
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <UserPlus /> Refer someone
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Refer someone for {jobTitle}</DialogTitle>
          <DialogDescription>We’ll contact them about the role. Only share details of people who agreed to be referred.</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-4">
            <div role="status" className={`flex gap-3 rounded-lg border p-4 text-sm ${result.status === "duplicate" ? "border-info/30 bg-info-soft" : "border-success/30 bg-success-soft"}`}>
              {result.status === "duplicate" ? <Info className="size-5 shrink-0 text-info" aria-hidden /> : <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />}
              <p>{result.message}</p>
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <FieldGroup className="max-h-[60vh] gap-4 overflow-y-auto px-0.5 pb-1">
              <FormError message={root} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={!!errors.firstName}>
                  <FieldLabel htmlFor={f("first")}>First name*</FieldLabel>
                  <Input id={f("first")} name="firstName" maxLength={80} aria-invalid={!!errors.firstName} />
                  <FieldError>{errors.firstName}</FieldError>
                </Field>
                <Field>
                  <FieldLabel htmlFor={f("last")}>Last name</FieldLabel>
                  <Input id={f("last")} name="lastName" maxLength={80} />
                </Field>
                <Field data-invalid={!!errors.email}>
                  <FieldLabel htmlFor={f("email")}>Email*</FieldLabel>
                  <Input id={f("email")} name="email" type="email" maxLength={200} aria-invalid={!!errors.email} />
                  <FieldError>{errors.email}</FieldError>
                </Field>
                <Field data-invalid={!!errors.phone}>
                  <FieldLabel htmlFor={f("phone")}>Phone</FieldLabel>
                  <Input id={f("phone")} name="phone" type="tel" maxLength={20} aria-invalid={!!errors.phone} />
                  <FieldError>{errors.phone}</FieldError>
                </Field>
              </div>
              <Field data-invalid={!!errors.linkedinUrl}>
                <FieldLabel htmlFor={f("li")}>LinkedIn</FieldLabel>
                <Input id={f("li")} name="linkedinUrl" type="url" placeholder="https://" maxLength={300} aria-invalid={!!errors.linkedinUrl} />
                <FieldError>{errors.linkedinUrl}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor={f("rel")}>How do you know them?</FieldLabel>
                <Select value={relationship} onValueChange={setRelationship}>
                  <SelectTrigger id={f("rel")} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(RELATIONSHIP_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field data-invalid={!!errors.resume}>
                <FieldLabel htmlFor={f("resume")}>Resume</FieldLabel>
                <Input id={f("resume")} name="resume" type="file" accept={RESUME_ACCEPT} aria-invalid={!!errors.resume} />
                <FieldDescription>PDF or Word (.docx), up to 5 MB. Optional.</FieldDescription>
                <FieldError>{errors.resume}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor={f("note")}>Why are they a good fit?</FieldLabel>
                <Textarea id={f("note")} name="note" rows={3} maxLength={2000} />
              </Field>
              <Field orientation="horizontal" data-invalid={!!errors.consentConfirmed}>
                <Checkbox id={f("consent")} checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
                <div>
                  <FieldLabel htmlFor={f("consent")} className="font-normal">
                    They agreed to be referred and to the company processing their details for recruitment.
                  </FieldLabel>
                  <FieldError>{errors.consentConfirmed}</FieldError>
                </div>
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                Submit referral
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
