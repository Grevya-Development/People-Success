"use client";

import { RefreshCw } from "lucide-react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField, type Option } from "@/components/forms/fields";
import { ComboboxField } from "@/app/(app)/settings/_components/combobox-field";
import { MAX_RECOMPUTE_DAYS, recomputeSchema } from "@/lib/validation/time";
import { recomputePeriodAction } from "../actions";

/** HR: recompute attendance days for a period (all employees or one). Locked payroll days are skipped. */
export function RecomputeDialog({ from, to, employees }: { from: string; to: string; employees: Option[] }) {
  return (
    <FormDialog
      trigger={
        <Button variant="outline" size="sm">
          <RefreshCw /> Recompute period
        </Button>
      }
      title="Recompute attendance"
      description={`Re-derives daily status and payable days from punches, shifts, holidays and approved leave, for up to ${MAX_RECOMPUTE_DAYS} days. Days locked by a payroll run are not changed.`}
      schema={recomputeSchema}
      defaultValues={{ from, to, employeeId: null } as z.output<typeof recomputeSchema>}
      action={recomputePeriodAction}
      submitLabel="Recompute"
      successMessage={(d) => (d.queued ? `Queued ${d.queued} employees for recompute` : `Recomputed ${d.computed} day(s) for ${d.employees} employee(s)`)}
    >
      {(form) => (
        <>
          <div className="grid grid-cols-2 gap-4">
            <TextField control={form.control} name="from" label="From" type="date" required />
            <TextField control={form.control} name="to" label="To" type="date" required />
          </div>
          <ComboboxField control={form.control} name="employeeId" label="Employee" options={employees} placeholder="All employees" description="Leave empty to recompute everyone employed in the period." />
        </>
      )}
    </FormDialog>
  );
}
