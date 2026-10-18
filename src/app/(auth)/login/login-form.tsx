"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError, TextField } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { signInSchema } from "@/lib/validation/auth";
import { signInAction } from "../actions";

const ERRORS: Record<string, string> = {
  link_expired: "That link is invalid or has expired. Request a new one.",
};

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { form, submit, pending } = useActionForm({
    schema: signInSchema,
    defaultValues: { email: "", password: "", next: params.get("next") ?? undefined },
    action: signInAction,
    onSuccess: ({ next }) => {
      router.replace(next);
      router.refresh();
    },
  });
  const linkError = ERRORS[params.get("error") ?? ""];

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message ?? linkError} />
        <TextField control={form.control} name="email" label="Work email" type="email" autoComplete="email" inputMode="email" />
        <div className="relative">
          <TextField control={form.control} name="password" label="Password" type="password" autoComplete="current-password" />
          <Link
            href="/forgot-password"
            className="absolute top-0 right-0 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending ? <Spinner /> : null}
          Sign in
        </Button>
      </FieldGroup>
    </form>
  );
}
