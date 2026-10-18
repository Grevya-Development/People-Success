"use client";

import { useState, useTransition } from "react";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FormError } from "@/components/forms/fields";
import { acceptInvitationAction } from "@/app/invite/actions";

type Invite = { id: string; tenantName: string; inviterName: string | null; expiresAt: string };

/** Invitations addressed to the signed-in (verified) email. */
export function PendingInvitations({ invites }: { invites: Invite[] }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="mt-8 rounded-xl border bg-card p-6 shadow-xs" aria-labelledby="pending-invites">
      <div className="flex items-center gap-2">
        <MailCheck className="size-4 text-brand" aria-hidden />
        <h2 id="pending-invites" className="text-sm font-semibold">
          You have been invited
        </h2>
      </div>
      <FormError message={error ?? undefined} />
      <ul className="mt-4 divide-y rounded-lg border">
        {invites.map((i) => (
          <li key={i.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{i.tenantName}</p>
              {i.inviterName ? <p className="text-sm text-muted-foreground">Invited by {i.inviterName}</p> : null}
            </div>
            <Button
              disabled={pending}
              onClick={() => {
                setBusy(i.id);
                setError(null);
                start(async () => {
                  const res = await acceptInvitationAction({ invitationId: i.id });
                  if (res && !res.ok) setError(res.error.message);
                  setBusy(null);
                });
              }}
            >
              {pending && busy === i.id ? <Spinner /> : null}
              Join {i.tenantName}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
