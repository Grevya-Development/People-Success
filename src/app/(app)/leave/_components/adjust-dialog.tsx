"use client";

import { SlidersHorizontal } from "lucide-react";
import type { z } from "zod";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, TextField, TextareaField, type Option } from "@/components/forms/fields";
import { ComboboxField } from "@/app/(app)/settings/_components/combobox-field";
import { leaveAdjustSchema } from "@/lib/validation/time";
import { adjustLeaveBalanceAction } from "../actions";

type Values = z.output<typeof leaveAdjustSchema>;

/** HR grant / adjustment. Every change is a new, audited ledger row with a reason. */
export function AdjustDialog({
  employees,
  types,
  employeeId,
  today,
  trigger,
}: {
  employees: Option[];
  types: (Option & { category: string })[];
  employeeId?: string;
  today: string;
  trigger?: React.ReactNode;
}) {
  return (
    <FormDialog
      trigger={
        trigger ?? (
          <Button size="sm" variant="outline">
            <SlidersHorizontal /> Adjust balance
          </Button>
        )
      }
      title="Adjust leave balance"
      description="Grants add days (for example comp off or maternity leave). Adjustments correct a balance up or down. Both are recorded in the ledger with your reason."
      schema={leaveAdjustSchema}
      defaultValues={{ employeeId: employeeId ?? "", leaveTypeId: types[0]?.value ?? "", kind: "grant", days: 1, effectiveOn: today, expiresOn: null, reason: "" } as unknown as Values}
      action={adjustLeaveBalanceAction}
      submitLabel="Post to ledger"
      successMessage="Balance updated"
    >
      {(form) => <AdjustFields form={form} employees={employees} types={types} lockEmployee={!!employeeId} />}
    </FormDialog>
  );
}

function AdjustFields({ form, employees, types, lockEmployee }: { form: UseFormReturn<Values>; employees: Option[]; types: (Option & { category: string })[]; lockEmployee: boolean }) {
  const typeId = useWatch({ control: form.control, name: "leaveTypeId" });
  const kind = useWatch({ control: form.control, name: "kind" });
  const isCompOff = types.find((t) => t.value === typeId)?.category === "comp_off";
  return (
    <>
      <ComboboxField control={form.control} name="employeeId" label="Employee" options={employees} placeholder="Choose an employee" disabled={lockEmployee} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField control={form.control} name="leaveTypeId" label="Leave type" options={types} required />
        <SelectField
          control={form.control}
          name="kind"
          label="Kind"
          options={[
            { value: "grant", label: "Grant (add days)" },
            { value: "adjustment", label: "Adjustment (+/−)" },
          ]}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField control={form.control} name="days" label="Days" inputMode="decimal" required description={kind === "adjustment" ? "Negative reduces" : "Multiples of 0.5"} />
        <TextField control={form.control} name="effectiveOn" label="Effective on" type="date" required />
        <TextField control={form.control} name="expiresOn" label="Expires on" type="date" description={isCompOff ? "Default: 90 days" : "Optional"} />
      </div>
      <TextareaField control={form.control} name="reason" label="Reason" required rows={2} placeholder="Worked on Sunday 12 Oct for the release" />
    </>
  );
}
