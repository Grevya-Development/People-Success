"use client";

import { Controller, useFieldArray, useWatch, type UseFormReturn } from "react-hook-form";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, SwitchField, TextField, TextareaField, type Option } from "@/components/forms/fields";
import { MultiSelectField } from "@/app/(app)/performance/_components/multi-select";
import { SURVEY_KINDS, SURVEY_QUESTION_TYPES, SURVEY_QUESTION_TYPE_LABELS, surveySchema } from "@/lib/validation/talent";
import { SURVEY_TEMPLATES } from "@/lib/talent/survey";
import { titleCase } from "@/lib/format";
import { saveSurveyAction } from "../actions";

const newId = () => Math.random().toString(36).slice(2, 10);

type Q = { id: string; label: string; type: (typeof SURVEY_QUESTION_TYPES)[number]; options?: string[]; driver?: string; required: boolean };
export type SurveyFormValues = {
  id?: string | null;
  title: string;
  kind: (typeof SURVEY_KINDS)[number];
  description: string | null;
  isAnonymous: boolean;
  minGroupSize: number;
  questions: Q[];
  audienceAll: boolean;
  departmentIds: string[];
  locationIds: string[];
  opensOn: string | null;
  closesOn: string | null;
};

export function SurveyDialog({ values, departments, locations }: { values?: SurveyFormValues; departments: Option[]; locations: Option[] }) {
  const editing = !!values?.id;
  const defaults: SurveyFormValues = values ?? {
    title: "",
    kind: "pulse",
    description: null,
    isAnonymous: true,
    minGroupSize: 5,
    questions: SURVEY_TEMPLATES.pulse.questions.map((q) => ({ ...q })),
    audienceAll: true,
    departmentIds: [],
    locationIds: [],
    opensOn: null,
    closesOn: null,
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
            <Plus /> New survey
          </Button>
        )
      }
      title={editing ? "Edit survey" : "New survey"}
      description="Anonymous surveys store no respondent identity. Results are shown only for groups of at least the minimum size."
      schema={surveySchema}
      defaultValues={defaults as never}
      action={saveSurveyAction}
      submitLabel={editing ? "Save survey" : "Create draft"}
      successMessage={editing ? "Survey updated" : "Draft survey created"}
    >
      {(form) => <SurveyFields form={form as unknown as UseFormReturn<SurveyFormValues>} departments={departments} locations={locations} />}
    </FormDialog>
  );
}

function SurveyFields({ form, departments, locations }: { form: UseFormReturn<SurveyFormValues>; departments: Option[]; locations: Option[] }) {
  const c = form.control;
  const { fields, append, remove, replace } = useFieldArray({ control: c, name: "questions" });
  const questions = useWatch({ control: c, name: "questions" });
  const audienceAll = useWatch({ control: c, name: "audienceAll" });
  const anonymous = useWatch({ control: c, name: "isAnonymous" });
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <TextField control={c} name="title" label="Title" required placeholder="October pulse" />
        <SelectField control={c} name="kind" label="Type" options={SURVEY_KINDS.map((k) => ({ value: k, label: titleCase(k) }))} />
      </div>
      <TextareaField control={c} name="description" label="Introduction" rows={2} />
      <div className="grid gap-5 sm:grid-cols-2">
        <SwitchField control={c} name="isAnonymous" label="Anonymous" description="Responses keep only department, location and tenure band." />
        <TextField control={c} name="minGroupSize" label="Minimum group size" type="number" description={anonymous ? "At least 3. Smaller groups show 'Not enough responses'." : "At least 3."} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField control={c} name="opensOn" label="Opens on" type="date" />
        <TextField control={c} name="closesOn" label="Closes on" type="date" />
      </div>
      <FieldSet>
        <FieldLegend variant="label">Audience</FieldLegend>
        <SwitchField control={c} name="audienceAll" label="Everyone" />
        {!audienceAll ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <MultiSelectField control={c} name="departmentIds" label="Departments" options={departments} />
            <MultiSelectField control={c} name="locationIds" label="Locations" options={locations} />
          </div>
        ) : null}
      </FieldSet>
      <FieldSet>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FieldLegend variant="label">Questions</FieldLegend>
          <div className="flex flex-wrap gap-1">
            {Object.entries(SURVEY_TEMPLATES).map(([key, t]) => (
              <Button key={key} type="button" variant="ghost" size="sm" onClick={() => replace(t.questions.map((q) => ({ ...q, id: q.id })))}>
                Use {t.label.toLowerCase()}
              </Button>
            ))}
          </div>
        </div>
        {fields.map((f, i) => (
          <div key={f.id} className="space-y-2 rounded-lg border p-3">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
              <TextField control={c} name={`questions.${i}.label`} label={`Question ${i + 1}`} />
              <SelectField control={c} name={`questions.${i}.type`} label="Answer" options={SURVEY_QUESTION_TYPES.map((t) => ({ value: t, label: SURVEY_QUESTION_TYPE_LABELS[t] }))} />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove question" disabled={fields.length <= 1} onClick={() => remove(i)}>
                <Trash2 />
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {questions?.[i]?.type === "scale" ? <TextField control={c} name={`questions.${i}.driver`} label="Driver" placeholder="Recognition, Growth…" /> : null}
              {questions?.[i]?.type === "choice" ? (
                <Controller
                  control={c}
                  name={`questions.${i}.options`}
                  render={({ field }) => (
                    <div className="space-y-1">
                      <label className="text-sm font-medium" htmlFor={`opts-${f.id}`}>
                        Options (one per line)
                      </label>
                      <textarea
                        id={`opts-${f.id}`}
                        rows={3}
                        className="w-full rounded-md border bg-transparent px-2.5 py-1.5 text-sm"
                        defaultValue={(field.value ?? []).join("\n")}
                        onBlur={(e) => field.onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
                      />
                    </div>
                  )}
                />
              ) : null}
            </div>
            <Controller
              control={c}
              name={`questions.${i}.required`}
              render={({ field }) => (
                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox checked={!!field.value} onCheckedChange={(v) => field.onChange(v === true)} /> Required
                </label>
              )}
            />
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => append({ id: newId(), label: "", type: "scale", required: true })}>
          <Plus /> Add question
        </Button>
      </FieldSet>
    </>
  );
}
