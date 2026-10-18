"use client";

import { useState } from "react";
import type { DefaultValues, FieldValues, UseFormReturn } from "react-hook-form";
import type { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError } from "./fields";
import { useActionForm } from "./use-action-form";
import type { ActionResult } from "@/lib/action-result";

/**
 * Dialog containing an action-backed form. The form resets each time the
 * dialog opens so it always reflects current values.
 */
export function FormDialog<TValues extends FieldValues, TResult>({
  trigger,
  title,
  description,
  schema,
  defaultValues,
  action,
  submitLabel = "Save",
  successMessage = "Saved",
  onSuccess,
  children,
  wide,
  destructive,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  schema: z.ZodType<TValues, FieldValues>;
  defaultValues: DefaultValues<TValues>;
  action: (values: TValues) => Promise<ActionResult<TResult>>;
  submitLabel?: string;
  successMessage?: string | ((d: TResult) => string);
  onSuccess?: (d: TResult) => void;
  children: (form: UseFormReturn<TValues>) => React.ReactNode;
  wide?: boolean;
  destructive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { form, submit, pending } = useActionForm({
    schema,
    defaultValues,
    action,
    successMessage,
    onSuccess: (d) => {
      setOpen(false);
      onSuccess?.(d);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) form.reset(defaultValues);
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className={wide ? "sm:max-w-2xl" : "sm:max-w-lg"}>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto px-0.5 py-5">
            <FieldGroup>
              <FormError message={form.formState.errors.root?.message} />
              {children(form)}
            </FieldGroup>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} variant={destructive ? "destructive" : "default"}>
              {pending ? <Spinner /> : null}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
