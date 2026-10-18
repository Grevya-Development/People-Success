"use client";

import { useRouter } from "next/navigation";
import { useFieldArray } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldGroup, FieldLegend, FieldSeparator, FieldSet } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { CheckboxField, FormError, SelectField, SwitchField, TextField, TextareaField } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { titleCase } from "@/lib/format";
import { EMPLOYMENT_TYPES, openingSchema, WORK_MODES, type OpeningInput } from "@/lib/validation/recruitment";
import type { RecruitmentLookups } from "@/server/services/recruitment/lookups";
import { createOpeningAction, updateOpeningAction } from "../actions";

const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: titleCase(v) }));

export function OpeningForm({
  lookups,
  requisitions,
  initial,
  id,
}: {
  lookups: RecruitmentLookups;
  requisitions: { value: string; label: string }[];
  initial?: Partial<OpeningInput>;
  id?: string;
}) {
  const router = useRouter();
  const { form, submit, pending } = useActionForm({
    schema: openingSchema,
    defaultValues: {
      requisitionId: null,
      title: "",
      slug: "",
      description: "",
      requirements: "",
      experienceMinYears: null,
      experienceMaxYears: null,
      departmentId: null,
      locationId: null,
      workMode: "onsite",
      employmentType: "full_time",
      salaryMinAnnual: null,
      salaryMaxAnnual: null,
      showSalary: false,
      openings: 1,
      closesOn: null,
      hiringManagerEmployeeId: null,
      recruiterUserId: null,
      questions: [],
      ...(initial as object),
      skills: (initial?.skills ?? []).join(", ") as unknown as string[],
    } as never,
    action: async (data: OpeningInput) => {
      if (id) return updateOpeningAction({ id, data });
      return createOpeningAction(data);
    },
    successMessage: id ? "Job saved" : "Job created as a draft",
    onSuccess: (d) => router.push(`/recruitment/openings/${id ?? d.id}${id ? "?tab=details" : "?tab=details"}`),
  });
  const c = form.control;
  const questions = useFieldArray({ control: c, name: "questions" });

  return (
    <form onSubmit={submit} noValidate className="rounded-xl border bg-card p-6">
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <FieldSet>
          <FieldLegend>Job</FieldLegend>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField control={c} name="title" label="Job title" required className="sm:col-span-2" />
            <SelectField control={c} name="requisitionId" label="Requisition" options={requisitions} allowNone="No requisition (direct)" description="Approved requisitions only." />
            <TextField control={c} name="slug" label="Careers page link" placeholder="Generated from the title" description="Lowercase letters, numbers and hyphens." />
            <SelectField control={c} name="departmentId" label="Department" options={lookups.departments} allowNone="None" />
            <SelectField control={c} name="locationId" label="Location" options={lookups.locations} allowNone="None" />
            <SelectField control={c} name="workMode" label="Work mode" options={opts(WORK_MODES)} />
            <SelectField control={c} name="employmentType" label="Employment type" options={opts(EMPLOYMENT_TYPES)} />
            <TextField control={c} name="openings" label="Seats" type="number" inputMode="numeric" required description="The job closes when this many are hired." />
            <TextField control={c} name="closesOn" label="Applications close on" type="date" />
            <SelectField control={c} name="hiringManagerEmployeeId" label="Hiring manager" options={lookups.employees} allowNone="None" />
            <SelectField control={c} name="recruiterUserId" label="Recruiter" options={lookups.recruiters} allowNone="Me" />
          </div>
        </FieldSet>
        <FieldSeparator />
        <FieldSet>
          <FieldLegend>Description and requirements</FieldLegend>
          <TextareaField control={c} name="description" label="Description" rows={8} required description="Markdown supported: ## headings, - bullets, **bold**." />
          <TextareaField control={c} name="requirements" label="Requirements" rows={5} description="One requirement per line. AI and rule-based matching assess candidates only against these and the skills below." />
          <TextField control={c} name="skills" label="Skills" placeholder="TypeScript, PostgreSQL, Kubernetes" description="Comma-separated, up to 30." />
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField control={c} name="experienceMinYears" label="Experience from (years)" type="number" inputMode="numeric" />
            <TextField control={c} name="experienceMaxYears" label="Experience up to (years)" type="number" inputMode="numeric" />
          </div>
        </FieldSet>
        <FieldSeparator />
        <FieldSet>
          <FieldLegend>Salary range</FieldLegend>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField control={c} name="salaryMinAnnual" label="Annual CTC from (₹)" inputMode="decimal" />
            <TextField control={c} name="salaryMaxAnnual" label="Annual CTC up to (₹)" inputMode="decimal" />
          </div>
          <SwitchField control={c} name="showSalary" label="Show the range on the careers page" description="Off keeps the range internal." />
        </FieldSet>
        <FieldSeparator />
        <FieldSet>
          <FieldLegend>Screening questions</FieldLegend>
          <p className="text-sm text-muted-foreground">Ask only job-related questions (notice period, location preference, work authorisation). Never ask about age, family or other personal characteristics.</p>
          {questions.fields.map((q, i) => (
            <div key={q.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_9rem_auto_auto] sm:items-end">
              <TextField control={c} name={`questions.${i}.label`} label={`Question ${i + 1}`} required />
              <SelectField control={c} name={`questions.${i}.type`} label="Answer" options={[{ value: "text", label: "Text" }, { value: "yes_no", label: "Yes / no" }, { value: "number", label: "Number" }]} />
              <CheckboxField control={c} name={`questions.${i}.required`} label="Required" />
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove question ${i + 1}`} onClick={() => questions.remove(i)}>
                <Trash2 />
              </Button>
            </div>
          ))}
          {questions.fields.length < 10 ? (
            <div>
              <Button type="button" size="sm" variant="outline" onClick={() => questions.append({ id: `q${Date.now().toString(36)}`, label: "", type: "text", required: false })}>
                <Plus /> Add question
              </Button>
            </div>
          ) : null}
        </FieldSet>
        <div className="flex justify-end gap-2 border-t pt-5">
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            {id ? "Save job" : "Create draft"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
