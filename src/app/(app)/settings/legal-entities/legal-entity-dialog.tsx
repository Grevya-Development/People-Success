"use client";

import { useState } from "react";
import type { z } from "zod";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { CheckboxField, FormError, SelectField, SwitchField, TextField } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { INDIAN_STATES } from "@/lib/india";
import { legalEntitySchema } from "@/lib/validation/settings";
import { saveLegalEntityAction } from "./actions";

export type LegalEntityFormValues = z.output<typeof legalEntitySchema> | z.input<typeof legalEntitySchema>;

const EMPTY: z.input<typeof legalEntitySchema> = {
  name: "",
  legalName: "",
  stateCode: null,
  registrations: { pan: "", tan: "", gstin: "", cin: "", pfEstablishmentCode: "", esiEmployerCode: "", ptRegistration: "", lwfRegistration: "" },
  address: { line1: "", line2: "", city: "", postalCode: "" },
  isDefault: false,
  isActive: true,
};

export function LegalEntityDialog({
  mode,
  values,
  activeEmployees = 0,
}: {
  mode: "create" | "edit";
  values?: LegalEntityFormValues;
  activeEmployees?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {mode === "create" ? (
          <Button>
            <Plus /> Add legal entity
          </Button>
        ) : (
          <Button variant="ghost" size="sm" aria-label={`Edit ${values?.name}`}>
            <Pencil /> Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add legal entity" : `Edit ${values?.name}`}</DialogTitle>
          <DialogDescription>Registrations are optional now, but PAN and TAN are required before running payroll.</DialogDescription>
        </DialogHeader>
        {open ? <LegalEntityForm values={values} activeEmployees={activeEmployees} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function LegalEntityForm({ values, activeEmployees, onDone }: { values?: LegalEntityFormValues; activeEmployees: number; onDone: () => void }) {
  const editing = !!values?.id;
  const wasDefault = !!values?.isDefault;
  const { form, submit, pending } = useActionForm({
    schema: legalEntitySchema,
    defaultValues: (values ?? EMPTY) as z.output<typeof legalEntitySchema>,
    action: saveLegalEntityAction,
    successMessage: editing ? "Legal entity updated" : "Legal entity added",
    onSuccess: onDone,
  });
  const c = form.control;

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField control={c} name="name" label="Display name" required placeholder="Acme India" />
          <TextField control={c} name="legalName" label="Registered legal name" required placeholder="Acme India Private Limited" />
        </div>
        <SelectField
          control={c}
          name="stateCode"
          label="Registered state"
          allowNone="Not set"
          options={INDIAN_STATES.map((s) => ({ value: s.code, label: s.name }))}
        />

        <FieldSet>
          <FieldLegend variant="label">Statutory registrations</FieldLegend>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField control={c} name="registrations.pan" label="PAN" placeholder="AAAAA9999A" autoComplete="off" />
            <TextField control={c} name="registrations.tan" label="TAN" placeholder="AAAA99999A" autoComplete="off" />
            <TextField control={c} name="registrations.gstin" label="GSTIN" placeholder="29AAAAA9999A1Z5" autoComplete="off" />
            <TextField control={c} name="registrations.cin" label="CIN" placeholder="U72200KA2020PTC123456" autoComplete="off" />
            <TextField control={c} name="registrations.pfEstablishmentCode" label="PF establishment code" placeholder="KNBNG0012345000" autoComplete="off" />
            <TextField control={c} name="registrations.esiEmployerCode" label="ESI employer code" placeholder="17 digits" inputMode="numeric" autoComplete="off" />
            <TextField control={c} name="registrations.ptRegistration" label="Professional tax registration" autoComplete="off" />
            <TextField control={c} name="registrations.lwfRegistration" label="Labour welfare fund registration" autoComplete="off" />
          </div>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">Registered address</FieldLegend>
          <TextField control={c} name="address.line1" label="Address line 1" autoComplete="address-line1" />
          <TextField control={c} name="address.line2" label="Address line 2" autoComplete="address-line2" />
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField control={c} name="address.city" label="City" autoComplete="address-level2" />
            <TextField control={c} name="address.postalCode" label="PIN code" inputMode="numeric" autoComplete="postal-code" />
          </div>
        </FieldSet>

        <div className="space-y-3 rounded-lg border p-4">
          <CheckboxField
            control={c}
            name="isDefault"
            label="Default legal entity"
            description={wasDefault ? "This is the default. Make another entity default to change it." : "New employees are assigned here unless you choose otherwise."}
            disabled={wasDefault}
          />
          <SwitchField
            control={c}
            name="isActive"
            label="Active"
            description={
              activeEmployees > 0
                ? `${activeEmployees} active employee${activeEmployees === 1 ? "" : "s"}: move or exit them before deactivating.`
                : "Inactive entities cannot receive new employees."
            }
            disabled={wasDefault || (editing && activeEmployees > 0 && !!values?.isActive)}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            {editing ? "Save changes" : "Add entity"}
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}
