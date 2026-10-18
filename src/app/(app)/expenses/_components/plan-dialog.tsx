"use client";

import { useId } from "react";
import { Controller, type Control, type FieldPath, type UseFormReturn } from "react-hook-form";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, SwitchField, TextField, TextareaField } from "@/components/forms/fields";
import {
  BENEFIT_KINDS,
  BENEFIT_KIND_LABELS,
  COVERAGE_LABELS,
  COVERAGE_OPTIONS,
  EMPLOYMENT_TYPES,
  benefitPlanSchema,
  paiseToRupees,
  type BenefitPlanInput,
} from "@/lib/validation/expenses";
import { titleCase } from "@/lib/format";
import { createBenefitPlanAction, updateBenefitPlanAction } from "../actions";

export type EligibilityOptions = {
  locations: { value: string; label: string }[];
  legalEntities: { value: string; label: string }[];
  grades: { value: string; label: string }[];
};

export type PlanValues = {
  id: string;
  name: string;
  kind: string;
  description: string | null;
  provider: string | null;
  eligibility: Record<string, string | string[]>;
  employerContribution: number;
  employeeContribution: number;
  deductFromSalary: boolean;
  coverageOptions: string[];
  enrollmentOpensOn: string | null;
  enrollmentClosesOn: string | null;
  isActive: boolean;
};

function CheckboxGroup({
  control,
  name,
  legend,
  options,
  hint,
}: {
  control: Control<BenefitPlanInput>;
  name: FieldPath<BenefitPlanInput>;
  legend: string;
  options: { value: string; label: string }[];
  hint?: string;
}) {
  const id = useId();
  if (!options.length) return null;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const value = (field.value as string[] | undefined) ?? [];
        return (
          <FieldSet>
            <FieldLegend variant="label">{legend}</FieldLegend>
            {hint ? <p className="-mt-1 text-xs text-muted-foreground">{hint}</p> : null}
            <div className="grid gap-2 sm:grid-cols-2">
              {options.map((o) => (
                <Field key={o.value} orientation="horizontal">
                  <Checkbox
                    id={`${id}-${o.value}`}
                    checked={value.includes(o.value)}
                    onCheckedChange={(on) => field.onChange(on ? [...value, o.value] : value.filter((v) => v !== o.value))}
                  />
                  <FieldLabel htmlFor={`${id}-${o.value}`} className="font-normal">
                    {o.label}
                  </FieldLabel>
                </Field>
              ))}
            </div>
            <FieldError errors={[fieldState.error]} />
          </FieldSet>
        );
      }}
    />
  );
}

function Fields({ form, options }: { form: UseFormReturn<BenefitPlanInput>; options: EligibilityOptions }) {
  const c = form.control;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={c} name="name" label="Plan name" required />
        <SelectField control={c} name="kind" label="Type" required options={BENEFIT_KINDS.map((k) => ({ value: k, label: BENEFIT_KIND_LABELS[k] }))} />
      </div>
      <TextField control={c} name="provider" label="Provider / insurer" />
      <TextareaField control={c} name="description" label="Description" rows={3} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={c} name="employerContribution" label="Employer cost per month (₹)" inputMode="decimal" />
        <TextField control={c} name="employeeContribution" label="Employee contribution per month (₹)" inputMode="decimal" />
      </div>
      <SwitchField control={c} name="deductFromSalary" label="Deduct employee contribution from salary" description="Posted as a payroll deduction in every open payroll period." />
      <CheckboxGroup control={c} name="coverageOptions" legend="Coverage options" options={COVERAGE_OPTIONS.map((o) => ({ value: o, label: COVERAGE_LABELS[o] }))} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={c} name="enrollmentOpensOn" label="Enrollment opens" type="date" description="Blank = open now" />
        <TextField control={c} name="enrollmentClosesOn" label="Enrollment closes" type="date" description="Blank = no end date" />
      </div>
      <CheckboxGroup control={c} name="eligibleEmploymentTypes" legend="Eligible employment types" hint="Leave all unticked for everyone." options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: titleCase(t) }))} />
      <CheckboxGroup control={c} name="eligibleLegalEntityIds" legend="Eligible legal entities" options={options.legalEntities} />
      <CheckboxGroup control={c} name="eligibleLocationIds" legend="Eligible locations" options={options.locations} />
      <CheckboxGroup control={c} name="eligibleGradeIds" legend="Eligible grades" options={options.grades} />
      <SwitchField control={c} name="isActive" label="Active" description="Inactive plans are hidden from employees." />
    </>
  );
}

const list = (v: string | string[] | undefined) => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function PlanDialog({ plan, options }: { plan?: PlanValues; options: EligibilityOptions }) {
  const defaults: BenefitPlanInput = plan
    ? {
        name: plan.name,
        kind: plan.kind as BenefitPlanInput["kind"],
        description: plan.description,
        provider: plan.provider,
        eligibleEmploymentTypes: list(plan.eligibility.employmentType) as BenefitPlanInput["eligibleEmploymentTypes"],
        eligibleLocationIds: list(plan.eligibility.locationId),
        eligibleLegalEntityIds: list(plan.eligibility.legalEntityId),
        eligibleGradeIds: list(plan.eligibility.gradeId),
        employerContribution: paiseToRupees(plan.employerContribution) ?? 0,
        employeeContribution: paiseToRupees(plan.employeeContribution) ?? 0,
        deductFromSalary: plan.deductFromSalary,
        coverageOptions: plan.coverageOptions as BenefitPlanInput["coverageOptions"],
        enrollmentOpensOn: plan.enrollmentOpensOn,
        enrollmentClosesOn: plan.enrollmentClosesOn,
        isActive: plan.isActive,
      }
    : {
        name: "",
        kind: "health_insurance",
        description: null,
        provider: null,
        eligibleEmploymentTypes: [],
        eligibleLocationIds: [],
        eligibleLegalEntityIds: [],
        eligibleGradeIds: [],
        employerContribution: 0,
        employeeContribution: 0,
        deductFromSalary: false,
        coverageOptions: ["self"],
        enrollmentOpensOn: null,
        enrollmentClosesOn: null,
        isActive: true,
      };
  return (
    <FormDialog
      wide
      trigger={
        plan ? (
          <Button size="icon-sm" variant="ghost" aria-label={`Edit ${plan.name}`}>
            <Pencil />
          </Button>
        ) : (
          <Button size="sm">
            <Plus data-icon="inline-start" /> New plan
          </Button>
        )
      }
      title={plan ? `Edit ${plan.name}` : "New benefit plan"}
      description="Contributions are monthly amounts in rupees."
      schema={benefitPlanSchema}
      defaultValues={defaults}
      action={(values) => (plan ? updateBenefitPlanAction({ ...values, id: plan.id }) : createBenefitPlanAction(values))}
      successMessage={plan ? "Plan saved" : "Plan created"}
      submitLabel={plan ? "Save" : "Create plan"}
    >
      {(form) => <Fields form={form} options={options} />}
    </FormDialog>
  );
}
