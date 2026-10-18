"use client";

import { Pencil, Plus } from "lucide-react";
import type { z } from "zod";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, SwitchField, TextField } from "@/components/forms/fields";
import { LEAVE_CATEGORIES, LEAVE_TONES, leaveTypeSchema } from "@/lib/validation/time";
import { titleCase } from "@/lib/format";
import { saveLeaveTypeAction } from "../actions";

type Values = z.output<typeof leaveTypeSchema>;

const EMPTY: Values = {
  code: "",
  name: "",
  category: "custom",
  isPaid: true,
  allowHalfDay: true,
  allowNegative: false,
  maxNegativeDays: 0,
  requiresDocumentAfterDays: null,
  color: "info",
  sortOrder: 100,
  isActive: true,
};

const TONE_LABEL: Record<string, string> = { info: "Blue", success: "Green", warning: "Amber", danger: "Red", brand: "Brand", neutral: "Grey" };

export function LeaveTypeDialog({ values }: { values?: Values }) {
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
          <Button size="sm" variant="outline">
            <Plus /> New leave type
          </Button>
        )
      }
      title={editing ? `Edit ${values?.name}` : "New leave type"}
      description="Paid types keep a balance in the ledger; unpaid types reduce payable days in payroll."
      schema={leaveTypeSchema}
      defaultValues={values ?? EMPTY}
      action={saveLeaveTypeAction}
      successMessage={editing ? "Leave type updated" : "Leave type created"}
    >
      {(form) => <Fields form={form} />}
    </FormDialog>
  );
}

function Fields({ form }: { form: UseFormReturn<Values> }) {
  const allowNegative = useWatch({ control: form.control, name: "allowNegative" });
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[7rem_1fr]">
        <TextField control={form.control} name="code" label="Code" required placeholder="WFH" />
        <TextField control={form.control} name="name" label="Name" required placeholder="Work from home" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField control={form.control} name="category" label="Category" options={LEAVE_CATEGORIES.map((c) => ({ value: c, label: titleCase(c) }))} />
        <SelectField control={form.control} name="color" label="Colour" options={LEAVE_TONES.map((t) => ({ value: t, label: TONE_LABEL[t] }))} />
        <TextField control={form.control} name="sortOrder" label="Order" inputMode="numeric" />
      </div>
      <SwitchField control={form.control} name="isPaid" label="Paid" description="Unpaid leave has no balance and is loss of pay." />
      <SwitchField control={form.control} name="allowHalfDay" label="Allow half days" />
      <SwitchField control={form.control} name="allowNegative" label="Allow negative balance" description="Let employees borrow ahead of accruals." />
      {allowNegative ? <TextField control={form.control} name="maxNegativeDays" label="Maximum negative days" inputMode="decimal" /> : null}
      <TextField control={form.control} name="requiresDocumentAfterDays" label="Document required beyond (days)" inputMode="decimal" description="Empty = never. 0 = always." />
      <SwitchField control={form.control} name="isActive" label="Active" />
    </>
  );
}

