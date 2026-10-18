"use client";

import { useState, useTransition } from "react";
import { Controller, useFieldArray, type UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { ClipboardList, Plus, Trash2, TrendingUp, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, TextField, TextareaField, type Option } from "@/components/forms/fields";
import { StatusBadge } from "@/components/status-badge";
import { PIP_OUTCOMES, pipSchema, pipUpdateSchema, promotionSchema } from "@/lib/validation/talent";
import { titleCase } from "@/lib/format";
import { assignPeersAction, createPipAction, peerAssignmentsAction, recommendPromotionAction, updatePipAction } from "../actions";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check } from "lucide-react";
import { cn } from "cn";

/** Manager assigns up to 3 peer reviewers. Started peer reviews are kept. */
export function PeerDialog({ cycleId, employeeId, employeeName, colleagues }: { cycleId: string; employeeId: string; employeeName: string; colleagues: Option[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [locked, setLocked] = useState<string[]>([]);
  const [loading, startLoad] = useTransition();
  const [saving, startSave] = useTransition();
  const options = colleagues.filter((c) => c.value !== employeeId);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o)
          startLoad(async () => {
            const res = await peerAssignmentsAction({ cycleId, employeeId });
            if (res.ok) {
              setSelected(res.data.map((p) => p.reviewerId));
              setLocked(res.data.filter((p) => p.status !== "not_started").map((p) => p.reviewerId));
            } else toast.error(res.error.message);
          });
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Users /> Peers
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Peer reviewers for {employeeName}</DialogTitle>
          <DialogDescription>Choose up to 3 colleagues. Peer feedback is visible to HR only, never to {employeeName} directly.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : (
          <Command className="rounded-lg border">
            <CommandInput placeholder="Search colleagues…" />
            <CommandList className="max-h-64">
              <CommandEmpty>No matches.</CommandEmpty>
              <CommandGroup>
                {options.map((o) => {
                  const on = selected.includes(o.value);
                  const isLocked = locked.includes(o.value);
                  return (
                    <CommandItem
                      key={o.value}
                      value={`${o.label} ${o.hint ?? ""}`}
                      disabled={isLocked || (!on && selected.length >= 3)}
                      onSelect={() => setSelected((s) => (on ? s.filter((x) => x !== o.value) : [...s, o.value]))}
                    >
                      <Check className={cn("size-4", on ? "opacity-100" : "opacity-0")} />
                      <span className="flex-1 truncate">{o.label}</span>
                      {isLocked ? <span className="text-xs text-muted-foreground">started</span> : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving || loading}
            onClick={() =>
              startSave(async () => {
                const res = await assignPeersAction({ cycleId, employeeId, peerIds: selected });
                if (res.ok) {
                  toast.success(`Peers updated (${res.data.added} added, ${res.data.removed} removed)`);
                  setOpen(false);
                } else toast.error(res.error.message);
              })
            }
          >
            {saving ? <Spinner /> : null} Save peers
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PromotionDialog({ employeeId, employeeName, cycleId, designations, grades }: { employeeId: string; employeeName: string; cycleId: string | null; designations: Option[]; grades: Option[] }) {
  return (
    <FormDialog
      trigger={
        <Button variant="ghost" size="sm">
          <TrendingUp /> Promote
        </Button>
      }
      title={`Recommend ${employeeName} for promotion`}
      description="HR reviews every recommendation. A proposed CTC is visible only to HR and compensation administrators."
      schema={promotionSchema}
      defaultValues={{ employeeId, cycleId, toDesignationId: null, toGradeId: null, proposedAnnualCtc: null, justification: "" } as never}
      action={recommendPromotionAction}
      submitLabel="Submit recommendation"
      successMessage="Recommendation sent to HR"
    >
      {(form) => (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField control={form.control} name="toDesignationId" label="To designation" options={designations} allowNone="Not specified" />
            <SelectField control={form.control} name="toGradeId" label="To grade" options={grades} allowNone="Not specified" />
          </div>
          <TextField control={form.control} name="proposedAnnualCtc" label="Proposed annual CTC (₹, optional)" type="number" inputMode="numeric" />
          <TextareaField control={form.control} name="justification" label="Justification" rows={4} required placeholder="Evidence of sustained performance at the next level" />
        </>
      )}
    </FormDialog>
  );
}

type PipValues = { employeeId: string; startsOn: string; endsOn: string; objectives: { title: string; measure: string }[] };

export function PipDialog({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  return (
    <FormDialog
      wide
      trigger={
        <Button variant="ghost" size="sm">
          <ClipboardList /> PIP
        </Button>
      }
      title={`Improvement plan for ${employeeName}`}
      description="Set clear, measurable objectives and a review date. The employee is notified and can see the plan."
      schema={pipSchema}
      defaultValues={{ employeeId, startsOn: "", endsOn: "", objectives: [{ title: "", measure: "" }] } as never}
      action={createPipAction}
      submitLabel="Start plan"
      successMessage="Improvement plan started"
    >
      {(form) => <PipObjectives form={form as unknown as UseFormReturn<PipValues>} />}
    </FormDialog>
  );
}

function PipObjectives({ form }: { form: UseFormReturn<PipValues> }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "objectives" });
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField control={form.control} name="startsOn" label="Starts on" type="date" required />
        <TextField control={form.control} name="endsOn" label="Review on" type="date" required />
      </div>
      <FieldSet>
        <FieldLegend variant="label">Objectives</FieldLegend>
        {fields.map((f, i) => (
          <div key={f.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <TextField control={form.control} name={`objectives.${i}.title`} label="Objective" />
            <TextField control={form.control} name={`objectives.${i}.measure`} label="Measured by" />
            <Button type="button" variant="ghost" size="icon" aria-label="Remove objective" disabled={fields.length <= 1} onClick={() => remove(i)}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" disabled={fields.length >= 10} onClick={() => append({ title: "", measure: "" })}>
          <Plus /> Add objective
        </Button>
      </FieldSet>
    </>
  );
}

type PipUpdateValues = { id: string; objectiveStatuses: ("open" | "met" | "not_met")[]; outcome: (typeof PIP_OUTCOMES)[number] | null; outcomeNote: string | null };

export function PipUpdateDialog({ plan }: { plan: { id: string; employeeName: string; objectives: { title: string; measure: string; status: string }[] } }) {
  return (
    <FormDialog
      wide
      trigger={
        <Button variant="outline" size="sm">
          Update
        </Button>
      }
      title={`Improvement plan: ${plan.employeeName}`}
      description="Record progress on each objective. Choosing an outcome closes the plan."
      schema={pipUpdateSchema}
      defaultValues={{ id: plan.id, objectiveStatuses: plan.objectives.map((o) => (o.status as PipUpdateValues["objectiveStatuses"][number]) ?? "open"), outcome: null, outcomeNote: null } as never}
      action={updatePipAction}
      successMessage="Plan updated"
    >
      {(form) => {
        const f = form as unknown as UseFormReturn<PipUpdateValues>;
        return (
          <>
            {plan.objectives.map((o, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{o.title}</p>
                  <p className="text-xs text-muted-foreground">{o.measure}</p>
                </div>
                <Controller
                  control={f.control}
                  name={`objectiveStatuses.${i}`}
                  render={({ field }) => (
                    <Select value={field.value ?? "open"} onValueChange={field.onChange}>
                      <SelectTrigger className="w-36" aria-label={`Status of ${o.title}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="met">Met</SelectItem>
                        <SelectItem value="not_met">Not met</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            ))}
            <SelectField control={f.control} name="outcome" label="Outcome" options={PIP_OUTCOMES.map((o) => ({ value: o, label: titleCase(o) }))} allowNone="Still in progress" />
            <TextareaField control={f.control} name="outcomeNote" label="Outcome note" rows={3} />
          </>
        );
      }}
    </FormDialog>
  );
}

export function PipObjectiveList({ objectives }: { objectives: { title: string; measure: string; status: string }[] }) {
  return (
    <ul className="space-y-1.5">
      {objectives.map((o, i) => (
        <li key={i} className="flex items-start justify-between gap-3 text-sm">
          <span>
            {o.title} <span className="text-xs text-muted-foreground">· {o.measure}</span>
          </span>
          <StatusBadge status={o.status} tone={o.status === "met" ? "success" : o.status === "not_met" ? "danger" : "neutral"} />
        </li>
      ))}
    </ul>
  );
}
