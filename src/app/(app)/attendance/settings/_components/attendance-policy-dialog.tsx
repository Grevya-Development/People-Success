"use client";

import { Pencil, Plus } from "lucide-react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, SwitchField, TextField, type Option } from "@/components/forms/fields";
import { attendancePolicySchema } from "@/lib/validation/time";
import { saveAttendancePolicyAction } from "../../actions";
import { ConditionsFields, type ConditionOptions } from "../../_components/form-parts";

type Values = z.output<typeof attendancePolicySchema>;

const EMPTY: Values = {
  name: "",
  priority: 10,
  conditions: { employmentType: [], locationId: [], legalEntityId: [], departmentId: [] },
  defaultShiftId: null,
  allowWebCheckIn: true,
  requireGeofence: false,
  lateMarksPerHalfDay: null,
  overtimeEnabled: false,
  overtimeMinMinutes: 30,
  regularizationWindowDays: 7,
  maxRegularizationsPerMonth: 3,
  autoMarkAbsentWithoutPunch: true,
  isActive: true,
};

export function AttendancePolicyDialog({ values, shifts, options }: { values?: Values; shifts: Option[]; options: ConditionOptions }) {
  const editing = !!values?.id;
  return (
    <FormDialog
      wide
      trigger={
        editing ? (
          <Button variant="ghost" size="sm">
            <Pencil /> Edit
          </Button>
        ) : (
          <Button size="sm">
            <Plus /> New policy
          </Button>
        )
      }
      title={editing ? `Edit ${values?.name}` : "New attendance policy"}
      description="The highest-priority active policy whose conditions match an employee applies to them."
      schema={attendancePolicySchema}
      defaultValues={values ?? EMPTY}
      action={saveAttendancePolicyAction}
      successMessage={editing ? "Policy updated" : "Policy created"}
    >
      {(form) => (
        <>
          <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
            <TextField control={form.control} name="name" label="Name" required />
            <TextField control={form.control} name="priority" label="Priority" inputMode="numeric" description="Higher wins" />
          </div>
          <SelectField control={form.control} name="defaultShiftId" label="Default shift" allowNone="Tenant default" options={shifts} description="For covered employees without a shift assignment." />
          <FieldSet>
            <FieldLegend variant="label">Check-in</FieldLegend>
            <SwitchField control={form.control} name="allowWebCheckIn" label="Allow web check-in" description="Browser punches are recorded as self-reported unless location-verified." />
            <SwitchField control={form.control} name="requireGeofence" label="Require geofence" description="Refuse web punches outside the employee's location geofence." />
            <SwitchField control={form.control} name="autoMarkAbsentWithoutPunch" label="Mark absent without punches" description="Off: working days without punches count as present (for teams that do not track attendance)." />
          </FieldSet>
          <FieldSet>
            <FieldLegend variant="label">Rules</FieldLegend>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="lateMarksPerHalfDay" label="Late marks per half-day deduction" inputMode="numeric" description="Empty = no deduction" />
              <TextField control={form.control} name="regularizationWindowDays" label="Correction window (days)" inputMode="numeric" />
              <TextField control={form.control} name="maxRegularizationsPerMonth" label="Corrections per month" inputMode="numeric" description="Empty = unlimited" />
              <TextField control={form.control} name="overtimeMinMinutes" label="Minimum overtime (min)" inputMode="numeric" />
            </div>
            <SwitchField control={form.control} name="overtimeEnabled" label="Track overtime" description="Minutes beyond the full day, once above the minimum." />
          </FieldSet>
          <ConditionsFields control={form.control} prefix="conditions" options={options} />
          <SwitchField control={form.control} name="isActive" label="Active" />
        </>
      )}
    </FormDialog>
  );
}
