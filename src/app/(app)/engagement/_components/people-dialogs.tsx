"use client";

import { useState } from "react";
import { Controller, useFieldArray, type UseFormReturn } from "react-hook-form";
import { Award, CalendarPlus, NotebookPen, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, SwitchField, TextField, TextareaField, type Option } from "@/components/forms/fields";
import { ComboboxField } from "@/app/(app)/settings/_components/combobox-field";
import {
  READINESS,
  READINESS_LABELS,
  RECOGNITION_BADGES,
  actionPlanSchema,
  careerManagerNotesSchema,
  careerPlanSchema,
  oneOnOneSchema,
  recognitionSchema,
  successionPlanSchema,
} from "@/lib/validation/talent";
import { todayIn } from "@/lib/format";
import { giveRecognitionAction, saveActionPlanAction, saveCareerNotesAction, saveCareerPlanAction, saveOneOnOneAction, saveSuccessionPlanAction } from "../actions";

/* ------------------------------------------------------------------ */
/* Recognition                                                         */
/* ------------------------------------------------------------------ */

export function RecognitionDialog({ colleagues }: { colleagues: Option[] }) {
  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <Award /> Recognize someone
        </Button>
      }
      title="Recognize a colleague"
      description="Public recognitions appear on the wall. They are notified either way."
      schema={recognitionSchema}
      defaultValues={{ toEmployeeId: "", badge: "Thank you", message: "", isPublic: true } as never}
      action={giveRecognitionAction}
      submitLabel="Send recognition"
      successMessage="Recognition sent"
    >
      {(form) => (
        <>
          <ComboboxField control={form.control} name="toEmployeeId" label="Colleague" options={colleagues} placeholder="Search by name" />
          <SelectField control={form.control} name="badge" label="Badge" options={RECOGNITION_BADGES.map((b) => ({ value: b, label: b }))} />
          <TextareaField control={form.control} name="message" label="Message" rows={3} required placeholder="What did they do, and what difference did it make?" />
          <SwitchField control={form.control} name="isPublic" label="Show on the recognition wall" />
        </>
      )}
    </FormDialog>
  );
}

/* ------------------------------------------------------------------ */
/* 1:1s                                                                */
/* ------------------------------------------------------------------ */

type ActionItem = { text: string; owner: "manager" | "employee"; done: boolean };
type OneOnOneValues = { id?: string | null; withEmployeeId: string; heldOn: string; agenda: string | null; notes: string | null; actionItems: ActionItem[] };

export function OneOnOneDialog({ partners, values }: { partners: Option[]; values?: OneOnOneValues }) {
  const editing = !!values?.id;
  return (
    <FormDialog
      wide
      trigger={
        editing ? (
          <Button variant="ghost" size="sm" aria-label="Edit 1:1">
            <Pencil /> Notes
          </Button>
        ) : (
          <Button size="sm">
            <CalendarPlus /> New 1:1
          </Button>
        )
      }
      title={editing ? "1:1 notes" : "Record a 1:1"}
      description="Only you and the other person can see the agenda, notes and action items. HR cannot."
      schema={oneOnOneSchema}
      defaultValues={(values ?? { withEmployeeId: partners[0]?.value ?? "", heldOn: todayIn(), agenda: null, notes: null, actionItems: [] }) as never}
      action={saveOneOnOneAction}
      submitLabel="Save"
      successMessage="1:1 saved"
    >
      {(form) => <OneOnOneFields form={form as unknown as UseFormReturn<OneOnOneValues>} partners={partners} editing={editing} />}
    </FormDialog>
  );
}

function OneOnOneFields({ form, partners, editing }: { form: UseFormReturn<OneOnOneValues>; partners: Option[]; editing: boolean }) {
  const c = form.control;
  const { fields, append, remove } = useFieldArray({ control: c, name: "actionItems" });
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_11rem]">
        {editing ? (
          <Field>
            <FieldLabel>With</FieldLabel>
            <p className="text-sm">{partners.find((p) => p.value === form.getValues("withEmployeeId"))?.label ?? "—"}</p>
          </Field>
        ) : (
          <SelectField control={c} name="withEmployeeId" label="With" options={partners.map((p) => ({ value: p.value, label: `${p.label} (${p.hint})` }))} />
        )}
        <TextField control={c} name="heldOn" label="Date" type="date" required />
      </div>
      <TextareaField control={c} name="agenda" label="Agenda" rows={3} />
      <TextareaField control={c} name="notes" label="Notes" rows={5} />
      <FieldSet>
        <FieldLegend variant="label">Action items</FieldLegend>
        {fields.map((f, i) => (
          <div key={f.id} className="flex items-center gap-2">
            <Controller control={c} name={`actionItems.${i}.done`} render={({ field }) => <Checkbox checked={!!field.value} onCheckedChange={(v) => field.onChange(v === true)} aria-label="Done" />} />
            <Controller control={c} name={`actionItems.${i}.text`} render={({ field }) => <Input {...field} className="h-8 flex-1" placeholder="Action" />} />
            <Controller
              control={c}
              name={`actionItems.${i}.owner`}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-32" aria-label="Owner">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="employee">Employee</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            <Button type="button" variant="ghost" size="icon" aria-label="Remove action" onClick={() => remove(i)}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => append({ text: "", owner: "employee", done: false })}>
          <Plus /> Add action
        </Button>
      </FieldSet>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Career                                                              */
/* ------------------------------------------------------------------ */

type CareerAction = { title: string; kind: "course" | "project" | "mentoring" | "other"; dueOn?: string; done: boolean };
type CareerValues = { employeeId: string; aspirations: string | null; targetRoles: string[]; interestedInMobility: boolean; actions: CareerAction[] };

export function CareerPlanDialog({ values }: { values: CareerValues }) {
  return (
    <FormDialog
      wide
      trigger={
        <Button size="sm">
          <NotebookPen /> Edit my plan
        </Button>
      }
      title="My career plan"
      description="Visible to you, your manager and HR."
      schema={careerPlanSchema}
      defaultValues={values as never}
      action={saveCareerPlanAction}
      successMessage="Career plan saved"
    >
      {(form) => <CareerFields form={form as unknown as UseFormReturn<CareerValues>} />}
    </FormDialog>
  );
}

function RolesInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  return (
    <Field>
      <FieldLabel htmlFor="target-roles">Target roles</FieldLabel>
      <Input id="target-roles" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onChange([...new Set(text.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 10))} placeholder="Engineering manager, Staff engineer" />
      <FieldDescription>Comma separated.</FieldDescription>
    </Field>
  );
}

function CareerFields({ form }: { form: UseFormReturn<CareerValues> }) {
  const c = form.control;
  const { fields, append, remove } = useFieldArray({ control: c, name: "actions" });
  return (
    <>
      <TextareaField control={c} name="aspirations" label="Aspirations" rows={3} placeholder="Where would you like to be in 2–3 years?" />
      <Controller control={c} name="targetRoles" render={({ field }) => <RolesInput value={field.value ?? []} onChange={field.onChange} />} />
      <SwitchField control={c} name="interestedInMobility" label="Open to internal moves" description="Lets HR consider you for internal openings." />
      <FieldSet>
        <FieldLegend variant="label">Development actions</FieldLegend>
        {fields.map((f, i) => (
          <div key={f.id} className="flex flex-wrap items-center gap-2">
            <Controller control={c} name={`actions.${i}.done`} render={({ field }) => <Checkbox checked={!!field.value} onCheckedChange={(v) => field.onChange(v === true)} aria-label="Done" />} />
            <Controller control={c} name={`actions.${i}.title`} render={({ field }) => <Input {...field} className="h-8 min-w-48 flex-1" placeholder="Action" />} />
            <Controller
              control={c}
              name={`actions.${i}.kind`}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-32" aria-label="Kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="course">Course</SelectItem>
                    <SelectItem value="project">Project</SelectItem>
                    <SelectItem value="mentoring">Mentoring</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            <Controller control={c} name={`actions.${i}.dueOn`} render={({ field }) => <Input type="date" {...field} value={field.value ?? ""} className="h-8 w-40" aria-label="Due on" />} />
            <Button type="button" variant="ghost" size="icon" aria-label="Remove action" onClick={() => remove(i)}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => append({ title: "", kind: "other", done: false })}>
          <Plus /> Add action
        </Button>
      </FieldSet>
    </>
  );
}

export function ManagerNotesDialog({ employeeId, name, notes }: { employeeId: string; name: string; notes: string | null }) {
  return (
    <FormDialog
      trigger={
        <Button variant="outline" size="sm">
          <NotebookPen /> Manager notes
        </Button>
      }
      title={`Notes on ${name}'s plan`}
      description={`${name} is notified that you reviewed their plan.`}
      schema={careerManagerNotesSchema}
      defaultValues={{ employeeId, managerNotes: notes } as never}
      action={saveCareerNotesAction}
      successMessage="Notes saved"
    >
      {(form) => <TextareaField control={form.control} name="managerNotes" label="Notes" rows={5} />}
    </FormDialog>
  );
}

/* ------------------------------------------------------------------ */
/* Succession                                                          */
/* ------------------------------------------------------------------ */

type Candidate = { employeeId: string; readiness: (typeof READINESS)[number]; notes?: string };
type SuccessionValues = { id?: string | null; positionId: string | null; roleTitle: string; incumbentEmployeeId: string | null; criticality: "low" | "medium" | "high" | "critical"; candidates: Candidate[] };

export function SuccessionDialog({ employees, positions, values }: { employees: Option[]; positions: Option[]; values?: SuccessionValues }) {
  const editing = !!values?.id;
  return (
    <FormDialog
      wide
      trigger={
        editing ? (
          <Button variant="ghost" size="sm" aria-label={`Edit ${values?.roleTitle}`}>
            <Pencil />
          </Button>
        ) : (
          <Button size="sm">
            <Plus /> Critical role
          </Button>
        )
      }
      title={editing ? "Edit succession plan" : "New succession plan"}
      description="Restricted to people with succession planning access."
      schema={successionPlanSchema}
      defaultValues={(values ?? { positionId: null, roleTitle: "", incumbentEmployeeId: null, criticality: "high", candidates: [] }) as never}
      action={saveSuccessionPlanAction}
      successMessage="Succession plan saved"
    >
      {(form) => <SuccessionFields form={form as unknown as UseFormReturn<SuccessionValues>} employees={employees} positions={positions} />}
    </FormDialog>
  );
}

function SuccessionFields({ form, employees, positions }: { form: UseFormReturn<SuccessionValues>; employees: Option[]; positions: Option[] }) {
  const c = form.control;
  const { fields, append, remove } = useFieldArray({ control: c, name: "candidates" });
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <TextField control={c} name="roleTitle" label="Role" required placeholder="Head of Finance" />
        <SelectField
          control={c}
          name="criticality"
          label="Criticality"
          options={["low", "medium", "high", "critical"].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))}
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <ComboboxField control={c} name="positionId" label="Position" options={positions} placeholder="Optional" />
        <ComboboxField control={c} name="incumbentEmployeeId" label="Incumbent" options={employees} placeholder="Vacant" />
      </div>
      <FieldSet>
        <FieldLegend variant="label">Successors</FieldLegend>
        {fields.map((f, i) => (
          <div key={f.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)_auto] sm:items-end">
            <ComboboxField control={c} name={`candidates.${i}.employeeId`} label="Candidate" options={employees} />
            <SelectField control={c} name={`candidates.${i}.readiness`} label="Readiness" options={READINESS.map((r) => ({ value: r, label: READINESS_LABELS[r] }))} />
            <TextField control={c} name={`candidates.${i}.notes`} label="Notes" />
            <Button type="button" variant="ghost" size="icon" aria-label="Remove candidate" onClick={() => remove(i)}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" disabled={fields.length >= 10} onClick={() => append({ employeeId: "", readiness: "1_2_years" })}>
          <Plus /> Add successor
        </Button>
      </FieldSet>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Engagement action plans                                             */
/* ------------------------------------------------------------------ */

type PlanAction = { title: string; dueOn?: string; done: boolean };
type ActionPlanValues = { id?: string | null; surveyId: string | null; departmentId: string | null; ownerEmployeeId: string; focusArea: string; actions: PlanAction[]; status: "open" | "in_progress" | "done" };

export function ActionPlanDialog({ employees, surveys, departments, values, canChangeScope = true }: { employees: Option[]; surveys: Option[]; departments: Option[]; values?: ActionPlanValues; canChangeScope?: boolean }) {
  const editing = !!values?.id;
  return (
    <FormDialog
      wide
      trigger={
        editing ? (
          <Button variant="ghost" size="sm" aria-label={`Edit ${values?.focusArea}`}>
            <Pencil />
          </Button>
        ) : (
          <Button size="sm" variant="outline">
            <Plus /> Action plan
          </Button>
        )
      }
      title={editing ? "Edit action plan" : "New action plan"}
      description="Turn survey results into owned actions."
      schema={actionPlanSchema}
      defaultValues={(values ?? { surveyId: surveys[0]?.value ?? null, departmentId: null, ownerEmployeeId: "", focusArea: "", actions: [], status: "open" }) as never}
      action={saveActionPlanAction}
      successMessage="Action plan saved"
    >
      {(form) => <ActionPlanFields form={form as unknown as UseFormReturn<ActionPlanValues>} employees={employees} surveys={surveys} departments={departments} canChangeScope={canChangeScope} />}
    </FormDialog>
  );
}

function ActionPlanFields({ form, employees, surveys, departments, canChangeScope }: { form: UseFormReturn<ActionPlanValues>; employees: Option[]; surveys: Option[]; departments: Option[]; canChangeScope: boolean }) {
  const c = form.control;
  const { fields, append, remove } = useFieldArray({ control: c, name: "actions" });
  return (
    <>
      <TextField control={c} name="focusArea" label="Focus area" required placeholder="Career growth conversations" />
      {canChangeScope ? (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField control={c} name="surveyId" label="Survey" options={surveys} allowNone="Not linked" />
            <SelectField control={c} name="departmentId" label="Department" options={departments} allowNone="Company-wide" />
          </div>
          <ComboboxField control={c} name="ownerEmployeeId" label="Owner" options={employees} />
        </>
      ) : null}
      <SelectField
        control={c}
        name="status"
        label="Status"
        options={[
          { value: "open", label: "Open" },
          { value: "in_progress", label: "In progress" },
          { value: "done", label: "Done" },
        ]}
      />
      <FieldSet>
        <FieldLegend variant="label">Actions</FieldLegend>
        {fields.map((f, i) => (
          <div key={f.id} className="flex items-center gap-2">
            <Controller control={c} name={`actions.${i}.done`} render={({ field }) => <Checkbox checked={!!field.value} onCheckedChange={(v) => field.onChange(v === true)} aria-label="Done" />} />
            <Controller control={c} name={`actions.${i}.title`} render={({ field }) => <Input {...field} className="h-8 flex-1" placeholder="Action" />} />
            <Controller control={c} name={`actions.${i}.dueOn`} render={({ field }) => <Input type="date" {...field} value={field.value ?? ""} className="h-8 w-40" aria-label="Due on" />} />
            <Button type="button" variant="ghost" size="icon" aria-label="Remove action" onClick={() => remove(i)}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => append({ title: "", done: false })}>
          <Plus /> Add action
        </Button>
      </FieldSet>
    </>
  );
}
