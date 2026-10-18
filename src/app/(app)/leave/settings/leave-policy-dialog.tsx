"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import type { z } from "zod";
import { useFieldArray, useWatch, type UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, SwitchField, TextField, type Option } from "@/components/forms/fields";
import { leavePolicySchema } from "@/lib/validation/time";
import { saveLeavePolicyAction } from "../actions";
import { ConditionsFields, type ConditionOptions } from "@/app/(app)/attendance/_components/form-parts";

export type LeavePolicyValues = z.output<typeof leavePolicySchema>;

export const emptyPolicy = (leaveTypeId: string, effectiveFrom: string): LeavePolicyValues => ({
  leaveTypeId,
  name: "",
  priority: 0,
  effectiveFrom,
  conditions: { employmentType: [], locationId: [], legalEntityId: [], departmentId: [] },
  accrualMethod: "monthly",
  daysPerYear: 12,
  prorateOnJoining: true,
  waitingPeriodDays: 0,
  carryForwardEnabled: false,
  carryForwardMaxDays: 0,
  carryForwardExpiresAfterMonths: null,
  encashmentEnabled: false,
  encashmentMaxDaysPerYear: 0,
  maxBalance: null,
  minNoticeDays: 0,
  maxConsecutiveDays: null,
  sandwich: false,
  blackouts: [],
});

const ACCRUAL = [
  { value: "monthly", label: "Monthly (credited on the 1st)" },
  { value: "quarterly", label: "Quarterly (start of each quarter)" },
  { value: "annual_upfront", label: "Yearly, up front (1 January)" },
  { value: "none", label: "No accrual (granted by HR)" },
];

export function LeavePolicyDialog({
  values,
  types,
  options,
  defaultTypeId,
  today,
}: {
  values?: LeavePolicyValues;
  types: Option[];
  options: ConditionOptions;
  defaultTypeId?: string;
  today: string;
}) {
  const editing = !!values?.id;
  return (
    <FormDialog
      wide
      trigger={
        editing ? (
          <Button variant="ghost" size="sm">
            <Pencil /> New version
          </Button>
        ) : (
          <Button size="sm" variant="outline">
            <Plus /> New policy
          </Button>
        )
      }
      title={editing ? `New version of ${values?.name}` : "New leave policy"}
      description={
        editing
          ? "Saving publishes a new version from the effective date. Earlier dates keep using the current version, so past leave is not recalculated."
          : "A policy sets accrual and usage rules for one leave type and group of employees."
      }
      schema={leavePolicySchema}
      defaultValues={values ? { ...values, effectiveFrom: values.effectiveFrom > today ? values.effectiveFrom : today } : emptyPolicy(defaultTypeId ?? types[0]?.value ?? "", today)}
      action={saveLeavePolicyAction}
      submitLabel={editing ? "Publish version" : "Create policy"}
      successMessage={(d) => (editing ? `Version ${d.version} published` : "Policy created")}
    >
      {(form) => <PolicyFields form={form} types={types} options={options} editing={editing} />}
    </FormDialog>
  );
}

function PolicyFields({ form, types, options, editing }: { form: UseFormReturn<LeavePolicyValues>; types: Option[]; options: ConditionOptions; editing: boolean }) {
  const c = form.control;
  const [method, cf, enc] = useWatch({ control: c, name: ["accrualMethod", "carryForwardEnabled", "encashmentEnabled"] });
  const blackouts = useFieldArray({ control: c, name: "blackouts" });
  return (
    <>
      <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Numbers here are your company&apos;s rules. Statutory minimums differ by state (Shops &amp; Establishments Acts, Factories Act); review them with your HR or legal advisor.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField control={c} name="leaveTypeId" label="Leave type" options={types} disabled={editing} required />
        <TextField control={c} name="name" label="Policy name" required disabled={editing} placeholder="Earned leave — full time" />
        <TextField control={c} name="effectiveFrom" label="Effective from" type="date" required />
        <TextField control={c} name="priority" label="Priority" inputMode="numeric" description="Higher wins when several match" />
      </div>
      <FieldSet>
        <FieldLegend variant="label">Accrual</FieldLegend>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField control={c} name="accrualMethod" label="Method" options={ACCRUAL} />
          {method !== "none" ? <TextField control={c} name="daysPerYear" label="Days per year" inputMode="decimal" /> : null}
        </div>
        {method !== "none" ? (
          <SwitchField control={c} name="prorateOnJoining" label="Prorate on joining" description="New joiners earn from their joining date. Credits round to the nearest half day, cumulatively over the year." />
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={c} name="maxBalance" label="Maximum balance" inputMode="decimal" description="Accrual stops at this cap. Empty = no cap." />
          <TextField control={c} name="waitingPeriodDays" label="Waiting period (days)" inputMode="numeric" description="Days after joining before it can be used." />
        </div>
      </FieldSet>
      <FieldSet>
        <FieldLegend variant="label">Year end</FieldLegend>
        <FieldDescription>Leave year: January to December. Unused days lapse on 1 January except what is carried forward.</FieldDescription>
        <SwitchField control={c} name="carryForwardEnabled" label="Carry forward" />
        {cf ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField control={c} name="carryForwardMaxDays" label="Carry forward up to (days)" inputMode="decimal" />
            <TextField control={c} name="carryForwardExpiresAfterMonths" label="Carried days expire after (months)" inputMode="numeric" description="Empty = never" />
          </div>
        ) : null}
        <SwitchField control={c} name="encashmentEnabled" label="Encashment allowed" description="Recorded for payroll and full-and-final settlement." />
        {enc ? <TextField control={c} name="encashmentMaxDaysPerYear" label="Encash up to (days per year)" inputMode="decimal" /> : null}
      </FieldSet>
      <FieldSet>
        <FieldLegend variant="label">Usage rules</FieldLegend>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={c} name="minNoticeDays" label="Minimum notice (days)" inputMode="numeric" />
          <TextField control={c} name="maxConsecutiveDays" label="Maximum days at a time" inputMode="decimal" description="Empty = no limit" />
        </div>
        <SwitchField control={c} name="sandwich" label="Sandwich rule" description="Weekly offs and holidays between two leave days count as leave." />
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Blackout periods</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => blackouts.append({ from: "", to: "", reason: "" })}>
              <Plus /> Add
            </Button>
          </div>
          {blackouts.fields.length === 0 ? <p className="text-xs text-muted-foreground">No blackouts: leave can be taken any time.</p> : null}
          {blackouts.fields.map((f, i) => (
            <div key={f.id} className="grid items-end gap-2 rounded-lg border p-3 sm:grid-cols-[9rem_9rem_1fr_auto]">
              <TextField control={c} name={`blackouts.${i}.from`} label="From" type="date" />
              <TextField control={c} name={`blackouts.${i}.to`} label="To" type="date" />
              <TextField control={c} name={`blackouts.${i}.reason`} label="Reason" placeholder="Year-end close" />
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove blackout" onClick={() => blackouts.remove(i)}>
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      </FieldSet>
      <ConditionsFields control={c} prefix="conditions" options={options} />
    </>
  );
}
