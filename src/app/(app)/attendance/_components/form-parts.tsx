"use client";

import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Option } from "@/components/forms/fields";
import { EMPLOYMENT_TYPES, WEEKDAYS } from "@/lib/validation/time";
import { titleCase } from "@/lib/format";

/** Multi-select as a compact checkbox list; stores string[] (empty = everyone). */
export function ChecklistField<T extends FieldValues>({
  control,
  name,
  label,
  options,
  description,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  options: Option[];
  description?: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const value: string[] = Array.isArray(field.value) ? field.value : [];
        return (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel>{label}</FieldLabel>
            {options.length ? (
              <div className="max-h-36 space-y-1.5 overflow-y-auto rounded-lg border p-2.5">
                {options.map((o) => (
                  <label key={o.value} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={value.includes(o.value)}
                      onCheckedChange={(c) => field.onChange(c === true ? [...value, o.value] : value.filter((v) => v !== o.value))}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">None configured.</p>
            )}
            {description ? <FieldDescription>{description}</FieldDescription> : null}
            <FieldError errors={[fieldState.error]} />
          </Field>
        );
      }}
    />
  );
}

export type ConditionOptions = { locations: Option[]; departments: Option[]; legalEntities: Option[] };

/** Policy applicability: every chosen dimension must match; nothing chosen = everyone. */
export function ConditionsFields<T extends FieldValues>({ control, prefix, options }: { control: Control<T>; prefix: string; options: ConditionOptions }) {
  const n = (k: string) => `${prefix}.${k}` as FieldPath<T>;
  return (
    <FieldSet>
      <FieldLegend variant="label">Applies to</FieldLegend>
      <FieldDescription>Leave a group empty to include everyone. When several groups are set, an employee must match all of them.</FieldDescription>
      <div className="grid gap-4 sm:grid-cols-2">
        <ChecklistField control={control} name={n("employmentType")} label="Employment type" options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: titleCase(t) }))} />
        <ChecklistField control={control} name={n("locationId")} label="Location" options={options.locations} />
        <ChecklistField control={control} name={n("departmentId")} label="Department" options={options.departments} />
        <ChecklistField control={control} name={n("legalEntityId")} label="Legal entity" options={options.legalEntities} />
      </div>
    </FieldSet>
  );
}

/** Weekday chips (0 = Sunday ... 6 = Saturday). */
export function WeekdaysField<T extends FieldValues>({ control, name, label, description }: { control: Control<T>; name: FieldPath<T>; label: string; description?: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel>{label}</FieldLabel>
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            value={(field.value as number[] | undefined)?.map(String) ?? []}
            onValueChange={(v: string[]) => field.onChange(v.map(Number).sort())}
            className="flex-wrap"
          >
            {WEEKDAYS.map((d, i) => (
              <ToggleGroupItem key={d} value={String(i)} aria-label={d} className="min-w-11">
                {d}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}
