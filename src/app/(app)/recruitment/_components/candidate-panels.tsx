"use client";

import { useState } from "react";
import { useWatch } from "react-hook-form";
import { CalendarPlus, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormError, SelectField, SwitchField, TextField } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { useRunAction } from "@/components/documents/use-run-action";
import { titleCase } from "@/lib/format";
import { INTERVIEW_MODES, scheduleInterviewSchema, type ScheduleInterviewInput } from "@/lib/validation/recruitment";
import { addNoteAction, applyToOpeningAction, poolMemberAction, scheduleInterviewAction, updateTagsAction } from "../actions";

export function TagsEditor({ candidateId, tags }: { candidateId: string; tags: string[] }) {
  const [value, setValue] = useState(tags.join(", "));
  const { pending, run } = useRunAction();
  const dirty = value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).join(",") !== tags.join(",");
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateTagsAction({ candidateId, tags: value }), { success: "Tags saved" });
      }}
    >
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. backend, notice-30" aria-label="Tags (comma-separated)" />
      <Button size="sm" variant="outline" type="submit" disabled={pending || !dirty}>
        {pending ? <Spinner /> : null}
        Save
      </Button>
    </form>
  );
}

export function PoolToggles({ candidateId, pools }: { candidateId: string; pools: { id: string; name: string; member: boolean }[] }) {
  const { pending, run } = useRunAction();
  if (!pools.length) return <p className="text-sm text-muted-foreground">No talent pools yet. Create one from the Candidates tab.</p>;
  return (
    <ul className="space-y-2">
      {pools.map((p) => (
        <li key={p.id} className="flex items-center gap-2">
          <Checkbox
            id={`pool-${p.id}`}
            checked={p.member}
            disabled={pending}
            onCheckedChange={(v) => run(() => poolMemberAction({ poolId: p.id, candidateId, remove: v !== true }), { success: v === true ? `Added to ${p.name}` : `Removed from ${p.name}` })}
          />
          <label htmlFor={`pool-${p.id}`} className="text-sm">
            {p.name}
          </label>
        </li>
      ))}
    </ul>
  );
}

export function NoteForm({ applicationId }: { applicationId: string }) {
  const [body, setBody] = useState("");
  const { pending, run } = useRunAction();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addNoteAction({ applicationId, body }), { success: "Note added", onSuccess: () => setBody("") });
      }}
    >
      <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add an internal note (visible to the recruiting team)" aria-label="Note" maxLength={4000} />
      <div className="flex justify-end">
        <Button size="sm" variant="outline" type="submit" disabled={pending || !body.trim()}>
          {pending ? <Spinner /> : null}
          Add note
        </Button>
      </div>
    </form>
  );
}

export function ApplyToJob({ candidateId, openings }: { candidateId: string; openings: { value: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [openingId, setOpeningId] = useState("");
  const { pending, run } = useRunAction();
  if (!openings.length) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus /> Add to job
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to another job</DialogTitle>
          <DialogDescription>Creates an application at the first stage. The candidate’s existing consent covers similar roles.</DialogDescription>
        </DialogHeader>
        <Select value={openingId} onValueChange={setOpeningId}>
          <SelectTrigger className="w-full" aria-label="Job">
            <SelectValue placeholder="Choose a job" />
          </SelectTrigger>
          <SelectContent>
            {openings.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!openingId || pending} onClick={() => run(() => applyToOpeningAction({ candidateId, openingId }), { success: "Added to job", onSuccess: () => setOpen(false) })}>
            {pending ? <Spinner /> : null}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* Schedule interview -------------------------------------------------- */

function defaultStart() {
  const d = new Date(Date.now() + 24 * 3600_000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return `${parts}T11:00`;
}

export function ScheduleInterviewDialog({
  applicationId,
  interviewers,
  scorecards,
}: {
  applicationId: string;
  interviewers: { value: string; label: string; hint?: string }[];
  scorecards: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [clash, setClash] = useState<string | null>(null);
  const { form, submit, pending } = useActionForm({
    schema: scheduleInterviewSchema,
    defaultValues: {
      applicationId,
      roundName: "Technical interview",
      mode: "video",
      start: defaultStart(),
      durationMinutes: 60,
      location: "",
      meetingUrl: "",
      panelUserIds: [],
      scorecardTemplateId: null,
      notifyCandidate: true,
      allowConflicts: false,
    } as never,
    action: async (values: ScheduleInterviewInput) => {
      const r = await scheduleInterviewAction(values);
      if (!r.ok && r.error.code === "CONFLICT") {
        setClash(r.error.message);
        return { ok: false as const, error: { code: "VALIDATION", message: r.error.message, fieldErrors: { start: ["Clashes with another interview for the panel"] } } };
      }
      return r;
    },
    successMessage: (d) => (d.conflictsOverridden ? "Interview scheduled despite the clash" : "Interview scheduled; invitations sent"),
    onSuccess: () => {
      setOpen(false);
      setClash(null);
    },
  });
  const c = form.control;
  const mode = useWatch({ control: c, name: "mode" });
  const panel = (useWatch({ control: c, name: "panelUserIds" }) as string[]) ?? [];
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...new Set([...panel, id])] : panel.filter((p) => p !== id);
    form.setValue("panelUserIds", next, { shouldValidate: true });
    setClash(null);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (pending) return;
        setOpen(o);
        if (!o) setClash(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <CalendarPlus /> Schedule interview
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Schedule an interview</DialogTitle>
            <DialogDescription>Times are in IST. The panel and (optionally) the candidate get an email and a reminder 24 hours before.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto px-0.5 py-5">
            <FieldGroup>
              {form.formState.errors.root?.message ? <FormError message={form.formState.errors.root.message} /> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField control={c} name="roundName" label="Round" required />
                <SelectField control={c} name="mode" label="Mode" options={INTERVIEW_MODES.map((m) => ({ value: m, label: titleCase(m) }))} />
                <TextField control={c} name="start" label="Starts (IST)" type="datetime-local" required />
                <SelectField control={c} name="durationMinutes" label="Duration" options={[30, 45, 60, 90, 120].map((m) => ({ value: String(m), label: `${m} minutes` }))} />
                {mode === "onsite" ? <TextField control={c} name="location" label="Venue" required /> : <TextField control={c} name="meetingUrl" label="Meeting link" placeholder="https://" required={mode === "video"} />}
                <SelectField control={c} name="scorecardTemplateId" label="Scorecard" options={scorecards} allowNone="General criteria" />
              </div>
              <Field data-invalid={!!form.formState.errors.panelUserIds}>
                <FieldLabel>
                  Panel<span className="text-destructive" aria-hidden>*</span>
                </FieldLabel>
                <FieldDescription>People with the “Submit interview feedback” permission. The first one you pick leads.</FieldDescription>
                {interviewers.length ? (
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {interviewers.map((i) => (
                      <li key={i.value} className="flex items-center gap-2">
                        <Checkbox id={`panel-${i.value}`} checked={panel.includes(i.value)} onCheckedChange={(v) => toggle(i.value, v === true)} />
                        <label htmlFor={`panel-${i.value}`} className="truncate text-sm">
                          {i.label}
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Nobody has interview permissions yet. Give the Interviewer role in Settings → Users.</p>
                )}
                <FieldError errors={[form.formState.errors.panelUserIds as { message?: string } | undefined]} />
              </Field>
              <SwitchField control={c} name="notifyCandidate" label="Email the candidate" description="Sends the time and joining details." />
              {clash ? (
                <div role="alert" className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
                  {clash}
                </div>
              ) : null}
            </FieldGroup>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {clash ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  form.setValue("allowConflicts", true);
                  submit().then(() => form.setValue("allowConflicts", false)).catch(() => toast.error("Could not schedule"));
                }}
              >
                Schedule anyway
              </Button>
            ) : null}
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              Schedule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
