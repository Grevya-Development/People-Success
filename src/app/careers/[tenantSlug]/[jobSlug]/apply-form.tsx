"use client";

import { useId, useRef, useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FormError } from "@/components/forms/fields";
import { RESUME_ACCEPT, RESUME_EXTENSIONS, RESUME_MAX_BYTES } from "@/lib/validation/recruitment";
import { applyForJobAction } from "../../actions";

type Question = { id: string; label: string; type: "text" | "yes_no" | "number"; required: boolean };
type Errors = Record<string, string | undefined>;

function Req() {
  return (
    <span className="text-destructive" aria-hidden>
      *
    </span>
  );
}

export function ApplyForm({ tenantSlug, jobSlug, jobTitle, questions, consent }: { tenantSlug: string; jobSlug: string; jobTitle: string; questions: Question[]; consent: string }) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [root, setRoot] = useState<string>();
  const [done, setDone] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  if (done) {
    return (
      <div role="status" className="mt-6 flex gap-3 rounded-lg border border-success/30 bg-success-soft p-4 text-sm">
        <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
        <div>
          <p className="font-medium text-foreground">Application received</p>
          <p className="mt-1 text-muted-foreground">Thank you for applying for {jobTitle}. We have emailed you a confirmation and will be in touch about next steps.</p>
        </div>
      </div>
    );
  }

  function validate(fd: FormData): Errors {
    const e: Errors = {};
    if (!String(fd.get("firstName") ?? "").trim()) e.firstName = "Enter your first name";
    const email = String(fd.get("email") ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) e.email = "Enter a valid email";
    const file = fd.get("resume");
    if (!(file instanceof File) || file.size === 0) e.resume = "Attach your resume (PDF or Word)";
    else if (file.size > RESUME_MAX_BYTES) e.resume = "Resumes can be at most 5 MB";
    else if (!(RESUME_EXTENSIONS as readonly string[]).includes((file.name.split(".").pop() ?? "").toLowerCase())) e.resume = "Upload a PDF or .docx file";
    for (const q of questions) if (q.required && !answers[q.id]?.trim()) e[`answers.${q.id}`] = "Please answer this question";
    if (!agreed) e.consent = "Please give consent so we can process your application";
    return e;
  }

  function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setRoot(undefined);
    const fd = new FormData(ev.currentTarget);
    for (const [k, v] of Object.entries(answers)) fd.set(`answers.${k}`, v);
    fd.set("tenantSlug", tenantSlug);
    fd.set("jobSlug", jobSlug);
    fd.set("consent", agreed ? "true" : "false");
    const e = validate(fd);
    setErrors(e);
    if (Object.keys(e).length) {
      setRoot("Please correct the highlighted fields.");
      return;
    }
    start(async () => {
      try {
        const r = await applyForJobAction(fd);
        if (r.ok) {
          setDone(true);
          return;
        }
        setErrors(Object.fromEntries(Object.entries(r.error.fieldErrors ?? {}).map(([k, v]) => [k, v[0]])));
        setRoot(r.error.message);
      } catch {
        setRoot("Your application could not be sent. Please check your connection and try again.");
      }
    });
  }

  const f = (name: string) => `${id}-${name}`;
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-6">
      <FieldGroup>
        <FormError message={root} />
        {/* Honeypot: hidden from people and assistive technology. */}
        <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
          <label htmlFor={f("website")}>Website</label>
          <input id={f("website")} name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={!!errors.firstName}>
            <FieldLabel htmlFor={f("first")}>
              First name <Req />
            </FieldLabel>
            <Input id={f("first")} name="firstName" autoComplete="given-name" maxLength={80} aria-invalid={!!errors.firstName} />
            <FieldError>{errors.firstName}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor={f("last")}>Last name</FieldLabel>
            <Input id={f("last")} name="lastName" autoComplete="family-name" maxLength={80} />
          </Field>
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor={f("email")}>
              Email <Req />
            </FieldLabel>
            <Input id={f("email")} name="email" type="email" autoComplete="email" maxLength={200} aria-invalid={!!errors.email} />
            <FieldError>{errors.email}</FieldError>
          </Field>
          <Field data-invalid={!!errors.phone}>
            <FieldLabel htmlFor={f("phone")}>Phone</FieldLabel>
            <Input id={f("phone")} name="phone" type="tel" autoComplete="tel" inputMode="tel" maxLength={20} aria-invalid={!!errors.phone} />
            <FieldError>{errors.phone}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor={f("title")}>Current job title</FieldLabel>
            <Input id={f("title")} name="currentTitle" autoComplete="organization-title" maxLength={120} />
          </Field>
          <Field>
            <FieldLabel htmlFor={f("company")}>Current company</FieldLabel>
            <Input id={f("company")} name="currentCompany" autoComplete="organization" maxLength={120} />
          </Field>
          <Field data-invalid={!!errors.experienceYears}>
            <FieldLabel htmlFor={f("exp")}>Total experience (years)</FieldLabel>
            <Input id={f("exp")} name="experienceYears" type="number" min={0} max={60} inputMode="numeric" aria-invalid={!!errors.experienceYears} />
            <FieldError>{errors.experienceYears}</FieldError>
          </Field>
          <Field data-invalid={!!errors.linkedinUrl}>
            <FieldLabel htmlFor={f("li")}>LinkedIn profile</FieldLabel>
            <Input id={f("li")} name="linkedinUrl" type="url" placeholder="https://www.linkedin.com/in/…" maxLength={300} aria-invalid={!!errors.linkedinUrl} />
            <FieldError>{errors.linkedinUrl}</FieldError>
          </Field>
        </div>
        <Field data-invalid={!!errors.resume}>
          <FieldLabel htmlFor={f("resume")}>
            Resume <Req />
          </FieldLabel>
          <Input id={f("resume")} name="resume" type="file" accept={RESUME_ACCEPT} aria-invalid={!!errors.resume} />
          <FieldDescription>PDF or Word (.docx), up to 5 MB. Please leave out your photo, date of birth and other personal details we don’t need.</FieldDescription>
          <FieldError>{errors.resume}</FieldError>
        </Field>
        {questions.length ? (
          <FieldSet>
            <FieldLegend>A few questions</FieldLegend>
            {questions.map((q) => {
              const key = `answers.${q.id}`;
              return (
                <Field key={q.id} data-invalid={!!errors[key]}>
                  <FieldLabel htmlFor={f(q.id)}>
                    {q.label} {q.required ? <Req /> : null}
                  </FieldLabel>
                  {q.type === "yes_no" ? (
                    <RadioGroup id={f(q.id)} value={answers[q.id] ?? ""} onValueChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} className="flex gap-4" aria-invalid={!!errors[key]}>
                      {["yes", "no"].map((v) => (
                        <label key={v} className="flex items-center gap-2 text-sm">
                          <RadioGroupItem value={v} /> {v === "yes" ? "Yes" : "No"}
                        </label>
                      ))}
                    </RadioGroup>
                  ) : (
                    <Input
                      id={f(q.id)}
                      type={q.type === "number" ? "number" : "text"}
                      inputMode={q.type === "number" ? "decimal" : undefined}
                      value={answers[q.id] ?? ""}
                      onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                      maxLength={2000}
                      aria-invalid={!!errors[key]}
                    />
                  )}
                  <FieldError>{errors[key]}</FieldError>
                </Field>
              );
            })}
          </FieldSet>
        ) : null}
        <Field>
          <FieldLabel htmlFor={f("note")}>Anything else you’d like us to know</FieldLabel>
          <Textarea id={f("note")} name="coverNote" rows={3} maxLength={3000} />
        </Field>
        <Field orientation="horizontal" data-invalid={!!errors.consent}>
          <Checkbox id={f("consent")} checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} aria-invalid={!!errors.consent} />
          <div>
            <FieldLabel htmlFor={f("consent")} className="font-normal leading-relaxed">
              {consent} <Req />
            </FieldLabel>
            <FieldError>{errors.consent}</FieldError>
          </div>
        </Field>
        <div>
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            {pending ? <Spinner /> : null}
            Submit application
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
