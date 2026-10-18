"use client";

import { Controller, useFieldArray, useWatch, type Control, type FieldValues, type UseFormReturn } from "react-hook-form";
import { Pencil, Plus, Scale, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, SwitchField, TextField, TextareaField, type Option } from "@/components/forms/fields";
import {
  CYCLE_KINDS,
  REVIEW_KINDS,
  REVIEW_KIND_LABELS,
  calibrateSchema,
  competencySchema,
  ratingScaleSchema,
  reviewCycleSchema,
  reviewTemplateSchema,
} from "@/lib/validation/talent";
import { titleCase } from "@/lib/format";
import { MultiSelectField } from "./multi-select";
import { calibrateAction, saveCompetencyAction, saveCycleAction, saveRatingScaleAction, saveReviewTemplateAction } from "../actions";

const newId = () => Math.random().toString(36).slice(2, 10);

/* ------------------------------------------------------------------ */
/* Cycle                                                               */
/* ------------------------------------------------------------------ */

export type CycleFormValues = {
  id?: string | null;
  name: string;
  kind: (typeof CYCLE_KINDS)[number];
  periodStart: string;
  periodEnd: string;
  templateId: string;
  ratingScaleId: string | null;
  selfDueOn: string | null;
  peerDueOn: string | null;
  managerDueOn: string | null;
  calibrationDueOn: string | null;
  includePeers: boolean;
  includeUpward: boolean;
  departmentIds: string[];
  locationIds: string[];
  joinedOnOrBefore: string | null;
};

export function CycleDialog({ values, templates, scales, departments, locations }: { values?: CycleFormValues; templates: Option[]; scales: Option[]; departments: Option[]; locations: Option[] }) {
  const editing = !!values?.id;
  const defaults: CycleFormValues = values ?? {
    name: "",
    kind: "annual",
    periodStart: "",
    periodEnd: "",
    templateId: templates[0]?.value ?? "",
    ratingScaleId: scales[0]?.value ?? null,
    selfDueOn: null,
    peerDueOn: null,
    managerDueOn: null,
    calibrationDueOn: null,
    includePeers: false,
    includeUpward: false,
    departmentIds: [],
    locationIds: [],
    joinedOnOrBefore: null,
  };
  return (
    <FormDialog
      wide
      trigger={
        editing ? (
          <Button variant="outline" size="sm">
            <Pencil /> Edit
          </Button>
        ) : (
          <Button size="sm">
            <Plus /> New cycle
          </Button>
        )
      }
      title={editing ? "Edit review cycle" : "New review cycle"}
      description="Draft cycles can be edited. Launching creates the reviews and notifies participants."
      schema={reviewCycleSchema}
      defaultValues={defaults as never}
      action={saveCycleAction}
      submitLabel={editing ? "Save cycle" : "Create draft"}
      successMessage={editing ? "Cycle updated" : "Draft cycle created"}
    >
      {(form) => {
        const c = form.control;
        return (
          <>
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <TextField control={c} name="name" label="Name" required placeholder="FY 2026-27 annual review" />
              <SelectField control={c} name="kind" label="Type" options={CYCLE_KINDS.map((k) => ({ value: k, label: titleCase(k) }))} />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField control={c} name="periodStart" label="Period start" type="date" required />
              <TextField control={c} name="periodEnd" label="Period end" type="date" required />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <SelectField control={c} name="templateId" label="Template" options={templates} required />
              <SelectField control={c} name="ratingScaleId" label="Rating scale" options={scales} allowNone="Default 5-point scale" />
            </div>
            <div className="grid gap-5 sm:grid-cols-4">
              <TextField control={c} name="selfDueOn" label="Self due" type="date" />
              <TextField control={c} name="peerDueOn" label="Peer due" type="date" />
              <TextField control={c} name="managerDueOn" label="Manager due" type="date" />
              <TextField control={c} name="calibrationDueOn" label="Calibration" type="date" />
            </div>
            <SwitchField control={c} name="includePeers" label="Peer reviews" description="Managers assign up to 3 peers per employee." />
            <SwitchField control={c} name="includeUpward" label="Upward feedback" description="Reports review their manager. Managers only see averages with 3 or more responses, after the cycle closes." />
            <FieldSet>
              <FieldLegend variant="label">Participants</FieldLegend>
              <div className="grid gap-5 sm:grid-cols-2">
                <MultiSelectField control={c} name="departmentIds" label="Departments" options={departments} placeholder="All departments" />
                <MultiSelectField control={c} name="locationIds" label="Locations" options={locations} placeholder="All locations" />
              </div>
              <TextField control={c} name="joinedOnOrBefore" label="Joined on or before" type="date" description="Defaults to 30 days before the period ends." />
            </FieldSet>
          </>
        );
      }}
    </FormDialog>
  );
}

/* ------------------------------------------------------------------ */
/* Setup: scales, competencies, templates                              */
/* ------------------------------------------------------------------ */

type ScaleValues = { id?: string | null; name: string; levels: { value: number; label: string; description?: string }[] };

export function ScaleDialog({ values }: { values?: ScaleValues }) {
  const editing = !!values?.id;
  return (
    <FormDialog
      trigger={
        editing ? (
          <Button variant="ghost" size="sm" aria-label={`Edit ${values?.name}`}>
            <Pencil />
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Scale /> New scale
          </Button>
        )
      }
      title={editing ? "Edit rating scale" : "New rating scale"}
      description="Scales used by launched cycles cannot be changed."
      schema={ratingScaleSchema}
      defaultValues={(values ?? { name: "", levels: [1, 2, 3, 4, 5].map((v) => ({ value: v, label: "", description: "" })) }) as never}
      action={saveRatingScaleAction}
      successMessage="Rating scale saved"
    >
      {(form) => <LevelsEditor form={form as unknown as UseFormReturn<ScaleValues>} />}
    </FormDialog>
  );
}

function LevelsEditor({ form }: { form: UseFormReturn<ScaleValues> }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "levels" });
  return (
    <>
      <TextField control={form.control} name="name" label="Name" required />
      <FieldSet>
        <FieldLegend variant="label">Levels</FieldLegend>
        {fields.map((f, i) => (
          <div key={f.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-end gap-2">
            <TextField control={form.control} name={`levels.${i}.value`} label="Value" type="number" />
            <TextField control={form.control} name={`levels.${i}.label`} label="Label" />
            <Button type="button" variant="ghost" size="icon" aria-label="Remove level" onClick={() => remove(i)} disabled={fields.length <= 2}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => append({ value: fields.length + 1, label: "", description: "" })} disabled={fields.length >= 10}>
          <Plus /> Add level
        </Button>
      </FieldSet>
    </>
  );
}

export function CompetencyDialog({ values }: { values?: { id: string; name: string; description: string | null; category: string | null; isActive: boolean } }) {
  const editing = !!values?.id;
  return (
    <FormDialog
      trigger={
        editing ? (
          <Button variant="ghost" size="sm" aria-label={`Edit ${values?.name}`}>
            <Pencil />
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Plus /> New competency
          </Button>
        )
      }
      title={editing ? "Edit competency" : "New competency"}
      schema={competencySchema}
      defaultValues={(values ?? { name: "", description: null, category: null, isActive: true }) as never}
      action={saveCompetencyAction}
      successMessage="Competency saved"
    >
      {(form) => (
        <>
          <TextField control={form.control} name="name" label="Name" required placeholder="Customer focus" />
          <TextField control={form.control} name="category" label="Category" placeholder="Core, Leadership…" />
          <TextareaField control={form.control} name="description" label="What good looks like" rows={3} />
          <SwitchField control={form.control} name="isActive" label="Active" />
        </>
      )}
    </FormDialog>
  );
}

type QuestionValue = { id: string; label: string; type: "rating" | "text" | "competency"; competencyId?: string | null; required: boolean; forKinds: string[] };
type TemplateValues = { id?: string | null; name: string; questions: QuestionValue[]; includeGoals: boolean; goalsWeightPercent: number };

export function TemplateDialog({ values, competencies }: { values?: TemplateValues; competencies: Option[] }) {
  const editing = !!values?.id;
  const defaults: TemplateValues = values ?? {
    name: "",
    includeGoals: true,
    goalsWeightPercent: 50,
    questions: [{ id: newId(), label: "", type: "rating", required: true, forKinds: ["self", "manager"] }],
  };
  return (
    <FormDialog
      wide
      trigger={
        editing ? (
          <Button variant="ghost" size="sm" aria-label={`Edit ${values?.name}`}>
            <Pencil />
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Plus /> New template
          </Button>
        )
      }
      title={editing ? "Edit review template" : "New review template"}
      description="Questions are answered by the reviewer kinds you tick. Rating and competency answers, blended with goal attainment, give the suggested overall rating."
      schema={reviewTemplateSchema}
      defaultValues={defaults as never}
      action={saveReviewTemplateAction}
      successMessage="Template saved"
    >
      {(form) => <TemplateEditor form={form as unknown as UseFormReturn<TemplateValues>} competencies={competencies} />}
    </FormDialog>
  );
}

function KindsCheckboxes<T extends FieldValues>({ control, name }: { control: Control<T>; name: string }) {
  return (
    <Controller
      control={control}
      name={name as never}
      render={({ field }) => {
        const value: string[] = field.value ?? [];
        return (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {REVIEW_KINDS.map((k) => (
              <label key={k} className="flex items-center gap-1.5 text-xs">
                <Checkbox checked={value.includes(k)} onCheckedChange={(v) => field.onChange(v ? [...value, k] : value.filter((x) => x !== k))} />
                {REVIEW_KIND_LABELS[k].replace(" review", "").replace(" feedback", "")}
              </label>
            ))}
          </div>
        );
      }}
    />
  );
}

function TemplateEditor({ form, competencies }: { form: UseFormReturn<TemplateValues>; competencies: Option[] }) {
  const c = form.control;
  const { fields, append, remove, move } = useFieldArray({ control: c, name: "questions" });
  const types = useWatch({ control: c, name: "questions" });
  const includeGoals = useWatch({ control: c, name: "includeGoals" });
  return (
    <>
      <TextField control={c} name="name" label="Name" required />
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <SwitchField control={c} name="includeGoals" label="Include goals" description="Goal attainment counts toward the suggested rating." />
        {includeGoals ? <TextField control={c} name="goalsWeightPercent" label="Goals weight (%)" type="number" /> : null}
      </div>
      <FieldSet>
        <FieldLegend variant="label">Questions</FieldLegend>
        {fields.map((f, i) => (
          <div key={f.id} className="space-y-3 rounded-lg border p-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
              <TextField control={c} name={`questions.${i}.label`} label={`Question ${i + 1}`} />
              <SelectField
                control={c}
                name={`questions.${i}.type`}
                label="Answer"
                options={[
                  { value: "rating", label: "Rating" },
                  { value: "competency", label: "Competency" },
                  { value: "text", label: "Text" },
                ]}
              />
            </div>
            {types?.[i]?.type === "competency" ? <SelectField control={c} name={`questions.${i}.competencyId`} label="Competency" options={competencies} /> : null}
            <Field>
              <FieldLabel>Answered by</FieldLabel>
              <KindsCheckboxes control={c} name={`questions.${i}.forKinds`} />
            </Field>
            <div className="flex items-center justify-between gap-2">
              <Controller
                control={c}
                name={`questions.${i}.required`}
                render={({ field }) => (
                  <label className="flex items-center gap-1.5 text-xs">
                    <Checkbox checked={!!field.value} onCheckedChange={(v) => field.onChange(v === true)} /> Required
                  </label>
                )}
              />
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" disabled={i === 0} onClick={() => move(i, i - 1)}>
                  Up
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label="Remove question" disabled={fields.length <= 1} onClick={() => remove(i)}>
                  <Trash2 />
                </Button>
              </div>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => append({ id: newId(), label: "", type: "rating", required: true, forKinds: ["self", "manager"] })}>
          <Plus /> Add question
        </Button>
      </FieldSet>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Calibration                                                         */
/* ------------------------------------------------------------------ */

export function CalibrateDialog({ reviewId, name, current, levels }: { reviewId: string; name: string; current: number | null; levels: { value: number; label: string }[] }) {
  return (
    <FormDialog
      trigger={
        <Button variant="ghost" size="sm">
          Calibrate
        </Button>
      }
      title={`Calibrate ${name}`}
      description="The calibrated rating replaces the manager's rating when the review is shared. The change and your note are audited."
      schema={calibrateSchema}
      defaultValues={{ reviewId, calibratedRating: current ?? levels[Math.floor(levels.length / 2)]?.value ?? 3, note: "" } as never}
      action={calibrateAction}
      submitLabel="Save calibration"
      successMessage="Rating calibrated"
    >
      {(form) => (
        <>
          <Controller
            control={form.control}
            name="calibratedRating"
            render={({ field }) => (
              <Field>
                <FieldLabel>Calibrated rating</FieldLabel>
                <div className="flex flex-wrap gap-1.5">
                  {levels.map((l) => (
                    <Button key={l.value} type="button" size="sm" variant={Number(field.value) === l.value ? "default" : "outline"} onClick={() => field.onChange(l.value)}>
                      {l.value} · {l.label}
                    </Button>
                  ))}
                </div>
              </Field>
            )}
          />
          <TextareaField control={form.control} name="note" label="Calibration note" rows={3} required placeholder="Why this rating, relative to the distribution" />
        </>
      )}
    </FormDialog>
  );
}
