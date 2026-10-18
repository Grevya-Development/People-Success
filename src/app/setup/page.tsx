import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, CircleAlert, Lock } from "lucide-react";
import { cn } from "cn";
import { Wordmark } from "@/components/brand";
import { Reveal } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireContext } from "@/server/auth/context";
import { getSetupStatus } from "@/server/services/settings/setup";
import { formatDate } from "@/lib/format";
import { CompleteSetupButton, MarkStepButton } from "./wizard-buttons";

export const metadata: Metadata = { title: "Setup checklist" };

export default function SetupPage() {
  return (
    <div className="min-h-svh bg-sidebar">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Wordmark />
        <Link href="/overview" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to app
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-4 pt-4 pb-16 sm:px-6">
        <Suspense fallback={<WizardSkeleton />}>
          <Wizard />
        </Suspense>
      </main>
    </div>
  );
}

async function Wizard() {
  const ctx = await requireContext();
  const s = await getSetupStatus(ctx);
  const done = s.steps.filter((x) => x.done).length;
  const review = s.steps.find((x) => x.key === "review")!;
  const warnings = s.readiness.filter((r) => r.status === "warn").length;

  return (
    <Reveal className="space-y-6">
      <div>
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {s.completedAt ? `Live since ${formatDate(s.completedAt)}` : `${done} of ${s.steps.length} steps complete`}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Set up {s.tenantName}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Work through these in any order. Steps tick themselves off when the data exists; you can also mark a step as done when it does not apply.
        </p>
        {!s.canManage ? (
          <p className="mt-3 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
            You can view progress. Only people who manage company settings can change it.
          </p>
        ) : null}
        <div
          className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={s.steps.length}
          aria-valuenow={done}
        >
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(done / s.steps.length) * 100}%` }} />
        </div>
      </div>

      <ol className="overflow-hidden rounded-xl border bg-card">
        {s.steps
          .filter((x) => x.key !== "review")
          .map((step, i) => (
            <li key={step.key} className="flex flex-col gap-3 border-b px-5 py-4 last:border-0 sm:flex-row sm:items-center">
              <div className="flex flex-1 items-start gap-3">
                {step.done ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-label="Done" />
                ) : step.available ? (
                  <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground/60" aria-label="Not done" />
                ) : (
                  <Lock className="mt-0.5 size-5 shrink-0 text-muted-foreground/60" aria-label="Not available yet" />
                )}
                <div className="min-w-0">
                  <p className={cn("text-sm font-medium", step.done && "text-muted-foreground")}>
                    <span className="mr-1.5 text-muted-foreground tabular">{i + 1}.</span>
                    {step.title}
                    {step.done && step.auto && !step.marked ? <span className="ml-2 text-xs font-normal text-muted-foreground">Detected</span> : null}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {step.available ? step.description : "Available when the module is enabled. You can mark it as done if it does not apply."}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 pl-8 sm:pl-0">
                {step.link ? (
                  <Button variant={step.done ? "ghost" : "outline"} size="sm" asChild>
                    <Link href={step.link.href}>
                      {step.done ? "Review" : step.link.label} <ArrowRight />
                    </Link>
                  </Button>
                ) : null}
                {s.canManage && !step.done && step.key !== "organization" ? <MarkStepButton step={step.key} /> : null}
              </div>
            </li>
          ))}
      </ol>

      <section className="rounded-xl border bg-card">
        <header className="flex flex-col gap-1 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">{review.title}</h2>
            <p className="text-sm text-muted-foreground">
              {warnings ? `${warnings} item${warnings === 1 ? "" : "s"} to look at. You can still go live and finish them later.` : "Everything looks ready."}
            </p>
          </div>
          {s.completedAt ? <StatusBadge status="active" label="Live" /> : null}
        </header>
        <ul className="divide-y">
          {s.readiness.map((r) => (
            <li key={r.key} className="flex items-start gap-3 px-5 py-3">
              {r.status === "pass" ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Pass" />
              ) : (
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Needs attention" />
              )}
              <div className="flex-1">
                <p className="text-sm font-medium">{r.label}</p>
                <p className="text-sm text-muted-foreground">{r.detail}</p>
              </div>
              {r.href && r.status === "warn" ? (
                <Button variant="ghost" size="sm" asChild>
                  <Link href={r.href}>Fix</Link>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {s.canManage && !s.completedAt ? (
          <footer className="flex flex-col gap-3 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">Completing setup marks your organization as live.</p>
            <CompleteSetupButton warnings={warnings} />
          </footer>
        ) : null}
      </section>
    </Reveal>
  );
}

function WizardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-full" />
      </div>
      <Skeleton className="h-[480px] rounded-xl" />
    </div>
  );
}
