"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { FormError, TextField } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { inviteSignUpSchema } from "@/lib/validation/users";
import { acceptInvitationAction, inviteSignUpAction, signOutForInviteAction } from "../actions";

export function JoinButton({ token, tenantName }: { token: string; tenantName: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <FormError message={error ?? undefined} />
      <Button
        size="lg"
        className="w-full"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            // On success the action redirects to the overview.
            const res = await acceptInvitationAction({ token });
            if (res && !res.ok) setError(res.error.message);
          })
        }
      >
        {pending ? <Spinner /> : null}
        Join {tenantName}
      </Button>
    </div>
  );
}

export function SwitchAccountButton({ token }: { token: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" className="w-full" disabled={pending} onClick={() => start(() => signOutForInviteAction(token))}>
      {pending ? <Spinner /> : null}
      Sign out and use the invited email
    </Button>
  );
}

export function InviteSignUpForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [sent, setSent] = useState(false);
  const { form, submit, pending } = useActionForm({
    schema: inviteSignUpSchema,
    defaultValues: { token, fullName: "", password: "" },
    action: inviteSignUpAction,
    onSuccess: ({ needsConfirmation }) => {
      if (needsConfirmation) setSent(true);
      else router.refresh();
    },
  });

  if (sent) {
    return (
      <div role="status" className="rounded-lg border p-4">
        <MailCheck className="size-5 text-brand" aria-hidden />
        <p className="mt-2 font-medium">Confirm your email</p>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a confirmation link to <span className="font-medium text-foreground">{email}</span>. After confirming, you will be able to
          join from this page or from the setup screen.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <div className="space-y-2">
          <Label htmlFor="invite-email">Email</Label>
          <Input id="invite-email" value={email} readOnly aria-readonly className="bg-muted/40 text-muted-foreground" />
        </div>
        <TextField control={form.control} name="fullName" label="Full name" autoComplete="name" />
        <TextField
          control={form.control}
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          description="At least 10 characters, with letters and numbers."
        />
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? <Spinner /> : null}
          Create account
        </Button>
      </FieldGroup>
    </form>
  );
}
