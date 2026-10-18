"use client";

import { useWatch, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";
import { Download, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FormDialog } from "@/components/forms/form-dialog";
import { CheckboxField, SelectField, SwitchField, TextField, type Option } from "@/components/forms/fields";
import { ComboboxField } from "@/app/(app)/settings/_components/combobox-field";
import { COMPONENT_CALCS, COMPONENT_KINDS, componentSchema, loanSchema } from "@/lib/validation/payroll";
import { MONTHS } from "@/lib/india";
import { titleCase } from "@/lib/format";
import { createLoanAction, reviewDeclarationAction, saveComponentAction, seedComponentsAction, seedRuleSetsAction } from "../actions";
import { ConfirmButton, useRunAction } from "../_components/use-run-action";

export type ComponentFormValues = z.input<typeof componentSchema>;

const EMPTY: ComponentFormValues = {
  code: "",
  name: "",
  kind: "earning",
  calculation: "fixed",
  value: 0,
  isTaxable: true,
  isPartOfCtc: true,
  pfWage: false,
  esiWage: true,
  ptWage: true,
  prorate: true,
  payslipLabel: "",
  sortOrder: 100,
  isActive: true,
};

export function ComponentDialog({ values, isSystem }: { values?: ComponentFormValues; isSystem?: boolean }) {
  const editing = !!values?.id;
  return (
    <FormDialog
      wide
      trigger={
        editing ? (
          <Button variant="ghost" size="sm" aria-label={`Edit ${values?.code}`}>
            <Pencil /> Edit
          </Button>
        ) : (
          <Button size="sm">
            <Plus /> Add component
          </Button>
        )
      }
      title={editing ? `Edit ${values?.code}` : "Add a pay component"}
      description="Components are the building blocks of salary structures and payslips. Codes are permanent."
      schema={componentSchema}
      defaultValues={values ?? EMPTY}
      action={saveComponentAction}
      successMessage={editing ? "Component updated" : "Component added"}
    >
      {(form) => <ComponentFields form={form} editing={editing} isSystem={!!isSystem} />}
    </FormDialog>
  );
}

function ComponentFields({ form, editing, isSystem }: { form: UseFormReturn<z.input<typeof componentSchema>>; editing: boolean; isSystem: boolean }) {
  const c = form.control;
  const calculation = useWatch({ control: c, name: "calculation" });
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField control={c} name="code" label="Code" required disabled={editing} placeholder="TRANSPORT" />
        <TextField control={c} name="name" label="Name" required />
        <SelectField control={c} name="kind" label="Type" required disabled={isSystem} options={COMPONENT_KINDS.map((k) => ({ value: k, label: titleCase(k) }))} />
        <SelectField control={c} name="calculation" label="Default calculation" required disabled={isSystem} options={COMPONENT_CALCS.map((k) => ({ value: k, label: titleCase(k) }))} />
        {calculation !== "balancing" && calculation !== "statutory" && calculation !== "input" ? (
          <TextField control={c} name="value" label={calculation === "fixed" ? "Annual amount (₹)" : "Percent"} type="number" inputMode="decimal" description="Default only; structures set their own values." />
        ) : null}
        <TextField control={c} name="payslipLabel" label="Payslip label" />
        <TextField control={c} name="sortOrder" label="Order" type="number" inputMode="numeric" />
      </div>
      <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
        <CheckboxField control={c} name="isTaxable" label="Taxable" />
        <CheckboxField control={c} name="isPartOfCtc" label="Part of CTC" />
        <CheckboxField control={c} name="pfWage" label="Counts toward PF wages" />
        <CheckboxField control={c} name="esiWage" label="Counts toward ESI wages" />
        <CheckboxField control={c} name="ptWage" label="Counts toward PT wages" />
        <CheckboxField control={c} name="prorate" label="Prorate by payable days" />
      </div>
      <SwitchField control={c} name="isActive" label="Active" description="Inactive components cannot be used in structures or inputs." />
    </>
  );
}

/** Idempotent "load defaults" actions (server closures cannot cross into client components, so the kind selects the action). */
export function SeedButton({ kind, label, title, description }: { kind: "components" | "rules"; label: string; title: string; description: string }) {
  return (
    <ConfirmButton
      trigger={
        <Button size="sm" variant="outline">
          <Download /> {label}
        </Button>
      }
      title={title}
      description={description}
      confirmLabel={label}
      action={() => (kind === "components" ? seedComponentsAction({}) : seedRuleSetsAction({}))}
      success={(d: { created: number }) =>
        kind === "components"
          ? d.created
            ? `Added ${d.created} component${d.created === 1 ? "" : "s"}`
            : "All standard components already exist"
          : d.created
            ? `Loaded ${d.created} rule set${d.created === 1 ? "" : "s"} (unverified)`
            : "All default rule sets already exist"
      }
    />
  );
}

export function LoanDialog({ employees, defaults }: { employees: Option[]; defaults: { year: number; month: number } }) {
  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <Plus /> Record loan or advance
        </Button>
      }
      title="Record a loan or salary advance"
      description="Installments are recovered in each regular run from the start month until the balance is cleared. Repayments post when a run is locked."
      schema={loanSchema}
      defaultValues={{ employeeId: "", kind: "advance", principal: undefined, monthlyInstallment: undefined, startYear: defaults.year, startMonth: defaults.month, notes: "" }}
      action={createLoanAction}
      submitLabel="Record"
      successMessage="Loan recorded"
    >
      {(form) => (
        <>
          <ComboboxField control={form.control} name="employeeId" label="Employee" options={employees} />
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField control={form.control} name="kind" label="Type" options={[{ value: "advance", label: "Salary advance" }, { value: "loan", label: "Loan" }]} />
            <TextField control={form.control} name="principal" label="Amount (₹)" type="number" inputMode="decimal" required />
            <TextField control={form.control} name="monthlyInstallment" label="Monthly installment (₹)" type="number" inputMode="decimal" required />
            <SelectField control={form.control} name="startMonth" label="First recovery month" options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
            <TextField control={form.control} name="startYear" label="Year" type="number" inputMode="numeric" />
          </div>
          <TextField control={form.control} name="notes" label="Notes" />
        </>
      )}
    </FormDialog>
  );
}

export function DeclarationReviewButtons({ id }: { id: string }) {
  const { pending, run } = useRunAction();
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => reviewDeclarationAction({ id, decision: "return" }), { success: "Returned to the employee" })}>
        Return
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reviewDeclarationAction({ id, decision: "verify" }), { success: "Declaration verified" })}>
        {pending ? <Spinner /> : null}
        Verify
      </Button>
    </div>
  );
}
