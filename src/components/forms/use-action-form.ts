"use client";

import { useTransition } from "react";
import { useForm, type DefaultValues, type FieldValues, type Path, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
import type { ActionResult } from "@/lib/action-result";

type Options<TValues extends FieldValues, TResult> = {
  schema: z.ZodType<TValues, FieldValues>;
  defaultValues: DefaultValues<TValues>;
  action: (values: TValues) => Promise<ActionResult<TResult>>;
  onSuccess?: (data: TResult) => void | Promise<void>;
  successMessage?: string | ((data: TResult) => string);
};

/**
 * React Hook Form + Zod on the client, Server Action on submit. Server-side
 * field errors are mapped back onto the matching inputs; other errors toast.
 */
export function useActionForm<TValues extends FieldValues, TResult>(opts: Options<TValues, TResult>) {
  const [pending, startTransition] = useTransition();
  const form = useForm<TValues>({
    resolver: zodResolver(opts.schema as never) as unknown as Resolver<TValues>,
    defaultValues: opts.defaultValues,
    mode: "onTouched",
  });

  const submit = form.handleSubmit((values) =>
    new Promise<void>((resolve) => {
      startTransition(async () => {
        const result = await opts.action(values);
        if (result.ok) {
          const msg = typeof opts.successMessage === "function" ? opts.successMessage(result.data) : opts.successMessage;
          if (msg) toast.success(msg);
          await opts.onSuccess?.(result.data);
        } else {
          const fe = result.error.fieldErrors;
          let mapped = false;
          if (fe) {
            for (const [name, messages] of Object.entries(fe)) {
              if (name in (form.getValues() as object) || name.includes(".")) {
                form.setError(name as Path<TValues>, { type: "server", message: messages[0] });
                mapped = true;
              }
            }
          }
          if (!mapped || result.error.code !== "VALIDATION") {
            form.setError("root", { type: "server", message: result.error.message });
            toast.error(result.error.message);
          }
        }
        resolve();
      });
    }),
  );

  return { form, submit, pending: pending || form.formState.isSubmitting };
}
