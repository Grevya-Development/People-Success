"use client";

import type { DefaultValues, FieldValues, UseFormReturn } from "react-hook-form";
import type { z } from "zod";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import type { ActionResult } from "@/lib/action-result";

/**
 * Controlled form dialog (opened from menus or buttons elsewhere). The form
 * resets whenever it opens.
 */
type Props<TValues extends FieldValues, TResult> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  schema: z.ZodType<TValues, FieldValues>;
  defaultValues: DefaultValues<TValues>;
  action: (values: TValues) => Promise<ActionResult<TResult>>;
  submitLabel?: string;
  successMessage?: string | ((d: TResult) => string);
  destructive?: boolean;
  wide?: boolean;
  children: (form: UseFormReturn<TValues>) => React.ReactNode;
};

export function ActionDialog<TValues extends FieldValues, TResult>(props: Props<TValues, TResult>) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* Mounted only while open, so the form starts fresh every time. */}
      {props.open ? <Body {...props} /> : null}
    </Dialog>
  );
}

function Body<TValues extends FieldValues, TResult>({
  onOpenChange,
  title,
  description,
  schema,
  defaultValues,
  action,
  submitLabel = "Save",
  successMessage = "Saved",
  destructive,
  wide,
  children,
}: Props<TValues, TResult>) {
  const { form, submit, pending } = useActionForm({
    schema,
    defaultValues,
    action,
    successMessage,
    onSuccess: () => onOpenChange(false),
  });
  return (
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
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending} variant={destructive ? "destructive" : "default"}>
            {pending ? <Spinner /> : null}
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
