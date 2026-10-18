"use client";

import { useState } from "react";
import type { z } from "zod";
import type { FieldValues } from "react-hook-form";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError, SelectField, SwitchField, TextField, TextareaField, type Option } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import type { ActionResult } from "@/lib/action-result";
import {
  businessUnitSchema,
  costCenterSchema,
  departmentSchema,
  designationSchema,
  gradeSchema,
  jobFamilySchema,
  STRUCTURE_LABELS,
  teamSchema,
  type StructureKind,
} from "@/lib/validation/settings";
import { ComboboxField } from "../_components/combobox-field";
import {
  saveBusinessUnitAction,
  saveCostCenterAction,
  saveDepartmentAction,
  saveDesignationAction,
  saveGradeAction,
  saveJobFamilyAction,
  saveTeamAction,
} from "./actions";

export type StructureOptions = {
  departments: Option[];
  jobFamilies: Option[];
  grades: Option[];
  costCenters: Option[];
  businessUnits: Option[];
  legalEntities: Option[];
  employees: Option[];
};

export type StructureValues = Record<string, unknown> & { id?: string; name?: string; title?: string };

const DESCRIPTIONS: Record<StructureKind, string> = {
  departments: "Departments group employees for reporting, approvals and analytics.",
  designations: "Job titles shown on profiles, letters and payslips.",
  grades: "Levels in your career ladder, with optional annual CTC bands.",
  job_families: "Groups of related designations, such as Engineering or Sales.",
  cost_centers: "Finance codes used to allocate payroll and expenses.",
  business_units: "Large divisions that own departments.",
  teams: "Small working groups inside a department.",
};

export function StructureDialog({
  kind,
  values,
  options,
}: {
  kind: StructureKind;
  values?: StructureValues;
  options: StructureOptions;
}) {
  const [open, setOpen] = useState(false);
  const label = STRUCTURE_LABELS[kind].singular;
  const editing = !!values?.id;
  const title = values?.name ?? values?.title;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="ghost" size="sm" aria-label={`Edit ${title}`}>
            <Pencil /> Edit
          </Button>
        ) : (
          <Button>
            <Plus /> Add {label}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${title}` : `Add ${label}`}</DialogTitle>
          <DialogDescription>{DESCRIPTIONS[kind]}</DialogDescription>
        </DialogHeader>
        {open ? <KindForm kind={kind} values={values} options={options} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function KindForm({ kind, values, options, onDone }: { kind: StructureKind; values?: StructureValues; options: StructureOptions; onDone: () => void }) {
  const props = { values, options, onDone };
  switch (kind) {
    case "departments":
      return <DepartmentForm {...props} />;
    case "designations":
      return <DesignationForm {...props} />;
    case "grades":
      return <GradeForm {...props} />;
    case "job_families":
      return <JobFamilyForm {...props} />;
    case "cost_centers":
      return <CostCenterForm {...props} />;
    case "business_units":
      return <BusinessUnitForm {...props} />;
    case "teams":
      return <TeamForm {...props} />;
  }
}

type FormProps = { values?: StructureValues; options: StructureOptions; onDone: () => void };

function useKindForm<S extends z.ZodType<FieldValues, FieldValues>>(
  schema: S,
  empty: z.input<S>,
  values: StructureValues | undefined,
  action: (v: z.output<S>) => Promise<ActionResult<{ id: string }>>,
  onDone: () => void,
) {
  return useActionForm<z.output<S>, { id: string }>({
    schema: schema as unknown as z.ZodType<z.output<S>, FieldValues>,
    defaultValues: { ...(empty as object), ...(values ?? {}) } as never,
    action,
    successMessage: values?.id ? "Saved" : "Added",
    onSuccess: onDone,
  });
}

function Footer({ pending, editing, onDone }: { pending: boolean; editing: boolean; onDone: () => void }) {
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner /> : null}
        {editing ? "Save changes" : "Add"}
      </Button>
    </DialogFooter>
  );
}

function DepartmentForm({ values, options, onDone }: FormProps) {
  const { form, submit, pending } = useKindForm(
    departmentSchema,
    { name: "", code: "", parentId: null, headEmployeeId: null, businessUnitId: null, costCenterId: null, isActive: true },
    values,
    saveDepartmentAction,
    onDone,
  );
  const c = form.control;
  const parents = options.departments.filter((d) => d.value !== values?.id);
  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <TextField control={c} name="name" label="Name" required placeholder="Engineering" />
          <TextField control={c} name="code" label="Code" placeholder="ENG" />
        </div>
        <SelectField control={c} name="parentId" label="Parent department" allowNone="None (top level)" options={parents} />
        <ComboboxField control={c} name="headEmployeeId" label="Department head" options={options.employees} placeholder="Choose an employee" description="Approves requisitions and other department-level requests." />
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField control={c} name="businessUnitId" label="Business unit" allowNone="None" options={options.businessUnits} />
          <SelectField control={c} name="costCenterId" label="Cost center" allowNone="None" options={options.costCenters} />
        </div>
        <SwitchField control={c} name="isActive" label="Active" />
        <Footer pending={pending} editing={!!values?.id} onDone={onDone} />
      </FieldGroup>
    </form>
  );
}

function DesignationForm({ values, options, onDone }: FormProps) {
  const { form, submit, pending } = useKindForm(
    designationSchema,
    { title: "", jobFamilyId: null, gradeId: null, description: "", isActive: true },
    values,
    saveDesignationAction,
    onDone,
  );
  const c = form.control;
  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <TextField control={c} name="title" label="Title" required placeholder="Senior Software Engineer" />
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField control={c} name="jobFamilyId" label="Job family" allowNone="None" options={options.jobFamilies} />
          <SelectField control={c} name="gradeId" label="Grade" allowNone="None" options={options.grades} />
        </div>
        <TextareaField control={c} name="description" label="Description" rows={3} />
        <SwitchField control={c} name="isActive" label="Active" />
        <Footer pending={pending} editing={!!values?.id} onDone={onDone} />
      </FieldGroup>
    </form>
  );
}

function GradeForm({ values, onDone }: FormProps) {
  const { form, submit, pending } = useKindForm(
    gradeSchema,
    { code: "", name: "", rank: 0, minAnnualCtcRupees: "", maxAnnualCtcRupees: "" },
    values,
    saveGradeAction,
    onDone,
  );
  const c = form.control;
  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <div className="grid gap-5 sm:grid-cols-[8rem_minmax(0,1fr)_6rem]">
          <TextField control={c} name="code" label="Code" required placeholder="L3" />
          <TextField control={c} name="name" label="Name" required placeholder="Senior" />
          <TextField control={c} name="rank" label="Rank" type="number" inputMode="numeric" />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField control={c} name="minAnnualCtcRupees" label="Minimum annual CTC (₹)" inputMode="numeric" placeholder="800000" />
          <TextField control={c} name="maxAnnualCtcRupees" label="Maximum annual CTC (₹)" inputMode="numeric" placeholder="1500000" />
        </div>
        <p className="text-xs text-muted-foreground">Higher rank means more senior. CTC bands are optional and only visible to people who can view compensation.</p>
        <Footer pending={pending} editing={!!values?.id} onDone={onDone} />
      </FieldGroup>
    </form>
  );
}

function JobFamilyForm({ values, onDone }: FormProps) {
  const { form, submit, pending } = useKindForm(jobFamilySchema, { name: "", description: "" }, values, saveJobFamilyAction, onDone);
  const c = form.control;
  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <TextField control={c} name="name" label="Name" required placeholder="Engineering" />
        <TextareaField control={c} name="description" label="Description" rows={3} />
        <Footer pending={pending} editing={!!values?.id} onDone={onDone} />
      </FieldGroup>
    </form>
  );
}

function CostCenterForm({ values, options, onDone }: FormProps) {
  const { form, submit, pending } = useKindForm(
    costCenterSchema,
    { code: "", name: "", legalEntityId: null, isActive: true },
    values,
    saveCostCenterAction,
    onDone,
  );
  const c = form.control;
  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <div className="grid gap-5 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <TextField control={c} name="code" label="Code" required placeholder="CC-100" />
          <TextField control={c} name="name" label="Name" required placeholder="Product development" />
        </div>
        <SelectField control={c} name="legalEntityId" label="Legal entity" allowNone="Any entity" options={options.legalEntities} />
        <SwitchField control={c} name="isActive" label="Active" />
        <Footer pending={pending} editing={!!values?.id} onDone={onDone} />
      </FieldGroup>
    </form>
  );
}

function BusinessUnitForm({ values, options, onDone }: FormProps) {
  const { form, submit, pending } = useKindForm(
    businessUnitSchema,
    { name: "", code: "", headEmployeeId: null, isActive: true },
    values,
    saveBusinessUnitAction,
    onDone,
  );
  const c = form.control;
  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <TextField control={c} name="name" label="Name" required placeholder="Consumer products" />
          <TextField control={c} name="code" label="Code" placeholder="CP" />
        </div>
        <ComboboxField control={c} name="headEmployeeId" label="Head" options={options.employees} placeholder="Choose an employee" />
        <SwitchField control={c} name="isActive" label="Active" />
        <Footer pending={pending} editing={!!values?.id} onDone={onDone} />
      </FieldGroup>
    </form>
  );
}

function TeamForm({ values, options, onDone }: FormProps) {
  const { form, submit, pending } = useKindForm(
    teamSchema,
    { name: "", departmentId: null, leadEmployeeId: null, isActive: true },
    values,
    saveTeamAction,
    onDone,
  );
  const c = form.control;
  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <TextField control={c} name="name" label="Name" required placeholder="Payments platform" />
        <SelectField control={c} name="departmentId" label="Department" allowNone="None" options={options.departments} />
        <ComboboxField control={c} name="leadEmployeeId" label="Team lead" options={options.employees} placeholder="Choose an employee" />
        <SwitchField control={c} name="isActive" label="Active" />
        <Footer pending={pending} editing={!!values?.id} onDone={onDone} />
      </FieldGroup>
    </form>
  );
}
