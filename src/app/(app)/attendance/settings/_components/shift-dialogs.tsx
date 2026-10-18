"use client";

import { Pencil, Plus } from "lucide-react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, SwitchField, TextField, type Option } from "@/components/forms/fields";
import { ComboboxField } from "@/app/(app)/settings/_components/combobox-field";
import { shiftAssignmentSchema, shiftSchema } from "@/lib/validation/time";
import { assignShiftAction, saveShiftAction } from "../../actions";
import { WeekdaysField } from "../../_components/form-parts";

type ShiftValues = z.output<typeof shiftSchema>;

const EMPTY: ShiftValues = {
  name: "",
  code: "",
  startTime: "09:30",
  endTime: "18:30",
  breakMinutes: 60,
  graceInMinutes: 15,
  graceOutMinutes: 15,
  halfDayMinutes: 240,
  fullDayMinutes: 480,
  weeklyOffs: [0, 6],
  isFlexible: false,
  isNight: false,
  isActive: true,
};

export function ShiftDialog({ values }: { values?: ShiftValues }) {
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
            <Plus /> New shift
          </Button>
        )
      }
      title={editing ? `Edit ${values?.name}` : "New shift"}
      description="Times are India Standard Time. Worked minutes decide full and half days; late and early marks start after the grace period."
      schema={shiftSchema}
      defaultValues={values ?? EMPTY}
      action={saveShiftAction}
      successMessage={editing ? "Shift updated" : "Shift created"}
    >
      {(form) => (
        <>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <TextField control={form.control} name="name" label="Name" required placeholder="General shift" />
            <TextField control={form.control} name="code" label="Code" required placeholder="GEN" />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <TextField control={form.control} name="startTime" label="Start" type="time" required />
            <TextField control={form.control} name="endTime" label="End" type="time" required />
            <TextField control={form.control} name="breakMinutes" label="Break (min)" inputMode="numeric" />
            <TextField control={form.control} name="graceInMinutes" label="Late grace (min)" inputMode="numeric" />
            <TextField control={form.control} name="graceOutMinutes" label="Early grace (min)" inputMode="numeric" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <TextField control={form.control} name="halfDayMinutes" label="Half day after (min worked)" inputMode="numeric" />
            <TextField control={form.control} name="fullDayMinutes" label="Full day after (min worked)" inputMode="numeric" />
          </div>
          <WeekdaysField control={form.control} name="weeklyOffs" label="Weekly offs" description="Days off for everyone on this shift." />
          <div className="grid gap-4 sm:grid-cols-3">
            <SwitchField control={form.control} name="isFlexible" label="Flexible" description="No late or early marks." />
            <SwitchField control={form.control} name="isNight" label="Night shift" description="Ends the next morning." />
            <SwitchField control={form.control} name="isActive" label="Active" />
          </div>
        </>
      )}
    </FormDialog>
  );
}

export function AssignShiftDialog({ employees, shifts, today }: { employees: Option[]; shifts: Option[]; today: string }) {
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline">
          <Plus /> Assign shift
        </Button>
      }
      title="Assign a shift"
      description="Applies from the start date. The employee's current open-ended assignment ends the day the new one starts."
      schema={shiftAssignmentSchema}
      defaultValues={{ employeeId: "", shiftId: shifts[0]?.value ?? "", effectiveFrom: today, effectiveTo: null } as unknown as z.output<typeof shiftAssignmentSchema>}
      action={assignShiftAction}
      submitLabel="Assign"
      successMessage="Shift assigned"
    >
      {(form) => (
        <>
          <ComboboxField control={form.control} name="employeeId" label="Employee" options={employees} placeholder="Choose an employee" />
          <SelectField control={form.control} name="shiftId" label="Shift" options={shifts} required />
          <div className="grid grid-cols-2 gap-4">
            <TextField control={form.control} name="effectiveFrom" label="From" type="date" required />
            <TextField control={form.control} name="effectiveTo" label="Until (exclusive)" type="date" description="Optional" />
          </div>
        </>
      )}
    </FormDialog>
  );
}
