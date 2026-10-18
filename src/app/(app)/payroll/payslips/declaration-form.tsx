"use client";

import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { CheckboxField, FormError, SelectField, TextField } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { DECLARATION_FIELDS } from "@/lib/payroll/tax";
import { taxDeclarationSchema } from "@/lib/validation/payroll";
import type { DeclarationView } from "@/server/services/payroll/declarations";
import { saveDeclarationAction } from "../actions";

export function DeclarationForm({ value }: { value: DeclarationView }) {
  const { form, submit, pending } = useActionForm({
    schema: taxDeclarationSchema,
    defaultValues: {
      fyStartYear: value.fyStartYear,
      regime: value.regime,
      declarations: Object.fromEntries(DECLARATION_FIELDS.map((f) => [f.key, value.declarations[f.key] ?? 0])) as never,
      metroCity: value.metroCity,
      previousEmployerIncome: value.previousEmployerIncome,
      previousEmployerTds: value.previousEmployerTds,
      submit: false,
    },
    action: saveDeclarationAction,
    successMessage: (d) => (d.status === "submitted" ? "Declaration submitted to payroll" : "Draft saved"),
  });
  const c = form.control;
  const disabled = !value.editable;
  return (
    <form
      noValidate
      onSubmit={(e) => {
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        form.setValue("submit", submitter?.value === "submit");
        return submit(e);
      }}
    >
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <SelectField
          control={c}
          name="regime"
          label="Tax regime"
          disabled={disabled}
          options={[
            { value: "new", label: "New regime (default; standard deduction, no other exemptions)" },
            { value: "old", label: "Old regime (deductions and HRA exemption below apply)" },
          ]}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          {DECLARATION_FIELDS.map((f) => (
            <TextField key={f.key} control={c} name={`declarations.${f.key}`} label={`${f.label} (₹)`} type="number" inputMode="decimal" disabled={disabled} />
          ))}
        </div>
        <CheckboxField control={c} name="metroCity" label="I live in a metro city (Delhi, Mumbai, Kolkata, Chennai) for HRA" disabled={disabled} />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField control={c} name="previousEmployerIncome" label="Salary from a previous employer this year (₹)" type="number" inputMode="decimal" disabled={disabled} />
          <TextField control={c} name="previousEmployerTds" label="TDS deducted by that employer (₹)" type="number" inputMode="decimal" disabled={disabled} />
        </div>
        {value.editable ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="submit" variant="outline" value="draft" disabled={pending}>
              Save draft
            </Button>
            <Button type="submit" value="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              Submit to payroll
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Your declaration has been {value.status}. Ask payroll to return it if you need to make changes.</p>
        )}
      </FieldGroup>
    </form>
  );
}
