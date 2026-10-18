"use client";

import { useEffect, useState } from "react";
import type { z } from "zod";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError, TextField, TextareaField } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { regularizationSchema } from "@/lib/validation/time";
import { requestRegularizationAction } from "../actions";

type Values = z.input<typeof regularizationSchema>;

/**
 * Request a missing-punch correction. Controlled (`open`/`date` from a
 * calendar click) or uncontrolled with a trigger button.
 */
export function RegularizationDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
  date,
  inTime,
  outTime,
  minDate,
  maxDate,
  windowDays,
}: {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  date?: string;
  inTime?: string | null;
  outTime?: string | null;
  minDate: string;
  maxDate: string;
  windowDays: number;
}) {
  const [own, setOwn] = useState(false);
  const open = controlledOpen ?? own;
  const setOpen = onOpenChange ?? setOwn;
  const defaults: Values = { date: date ?? maxDate, inTime: inTime ?? "", outTime: outTime ?? "", reason: "" };
  const { form, submit, pending } = useActionForm({
    schema: regularizationSchema,
    defaultValues: defaults as z.output<typeof regularizationSchema>,
    action: requestRegularizationAction,
    successMessage: "Correction sent for approval",
    onSuccess: () => setOpen(false),
  });
  useEffect(() => {
    if (open) form.reset({ date: date ?? maxDate, inTime: inTime ?? "", outTime: outTime ?? "", reason: "" } as z.output<typeof regularizationSchema>);
  }, [open, date, inTime, outTime, maxDate, form]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Request attendance correction</DialogTitle>
            <DialogDescription>
              For a missed or wrong check-in or check-out within the last {windowDays} days. Your manager approves it; the original punches are kept.
            </DialogDescription>
          </DialogHeader>
          <div className="py-5">
            <FieldGroup>
              <FormError message={form.formState.errors.root?.message} />
              <TextField control={form.control} name="date" label="Date" type="date" required />
              <div className="grid grid-cols-2 gap-4">
                <TextField control={form.control} name="inTime" label="Check-in time" type="time" description="Leave blank to keep" />
                <TextField control={form.control} name="outTime" label="Check-out time" type="time" description="Leave blank to keep" />
              </div>
              <TextareaField control={form.control} name="reason" label="Reason" required rows={3} placeholder="Forgot to check out after the client visit" />
              <p className="text-xs text-muted-foreground">
                Allowed dates: {minDate} to {maxDate}. Times are India Standard Time.
              </p>
            </FieldGroup>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              Send for approval
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
