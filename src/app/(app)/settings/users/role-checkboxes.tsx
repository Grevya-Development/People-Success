"use client";

import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError, FieldLegend, FieldSet } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import type { Option } from "@/components/forms/fields";

/** Multi-select of roles stored as an array of role ids. */
export function RoleCheckboxes<T extends FieldValues>({ control, name, roles }: { control: Control<T>; name: FieldPath<T>; roles: Option[] }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const value: string[] = Array.isArray(field.value) ? field.value : [];
        return (
          <FieldSet data-invalid={fieldState.invalid}>
            <FieldLegend variant="label">Roles</FieldLegend>
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-2">
              {roles.map((r) => {
                const id = `${name}-${r.value}`;
                const checked = value.includes(r.value);
                return (
                  <div key={r.value} className="flex items-start gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50">
                    <Checkbox
                      id={id}
                      checked={checked}
                      onCheckedChange={(v) => field.onChange(v === true ? [...value, r.value] : value.filter((x) => x !== r.value))}
                      className="mt-0.5"
                    />
                    <Label htmlFor={id} className="flex-col items-start gap-0 font-normal">
                      <span>{r.label}</span>
                      {r.hint ? <span className="text-xs text-muted-foreground">{r.hint}</span> : null}
                    </Label>
                  </div>
                );
              })}
            </div>
            <FieldError errors={[fieldState.error]} />
          </FieldSet>
        );
      }}
    />
  );
}
