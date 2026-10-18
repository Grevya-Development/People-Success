"use client";

import { useState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError, TextField } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { forgotPasswordSchema } from "@/lib/validation/auth";
import { forgotPasswordAction } from "../actions";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const { form, submit, pending } = useActionForm({
    schema: forgotPasswordSchema,
    defaultValues: { email: "" },
    action: forgotPasswordAction,
    onSuccess: () => setSent(true),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted-foreground">We will email you a link to choose a new password.</p>
      </div>
      {sent ? (
        <div role="status" className="rounded-lg border bg-card p-5">
          <MailCheck className="size-5 text-brand" aria-hidden />
          <p className="mt-3 font-medium">Check your inbox</p>
          <p className="mt-1 text-sm text-muted-foreground">
            If an account exists for that email, a reset link is on its way. It expires in one hour.
          </p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <FormError message={form.formState.errors.root?.message} />
            <TextField control={form.control} name="email" label="Work email" type="email" autoComplete="email" />
            <Button type="submit" size="lg" disabled={pending} className="w-full">
              {pending ? <Spinner /> : null}
              Send reset link
            </Button>
          </FieldGroup>
        </form>
      )}
      <Link href="/login" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        Back to sign in
      </Link>
    </div>
  );
}
