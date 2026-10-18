"use client";

import { useId } from "react";
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";

type Base<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
};

function Label({ id, label, required }: { id: string; label: string; required?: boolean }) {
  return (
    <FieldLabel htmlFor={id}>
      {label}
      {required ? <span className="text-destructive" aria-hidden>*</span> : null}
    </FieldLabel>
  );
}

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  required,
  disabled,
  className,
  type = "text",
  placeholder,
  autoComplete,
  inputMode,
}: Base<T> & {
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  const id = `${useId()}-${String(name).replace(/\W/g, "_")}`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid} className={className}>
          <Label id={id} label={label} required={required} />
          <Input
            id={id}
            type={type}
            placeholder={placeholder}
            autoComplete={autoComplete}
            inputMode={inputMode}
            disabled={disabled}
            aria-invalid={fieldState.invalid}
            {...field}
            value={field.value ?? ""}
          />
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

export function TextareaField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  required,
  disabled,
  className,
  rows = 4,
  placeholder,
}: Base<T> & { rows?: number; placeholder?: string }) {
  const id = `${useId()}-${String(name).replace(/\W/g, "_")}`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid} className={className}>
          <Label id={id} label={label} required={required} />
          <Textarea
            id={id}
            rows={rows}
            placeholder={placeholder}
            disabled={disabled}
            aria-invalid={fieldState.invalid}
            {...field}
            value={field.value ?? ""}
          />
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

export type Option = { value: string; label: string; hint?: string };

/** Select with an optional "none" choice; empty string is stored as null. */
export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  required,
  disabled,
  className,
  options,
  placeholder = "Select…",
  allowNone,
}: Base<T> & { options: Option[]; placeholder?: string; allowNone?: string }) {
  const id = `${useId()}-${String(name).replace(/\W/g, "_")}`;
  const NONE = "__none__";
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid} className={className}>
          <Label id={id} label={label} required={required} />
          <Select
            value={field.value == null || field.value === "" ? (allowNone ? NONE : "") : String(field.value)}
            onValueChange={(v) => field.onChange(v === NONE ? null : v)}
            disabled={disabled}
          >
            <SelectTrigger id={id} aria-invalid={fieldState.invalid} className="w-full" onBlur={field.onBlur}>
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {allowNone ? <SelectItem value={NONE}>{allowNone}</SelectItem> : null}
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

export function SwitchField<T extends FieldValues>({ control, name, label, description, disabled, className }: Base<T>) {
  const id = `${useId()}-${String(name).replace(/\W/g, "_")}`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Field orientation="horizontal" className={className}>
          <div className="flex-1">
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {description ? <FieldDescription>{description}</FieldDescription> : null}
          </div>
          <Switch id={id} checked={!!field.value} onCheckedChange={field.onChange} disabled={disabled} />
        </Field>
      )}
    />
  );
}

export function CheckboxField<T extends FieldValues>({ control, name, label, description, disabled, className }: Base<T>) {
  const id = `${useId()}-${String(name).replace(/\W/g, "_")}`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field orientation="horizontal" data-invalid={fieldState.invalid} className={className}>
          <Checkbox id={id} checked={!!field.value} onCheckedChange={(v) => field.onChange(v === true)} disabled={disabled} />
          <div>
            <FieldLabel htmlFor={id} className="font-normal">
              {label}
            </FieldLabel>
            {description ? <FieldDescription>{description}</FieldDescription> : null}
            <FieldError errors={[fieldState.error]} />
          </div>
        </Field>
      )}
    />
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}
