"use client";

import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, TextField, type Option } from "@/components/forms/fields";
import { openPeriodSchema } from "@/lib/validation/payroll";
import { MONTHS } from "@/lib/india";
import { openPeriodAction } from "../actions";

export function OpenPeriodDialog({ legalEntities, defaults }: { legalEntities: Option[]; defaults: { year: number; month: number; payDate: string; inputCutoffDate: string } }) {
  const router = useRouter();
  const years = [defaults.year - 1, defaults.year, defaults.year + 1].map((y) => ({ value: String(y), label: String(y) }));
  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <CalendarPlus /> Open period
        </Button>
      }
      title="Open a payroll period"
      description="A period covers one calendar month for one legal entity. Inputs entered after the cutoff roll into the next period."
      schema={openPeriodSchema}
      defaultValues={{ legalEntityId: legalEntities[0]?.value ?? "", year: defaults.year, month: defaults.month, payDate: defaults.payDate, inputCutoffDate: defaults.inputCutoffDate }}
      action={openPeriodAction}
      submitLabel="Open period"
      successMessage="Period opened"
      onSuccess={(d) => router.push(`/payroll/periods/${d.id}`)}
    >
      {(form) => (
        <>
          <SelectField control={form.control} name="legalEntityId" label="Legal entity" required options={legalEntities} />
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField control={form.control} name="month" label="Month" required options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
            <SelectField control={form.control} name="year" label="Year" required options={years} />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField control={form.control} name="inputCutoffDate" label="Input cutoff" type="date" required />
            <TextField control={form.control} name="payDate" label="Pay date" type="date" required />
          </div>
        </>
      )}
    </FormDialog>
  );
}
