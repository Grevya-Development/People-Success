import Link from "next/link";
import { ArrowRight, CheckCircle2, Inbox, ListChecks } from "lucide-react";
import { PageHeader, Reveal } from "@/components/page";
import { Button } from "@/components/ui/button";
import { requireContext } from "@/server/auth/context";
import { getOverview } from "@/server/services/overview";
import { SETUP_STEPS } from "@/lib/setup-steps";

function greeting(name: string | null) {
  const hour = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name.split(" ")[0]}` : part;
}

export async function OverviewGreeting() {
  const ctx = await requireContext();
  return (
    <PageHeader
      title={greeting(ctx.fullName)}
      description={`${ctx.tenantName} · ${new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" }).format(new Date())}`}
    />
  );
}

export async function OverviewContent() {
  const ctx = await requireContext();
  const data = await getOverview(ctx);
  const setupIncomplete = data.setup && !data.setup.completedAt;
  const done = new Set(data.setup?.completedSteps ?? []);

  return (
    <Reveal className="space-y-6">
      {setupIncomplete ? (
        <section className="rounded-xl border bg-card p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">Finish setting up {ctx.tenantName}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {done.size} of {SETUP_STEPS.length} steps complete. Payroll and leave stay disabled until their settings are reviewed.
              </p>
            </div>
            <Button asChild>
              <Link href="/setup">
                Continue setup <ArrowRight />
              </Link>
            </Button>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={SETUP_STEPS.length} aria-valuenow={done.size}>
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(done.size / SETUP_STEPS.length) * 100}%` }} />
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/inbox?tab=approvals" className="group flex items-center gap-4 rounded-xl border bg-card p-5 transition-colors hover:bg-muted/40">
          <span className="flex size-10 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <Inbox className="size-5" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium">Waiting for your approval</p>
            <p className="text-sm text-muted-foreground">
              {data.myPendingApprovals ? `${data.myPendingApprovals} request${data.myPendingApprovals === 1 ? "" : "s"}` : "Nothing pending"}
            </p>
          </div>
          <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
        <Link href="/inbox?tab=tasks" className="group flex items-center gap-4 rounded-xl border bg-card p-5 transition-colors hover:bg-muted/40">
          <span className="flex size-10 items-center justify-center rounded-lg bg-success-soft text-success">
            {data.myOpenTasks ? <ListChecks className="size-5" /> : <CheckCircle2 className="size-5" />}
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium">Your tasks</p>
            <p className="text-sm text-muted-foreground">
              {data.myOpenTasks ? `${data.myOpenTasks} open task${data.myOpenTasks === 1 ? "" : "s"}` : "All done"}
            </p>
          </div>
          <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </Reveal>
  );
}
