"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldGroup, FieldSeparator, FieldSet, FieldLegend } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError, SelectField, TextField } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { createEmployeeSchema, EMPLOYMENT_TYPES, GENDERS, WORK_MODES } from "@/lib/validation/employees";
import { titleCase } from "@/lib/format";
import type { EmployeeFormLookups } from "@/server/services/employees/lookups";
import { createEmployeeAction } from "../actions";

const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: titleCase(v) }));

export function NewEmployeeForm({ lookups, canSetCompensation, today }: { lookups: EmployeeFormLookups; canSetCompensation: boolean; today: string }) {
  const router = useRouter();
  const { form, submit, pending } = useActionForm({
    schema: createEmployeeSchema,
    defaultValues: {
      firstName: "",
      middleName: "",
      lastName: "",
      workEmail: "",
      personalEmail: "",
      phone: "",
      dateOfBirth: "",
      gender: null,
      employeeCode: "",
      legalEntityId: lookups.defaultLegalEntityId ?? "",
      departmentId: null,
      designationId: null,
      locationId: null,
      managerId: null,
      gradeId: null,
      costCenterId: null,
      employmentType: "full_time",
      workerType: "employee",
      workMode: "onsite",
      joiningDate: today,
      probationMonths: 6,
      noticePeriodDays: 30,
      annualCtc: "",
    },
    action: createEmployeeAction,
    successMessage: (d) => `Employee ${d.code} created`,
    onSuccess: (d) => router.push(`/employees/${d.id}`),
  });
  const c = form.control;

  return (
    <form onSubmit={submit} noValidate className="rounded-xl border bg-card p-6">
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <FieldSet>
          <FieldLegend>Personal</FieldLegend>
          <div className="grid gap-5 sm:grid-cols-3">
            <TextField control={c} name="firstName" label="First name" required autoComplete="off" />
            <TextField control={c} name="middleName" label="Middle name" autoComplete="off" />
            <TextField control={c} name="lastName" label="Last name" autoComplete="off" />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField control={c} name="workEmail" label="Work email" type="email" description="Used to invite them to sign in." />
            <TextField control={c} name="personalEmail" label="Personal email" type="email" />
            <TextField control={c} name="phone" label="Mobile" inputMode="tel" />
            <TextField control={c} name="dateOfBirth" label="Date of birth" type="date" />
            <SelectField control={c} name="gender" label="Gender" options={opts(GENDERS)} allowNone="Not specified" />
          </div>
        </FieldSet>
        <FieldSeparator />
        <FieldSet>
          <FieldLegend>Employment</FieldLegend>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField control={c} name="joiningDate" label="Joining date" type="date" required description="Future dates create a pre-joining record." />
            <TextField control={c} name="employeeCode" label="Employee ID" placeholder="Generated automatically" description="Leave blank to use your ID format." />
            <SelectField control={c} name="legalEntityId" label="Legal entity" options={lookups.legalEntities} required />
            <SelectField control={c} name="employmentType" label="Employment type" options={opts(EMPLOYMENT_TYPES)} />
            <SelectField control={c} name="workerType" label="Worker type" options={opts(["employee", "contractor"])} />
            <SelectField control={c} name="workMode" label="Work mode" options={opts(WORK_MODES)} />
            <TextField control={c} name="probationMonths" label="Probation (months)" type="number" inputMode="numeric" />
            <TextField control={c} name="noticePeriodDays" label="Notice period (days)" type="number" inputMode="numeric" />
          </div>
        </FieldSet>
        <FieldSeparator />
        <FieldSet>
          <FieldLegend>Role and reporting</FieldLegend>
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField control={c} name="designationId" label="Designation" options={lookups.designations} allowNone="None" />
            <SelectField control={c} name="departmentId" label="Department" options={lookups.departments} allowNone="None" />
            <SelectField control={c} name="managerId" label="Reporting manager" options={lookups.managers} allowNone="No manager" />
            <SelectField control={c} name="locationId" label="Work location" options={lookups.locations} allowNone="None" />
            <SelectField control={c} name="gradeId" label="Grade" options={lookups.grades} allowNone="None" />
            <SelectField control={c} name="costCenterId" label="Cost center" options={lookups.costCenters} allowNone="None" />
          </div>
          {!lookups.departments.length || !lookups.designations.length ? (
            <p className="text-sm text-muted-foreground">
              Departments and designations are managed in{" "}
              <Link href="/settings/structure" className="font-medium text-foreground underline-offset-4 hover:underline">
                Settings → Structure
              </Link>
              .
            </p>
          ) : null}
        </FieldSet>
        {canSetCompensation ? (
          <>
            <FieldSeparator />
            <FieldSet>
              <FieldLegend>Compensation</FieldLegend>
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField
                  control={c}
                  name="annualCtc"
                  label="Annual CTC (₹)"
                  type="number"
                  inputMode="decimal"
                  description="Optional. Salary structure is assigned in Payroll."
                />
              </div>
            </FieldSet>
          </>
        ) : null}
        <div className="flex justify-end gap-2 border-t pt-5">
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            Create employee
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
