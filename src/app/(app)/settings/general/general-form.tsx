"use client";

import { useWatch } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError, SelectField, TextField } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { Section } from "@/components/page";
import { MONTHS } from "@/lib/india";
import {
  COMMON_TIMEZONES,
  DATE_FORMATS,
  generalSettingsSchema,
  previewEmployeeCode,
} from "@/lib/validation/settings";
import { formatDate } from "@/lib/format";
import { updateGeneralSettingsAction } from "./actions";

export function GeneralSettingsForm({ defaults, currency }: { defaults: z.output<typeof generalSettingsSchema>; currency: string }) {
  const { form, submit, pending } = useActionForm<z.output<typeof generalSettingsSchema>, null>({
    schema: generalSettingsSchema,
    defaultValues: defaults,
    action: updateGeneralSettingsAction,
    successMessage: "Settings saved",
    onSuccess: (): void => form.reset(form.getValues()),
  });
  const [prefix, padding] = useWatch({ control: form.control, name: ["employeeIdPrefix", "employeeIdPadding"] });
  const zones = COMMON_TIMEZONES.includes(defaults.timezone as (typeof COMMON_TIMEZONES)[number])
    ? COMMON_TIMEZONES
    : [defaults.timezone, ...COMMON_TIMEZONES];
  const sample = new Date(2026, 3, 1);

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <FormError message={form.formState.errors.root?.message} />
      <Section title="Organization">
        <FieldGroup className="p-5">
          <TextField control={form.control} name="name" label="Company name" required description="Shown in the app, emails and documents." />
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField control={form.control} name="timezone" label="Time zone" options={zones.map((z) => ({ value: z, label: z.replace(/_/g, " ") }))} />
            <div className="space-y-2">
              <p className="text-sm font-medium">Currency</p>
              <p className="flex h-8 items-center rounded-lg border bg-muted/40 px-2.5 text-sm text-muted-foreground">
                {currency} · Indian rupee
              </p>
              <p className="text-sm text-muted-foreground">Payroll runs in INR. Multi-currency is not available yet.</p>
            </div>
          </div>
        </FieldGroup>
      </Section>

      <Section title="Calendar and formats">
        <FieldGroup className="p-5">
          <div className="grid gap-5 sm:grid-cols-3">
            <SelectField
              control={form.control}
              name="fiscalYearStartMonth"
              label="Financial year starts"
              options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
            />
            <SelectField
              control={form.control}
              name="weekStartsOn"
              label="Week starts on"
              options={[
                { value: "1", label: "Monday" },
                { value: "0", label: "Sunday" },
              ]}
            />
            <SelectField
              control={form.control}
              name="dateFormat"
              label="Date format"
              options={DATE_FORMATS.map((f) => ({ value: f, label: `${formatDate(sample, f)}  (${f})` }))}
            />
          </div>
        </FieldGroup>
      </Section>

      <Section title="Employee IDs" description="Applies to employees created from now on. Existing codes are not renumbered.">
        <FieldGroup className="p-5">
          <div className="grid gap-5 sm:grid-cols-3">
            <TextField control={form.control} name="employeeIdPrefix" label="Prefix" placeholder="EMP" />
            <TextField control={form.control} name="employeeIdPadding" label="Number of digits" type="number" inputMode="numeric" />
            <div className="space-y-2">
              <p className="text-sm font-medium">Preview</p>
              <p className="flex h-8 items-center rounded-lg border bg-muted/40 px-2.5 font-mono text-sm tabular" aria-live="polite">
                {previewEmployeeCode((prefix ?? "").toUpperCase(), Number(padding))}
              </p>
            </div>
          </div>
        </FieldGroup>
      </Section>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !form.formState.isDirty}>
          {pending ? <Spinner /> : null}
          Save changes
        </Button>
      </div>
    </form>
  );
}
