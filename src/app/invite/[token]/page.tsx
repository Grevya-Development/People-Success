import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CircleAlert, MailCheck } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getSession } from "@/server/auth/context";
import { getInvitationByToken, type PublicInvitation } from "@/server/services/users/invitations";
import { formatDateTime } from "@/lib/format";
import { InviteSignUpForm, JoinButton, SwitchAccountButton } from "./invite-forms";

export const metadata: Metadata = { title: "Accept invitation", robots: { index: false, follow: false } };

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <div className="min-h-svh bg-sidebar">
      <header className="px-6 py-5 sm:px-10">
        <Wordmark />
      </header>
      <main className="mx-auto max-w-md px-4 pt-6 pb-16 animate-enter sm:px-6">
        <div className="rounded-xl border bg-card p-6 shadow-xs">
          <Suspense fallback={<InviteSkeleton />}>
            <Invite params={params} />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

const STATE_COPY: Record<Exclude<PublicInvitation["state"], "valid">, { title: string; body: (i: PublicInvitation) => string }> = {
  invalid: {
    title: "This invitation link is not valid",
    body: () => "The link may be incomplete, or a newer invitation replaced it. Check your latest email or ask your administrator to resend it.",
  },
  expired: {
    title: "This invitation has expired",
    body: (i) => `Invitations are valid for 7 days. Ask ${i.inviterName ?? "your administrator"} at ${i.tenantName} to resend it.`,
  },
  revoked: {
    title: "This invitation was withdrawn",
    body: (i) => `${i.tenantName ?? "The organization"} revoked this invitation. Contact your administrator if you think this is a mistake.`,
  },
  accepted: {
    title: "Invitation already accepted",
    body: (i) => `This invitation to ${i.tenantName ?? "the organization"} has been used. Sign in to continue.`,
  },
};

async function Invite({ params }: { params: PageProps<"/invite/[token]">["params"] }) {
  const { token } = await params;
  const [inv, session] = await Promise.all([getInvitationByToken(token), getSession()]);

  if (inv.state !== "valid") {
    const copy = STATE_COPY[inv.state];
    return (
      <div className="space-y-4">
        <CircleAlert className="size-5 text-warning" aria-hidden />
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{copy.title}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{copy.body(inv)}</p>
        </div>
        <Button variant="outline" asChild>
          <Link href={session ? "/overview" : "/login"}>{session ? "Go to PeopleSuccess" : "Sign in"}</Link>
        </Button>
      </div>
    );
  }

  const intro = (
    <div className="space-y-1.5">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Invitation</p>
      <h1 className="text-xl font-semibold tracking-tight text-balance">Join {inv.tenantName} on PeopleSuccess</h1>
      <p className="text-sm text-muted-foreground">
        {inv.inviterName ? `${inv.inviterName} invited ` : "You were invited as "}
        <span className="font-medium text-foreground">{inv.email}</span>. Expires {formatDateTime(inv.expiresAt)}.
      </p>
    </div>
  );

  if (session) {
    const matches = session.email?.toLowerCase() === inv.email?.toLowerCase();
    return (
      <div className="space-y-6">
        {intro}
        {matches ? (
          <JoinButton token={token} tenantName={inv.tenantName!} />
        ) : (
          <div className="space-y-4">
            <p role="alert" className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
              You are signed in as {session.email ?? "another account"}. This invitation is for {inv.email}.
            </p>
            <SwitchAccountButton token={token} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {intro}
      <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
        <MailCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
        <p className="text-sm">
          Already have a PeopleSuccess account?{" "}
          <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="font-medium underline-offset-4 hover:underline">
            Sign in to accept
          </Link>
        </p>
      </div>
      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Or create your account</h2>
        <InviteSignUpForm token={token} email={inv.email!} />
      </div>
    </div>
  );
}

function InviteSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}
