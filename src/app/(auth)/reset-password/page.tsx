"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError, TextField } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { resetPasswordSchema } from "@/lib/validation/auth";
import { resetPasswordAction } from "../actions";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { form, submit, pending } = useActionForm({
    schema: resetPasswordSchema,
    defaultValues: { password: "", confirm: "" },
    action: resetPasswordAction,
    successMessage: "Password updated",
    onSuccess: () => router.replace("/overview"),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="text-sm text-muted-foreground">You will stay signed in on this device.</p>
      </div>
      <form onSubmit={submit} noValidate>
        <FieldGroup>
          <FormError message={form.formState.errors.root?.message} />
          <TextField control={form.control} name="password" label="New password" type="password" autoComplete="new-password" description="At least 10 characters, with letters and numbers." />
          <TextField control={form.control} name="confirm" label="Confirm password" type="password" autoComplete="new-password" />
          <Button type="submit" size="lg" disabled={pending} className="w-full">
            {pending ? <Spinner /> : null}
            Update password
          </Button>
        </FieldGroup>
      </form>
    </div>
  );
}
