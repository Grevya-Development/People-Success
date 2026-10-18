import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/brand";
import { getAccess, getSession } from "@/server/auth/context";
import { pendingInvitationsForEmail } from "@/server/services/users/invitations";
import { PendingInvitations } from "./pending-invitations";
import { CreateOrganizationForm } from "./create-organization-form";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Set up your organization" };

export default function SetupOrganizationPage() {
  return (
    <div className="min-h-svh bg-sidebar">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Wordmark />
        <form action="/auth/signout" method="post">
          <button className="text-sm text-muted-foreground hover:text-foreground">Sign out</button>
        </form>
      </header>
      <main className="mx-auto max-w-xl px-6 pt-8 pb-16 animate-enter">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Step 1 of 10</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Create your organization</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          This creates your workspace and its first legal entity. You can add more entities, locations and policies next.
        </p>
        <Suspense fallback={<Skeleton className="mt-8 h-80 rounded-xl" />}>
          <Gate />
        </Suspense>
      </main>
    </div>
  );
}

async function Gate() {
  const [access, session] = await Promise.all([getAccess(), getSession()]);
  if (!access) redirect("/login?next=/setup/organization");
  // People who signed up from an invitation land here after confirming their email.
  const invites = session?.email ? await pendingInvitationsForEmail(session.email) : [];
  return (
    <>
      {invites.length ? <PendingInvitations invites={invites} /> : null}
      <div className="mt-8 rounded-xl border bg-card p-6 shadow-xs">
        {invites.length ? <p className="mb-5 text-sm text-muted-foreground">Or create a new organization of your own:</p> : null}
        <CreateOrganizationForm hasExisting={access.tenants.length > 0} />
      </div>
    </>
  );
}
