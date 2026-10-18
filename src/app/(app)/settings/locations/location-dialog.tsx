"use client";

import { useState } from "react";
import type { z } from "zod";
import { useWatch } from "react-hook-form";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError, SelectField, SwitchField, TextField, type Option } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { INDIAN_STATES } from "@/lib/india";
import { COMMON_TIMEZONES, LOCATION_TYPES, locationSchema } from "@/lib/validation/settings";
import { titleCase } from "@/lib/format";
import { saveLocationAction } from "./actions";

export type LocationFormValues = z.input<typeof locationSchema>;

const EMPTY: LocationFormValues = {
  name: "",
  code: "",
  type: "office",
  legalEntityId: null,
  stateCode: null,
  timezone: "Asia/Kolkata",
  address: { line1: "", line2: "", city: "", postalCode: "" },
  geofenceEnabled: false,
  lat: "",
  lng: "",
  radiusMeters: "200",
  isActive: true,
};

export function LocationDialog({ mode, values, entities }: { mode: "create" | "edit"; values?: LocationFormValues; entities: Option[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {mode === "create" ? (
          <Button>
            <Plus /> Add location
          </Button>
        ) : (
          <Button variant="ghost" size="sm" aria-label={`Edit ${values?.name}`}>
            <Pencil /> Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add location" : `Edit ${values?.name}`}</DialogTitle>
          <DialogDescription>Employees are assigned to a location for holidays, attendance and state-specific statutory rules.</DialogDescription>
        </DialogHeader>
        {open ? <LocationForm values={values} entities={entities} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function LocationForm({ values, entities, onDone }: { values?: LocationFormValues; entities: Option[]; onDone: () => void }) {
  const editing = !!values?.id;
  const { form, submit, pending } = useActionForm({
    schema: locationSchema,
    defaultValues: (values ?? EMPTY) as z.output<typeof locationSchema>,
    action: saveLocationAction,
    successMessage: editing ? "Location updated" : "Location added",
    onSuccess: onDone,
  });
  const c = form.control;
  const geofence = useWatch({ control: c, name: "geofenceEnabled" });
  const tz = values?.timezone;
  const zones = tz && !COMMON_TIMEZONES.includes(tz as (typeof COMMON_TIMEZONES)[number]) ? [tz, ...COMMON_TIMEZONES] : COMMON_TIMEZONES;

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <TextField control={c} name="name" label="Name" required placeholder="Bengaluru HQ" />
          <TextField control={c} name="code" label="Code" placeholder="BLR" />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField control={c} name="type" label="Type" options={LOCATION_TYPES.map((t) => ({ value: t, label: titleCase(t) }))} />
          <SelectField control={c} name="legalEntityId" label="Legal entity" allowNone="Any entity" options={entities} />
          <SelectField control={c} name="stateCode" label="State" allowNone="Not set" options={INDIAN_STATES.map((s) => ({ value: s.code, label: s.name }))} />
          <SelectField control={c} name="timezone" label="Time zone" options={zones.map((z) => ({ value: z, label: z.replace(/_/g, " ") }))} />
        </div>
        <FieldSet>
          <FieldLegend variant="label">Address</FieldLegend>
          <TextField control={c} name="address.line1" label="Address line 1" />
          <TextField control={c} name="address.line2" label="Address line 2" />
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField control={c} name="address.city" label="City" />
            <TextField control={c} name="address.postalCode" label="PIN code" inputMode="numeric" />
          </div>
        </FieldSet>
        <div className="space-y-4 rounded-lg border p-4">
          <SwitchField control={c} name="geofenceEnabled" label="Attendance geofence" description="Only allow web and mobile check-ins within a radius of this location." />
          {geofence ? (
            <div className="grid gap-5 sm:grid-cols-3">
              <TextField control={c} name="lat" label="Latitude" inputMode="decimal" placeholder="12.9716" />
              <TextField control={c} name="lng" label="Longitude" inputMode="decimal" placeholder="77.5946" />
              <TextField control={c} name="radiusMeters" label="Radius (metres)" inputMode="numeric" placeholder="200" />
            </div>
          ) : null}
        </div>
        <SwitchField control={c} name="isActive" label="Active" description="Inactive locations cannot be assigned to employees." />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            {editing ? "Save changes" : "Add location"}
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}
