import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { cn } from "cn";
import { NoAccess, Page, PageHeader, Section } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { can, requireContext } from "@/server/auth/context";
import { getRun } from "@/server/services/workflows/definitions";
import { AppError } from "@/server/lib/errors";
import { formatDateTime } from "@/lib/format";
import { RunControls } from "../../workflow-controls";

export const metadata: Metadata = { title: "Workflow run" };

export default function RunPage({ params }: PageProps<"/workflows/runs/[runId]">) {
  return (
    <Page width="narrow">
      <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
        <Loader params={params} />
      </Suspense>
    </Page>
  );
}

async function Loader({ params }: { params: PageProps<"/workflows/runs/[runId]">["params"] }) {
  const { runId } = await params;
  const ctx = await requireContext();
  if (!can(ctx, "workflows.manage", "all")) return <NoAccess />;
  if (!/^[0-9a-f-]{36}$/i.test(runId)) notFound();
  let data: Awaited<ReturnType<typeof getRun>>;
  try {
    data = await getRun(ctx, runId);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const { run, plan, steps } = data;
  const byKey = new Map(steps.map((s) => [s.stepKey, s]));
  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/workflows/${run.definitionId}`} className="hover:underline">{data.name} · v{run.version}</Link>}
        title={data.subjectName ? `Run for ${data.subjectName}` : "Workflow run"}
        description={`Started ${formatDateTime(run.startedAt)}${run.finishedAt ? ` · finished ${formatDateTime(run.finishedAt)}` : ""}`}
        actions={
          <>
            <StatusBadge status={run.status} />
            <RunControls runId={run.id} status={run.status} />
          </>
        }
      />
      {run.error ? <p className="mb-5 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{run.error}</p> : null}
      <Section title="Steps">
        <ol className="divide-y">
          {plan.map((p, i) => {
            const s = byKey.get(p.key);
            const status = s?.status ?? (i < run.currentStepIndex ? "succeeded" : "pending");
            return (
              <li key={p.key} className="flex gap-3 px-5 py-3.5">
                <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular", status === "succeeded" ? "bg-success-soft text-success" : status === "failed" ? "bg-danger-soft text-danger" : status === "waiting" || status === "running" ? "bg-info-soft text-info" : "bg-muted text-muted-foreground")}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{p.name}</span>
                    <StatusBadge status={status} />
                    {s?.attempts ? <span className="text-xs text-muted-foreground">{s.attempts} attempt{s.attempts === 1 ? "" : "s"}</span> : null}
                  </div>
                  {s?.error ? <p className="mt-1 text-xs text-danger">{s.error}</p> : null}
                  {s?.output && Object.keys(s.output).length ? (
                    <pre className="mt-1.5 overflow-x-auto rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">{JSON.stringify(s.output, null, 2)}</pre>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </Section>
    </>
  );
}
