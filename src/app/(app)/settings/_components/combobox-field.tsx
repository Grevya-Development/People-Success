"use client";

import { useState } from "react";
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { ChevronsUpDown, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { Option } from "@/components/forms/fields";

/**
 * Searchable single-select for long lists (employees, members). Stores the
 * option value or null.
 */
export function ComboboxField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  options,
  placeholder = "Select…",
  emptyText = "No matches.",
  disabled,
  className,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description?: string;
  options: Option[];
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const selected = options.find((o) => o.value === field.value);
        return (
          <Field data-invalid={fieldState.invalid} className={className}>
            <FieldLabel htmlFor={name}>{label}</FieldLabel>
            <div className="flex gap-1.5">
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id={name}
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    aria-invalid={fieldState.invalid}
                    disabled={disabled}
                    className="h-8 min-w-0 flex-1 justify-between font-normal"
                  >
                    <span className={cn("truncate", !selected && "text-muted-foreground")}>{selected?.label ?? placeholder}</span>
                    <ChevronsUpDown className="opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search…" />
                    <CommandList>
                      <CommandEmpty>{emptyText}</CommandEmpty>
                      <CommandGroup>
                        {options.map((o) => (
                          <CommandItem
                            key={o.value}
                            value={`${o.label} ${o.hint ?? ""} ${o.value}`}
                            data-checked={o.value === field.value}
                            onSelect={() => {
                              field.onChange(o.value);
                              setOpen(false);
                            }}
                          >
                            <div className="min-w-0">
                              <p className="truncate">{o.label}</p>
                              {o.hint ? <p className="truncate text-xs text-muted-foreground">{o.hint}</p> : null}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selected && !disabled ? (
                <Button type="button" variant="ghost" size="icon" aria-label={`Clear ${label}`} onClick={() => field.onChange(null)}>
                  <X />
                </Button>
              ) : null}
            </div>
            {description ? <FieldDescription>{description}</FieldDescription> : null}
            <FieldError errors={[fieldState.error]} />
          </Field>
        );
      }}
    />
  );
}
