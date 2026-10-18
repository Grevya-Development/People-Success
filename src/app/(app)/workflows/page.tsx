import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus, Workflow } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { EmptyState, NoAccess, Page, PageHeader, Reveal, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, requireContext } from "@/server/auth/context";
import { listRuns, listWorkflows } from "@/server/services/workflows/definitions";
import { formatDateTime } from "@/lib/format";
import { ActiveToggle, SeedStartersButton } from "./workflow-controls";

export const metadata: Metadata = { title: "Workflows" };

export default function WorkflowsPage({ searchParams }: PageProps<"/workflows">) {
  return (
    <Page>
      <PageHeader
        title="Workflows"
        description="Automate tasks, reminders, approvals and notifications when things happen in PeopleSuccess."
        actions={
          <Button size="sm" asChild>
            <Link href="/workflows/new">
              <Plus /> New workflow
            </Link>
          </Button>
        }
      />
      <Suspense fallback={<TableSkeleton rows={6} columns={5} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Body({ searchParams }: { searchParams: PageProps<"/workflows">["searchParams"] }) {
  const ctx = await requireContext();
  if (!can(ctx, "workflows.manage", "all")) return <NoAccess />;
  const sp = await searchParams;
  const tab = sp.tab === "runs" ? "runs" : "definitions";
  return (
    <>
      <nav className="mb-5 border-b" aria-label="Workflow sections">
        <ul className="flex gap-1">
          {[
            ["definitions", "Workflows"],
            ["runs", "Run history"],
          ].map(([key, label]) => (
            <li key={key}>
              <Link
                href={`?tab=${key}`}
                aria-current={tab === key ? "page" : undefined}
                className={`relative inline-flex h-10 items-center px-3 text-sm ${tab === key ? "font-medium text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Reveal key={tab}>{tab === "runs" ? <Runs status={typeof sp.status === "string" ? sp.status : undefined} /> : <Definitions />}</Reveal>
    </>
  );
}

async function Definitions() {
  const ctx = await requireContext();
  const defs = await listWorkflows(ctx);
  if (!defs.length) {
    return (
      <EmptyState
        icon={Workflow}
        title="No workflows yet"
        description="Start from ready-made workflows for joiners, probation, leave, payroll, reviews and exits, then adjust them."
        action={<SeedStartersButton />}
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Workflow</TableHead>
            <TableHead>Trigger</TableHead>
            <TableHead className="text-right">Runs</TableHead>
            <TableHead>Last run</TableHead>
            <TableHead className="w-28">Active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {defs.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="min-w-64">
                <Link href={`/workflows/${d.id}`} className="font-medium hover:underline">
                  {d.name}
                </Link>
                {d.isStarter ? <StatusBadge status="starter" tone="neutral" className="ml-2" /> : null}
                {d.description ? <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{d.description}</p> : null}
              </TableCell>
              <TableCell className="text-muted-foreground">{d.triggerLabel}</TableCell>
              <TableCell className="text-right tabular">
                {d.runs}
                {d.failedRuns ? (
                  <Link href={`/workflows?tab=runs&status=failed`} className="ml-1 text-xs text-danger hover:underline">
                    ({d.failedRuns} failed)
                  </Link>
                ) : null}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {d.lastRunAt ? formatDistanceToNowStrict(new Date(d.lastRunAt), { addSuffix: true }) : "Never"}
              </TableCell>
              <TableCell>
                <ActiveToggle id={d.id} active={d.isActive} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

async function Runs({ status }: { status?: string }) {
  const ctx = await requireContext();
  const runs = await listRuns(ctx, { status });
  if (!runs.length) return <EmptyState icon={Workflow} title={status ? `No ${status} runs` : "No runs yet"} description="Runs appear here when an active workflow is triggered." />;
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Workflow</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Error</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Link href={`/workflows/runs/${r.id}`} className="font-medium hover:underline">
                  {r.definitionName}
                </Link>
                <span className="ml-1 text-xs text-muted-foreground">v{r.version}</span>
              </TableCell>
              <TableCell>{r.subjectName ?? <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell>
                <StatusBadge status={r.status} />
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground tabular">{formatDateTime(r.startedAt)}</TableCell>
              <TableCell className="max-w-72 truncate text-xs text-danger">{r.error ?? ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
