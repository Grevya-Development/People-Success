"use client";

import { useState } from "react";
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { Option } from "@/components/forms/fields";

/** Searchable multi-select storing an array of option values. */
export function MultiSelectField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  options,
  placeholder = "Select…",
  max,
  className,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description?: string;
  options: Option[];
  placeholder?: string;
  max?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const value: string[] = Array.isArray(field.value) ? field.value : [];
        const selected = options.filter((o) => value.includes(o.value));
        const toggle = (v: string) => {
          if (value.includes(v)) field.onChange(value.filter((x) => x !== v));
          else if (!max || value.length < max) field.onChange([...value, v]);
        };
        return (
          <Field data-invalid={fieldState.invalid} className={className}>
            <FieldLabel htmlFor={name}>{label}</FieldLabel>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button id={name} type="button" variant="outline" role="combobox" aria-expanded={open} className="h-auto min-h-8 justify-between py-1 font-normal">
                  <span className={cn("flex flex-wrap gap-1 text-left", !selected.length && "text-muted-foreground")}>
                    {selected.length
                      ? selected.map((s) => (
                          <span key={s.value} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 text-xs">
                            {s.label}
                            <X
                              className="size-3 cursor-pointer"
                              aria-label={`Remove ${s.label}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggle(s.value);
                              }}
                            />
                          </span>
                        ))
                      : placeholder}
                  </span>
                  <ChevronsUpDown className="opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search…" />
                  <CommandList>
                    <CommandEmpty>No matches.</CommandEmpty>
                    <CommandGroup>
                      {options.map((o) => {
                        const on = value.includes(o.value);
                        return (
                          <CommandItem key={o.value} value={`${o.label} ${o.hint ?? ""} ${o.value}`} onSelect={() => toggle(o.value)} disabled={!on && !!max && value.length >= max}>
                            <Check className={cn("size-4", on ? "opacity-100" : "opacity-0")} />
                            <div className="min-w-0">
                              <p className="truncate">{o.label}</p>
                              {o.hint ? <p className="truncate text-xs text-muted-foreground">{o.hint}</p> : null}
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {description ? <FieldDescription>{description}</FieldDescription> : null}
            <FieldError errors={[fieldState.error]} />
          </Field>
        );
      }}
    />
  );
}
