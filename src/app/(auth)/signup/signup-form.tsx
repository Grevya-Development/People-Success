"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError, TextField } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { signUpSchema } from "@/lib/validation/auth";
import { signUpAction } from "../actions";

export function SignUpForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { form, submit, pending } = useActionForm({
    schema: signUpSchema,
    defaultValues: { fullName: "", email: "", password: "", next: params.get("next") ?? undefined },
    action: signUpAction,
    onSuccess: ({ needsConfirmation }) => {
      if (needsConfirmation) setSentTo(form.getValues("email"));
      else router.replace("/setup/organization");
    },
  });

  if (sentTo) {
    return (
      <div role="status" className="rounded-lg border bg-card p-5">
        <MailCheck className="size-5 text-brand" aria-hidden />
        <p className="mt-3 font-medium">Check your inbox</p>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a confirmation link to <span className="font-medium text-foreground">{sentTo}</span>. Open it to continue
          setting up your organization.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <TextField control={form.control} name="fullName" label="Full name" autoComplete="name" />
        <TextField control={form.control} name="email" label="Work email" type="email" autoComplete="email" inputMode="email" />
        <TextField
          control={form.control}
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          description="At least 10 characters, with letters and numbers."
        />
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending ? <Spinner /> : null}
          Create account
        </Button>
      </FieldGroup>
    </form>
  );
}
