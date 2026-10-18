import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { NoAccess, Page, Reveal, Section, TableSkeleton } from "@/components/page";
import { PersonAvatar } from "@/components/person";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { can, requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { assignableMembers, buddyOptions, getPlanDetail } from "@/server/services/lifecycle/plans";
import { formatDate, formatDateTime, todayIn } from "@/lib/format";
import { Facts, PlanStatusBadge, ProgressMeter } from "../../_components/ui";
import { TaskBoard } from "../../_components/task-board";
import { BuddyDialog, CancelPlanButton, MarkJoinedDialog, RefreshEvidenceButton } from "../../_components/plan-controls";

export const metadata: Metadata = { title: "Onboarding plan" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function PlanPage({ params }: PageProps<"/onboarding/plans/[id]">) {
  return (
    <Page>
      <Suspense fallback={<TableSkeleton rows={8} columns={3} />}>
        <PlanBody params={params} />
      </Suspense>
    </Page>
  );
}

async function PlanBody({ params }: { params: PageProps<"/onboarding/plans/[id]">["params"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireContext();
  let plan;
  try {
    plan = await getPlanDetail(ctx, id);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    if (err instanceof AppError && err.code === "FORBIDDEN") return <NoAccess />;
    throw err;
  }
  if (plan.kind === "offboarding" && plan.exitCaseId) redirect(`/onboarding/exits/${plan.exitCaseId}`);
  const open = plan.status === "not_started" || plan.status === "in_progress";
  const [members, buddies] = await Promise.all([plan.canManage ? assignableMembers(ctx) : [], plan.canManage && open ? buddyOptions(ctx) : []]);
  const e = plan.employee;
  const settled = plan.tasks.filter((t) => t.status === "done" || t.status === "waived").length;
  const overdue = plan.tasks.filter((t) => t.overdue).length;
  const canMarkJoined = plan.canManage && can(ctx, "employees.edit", "all") && e.status === "pending" && e.joiningDate <= todayIn();

  return (
    <Reveal>
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
          <Link href={plan.isSubject && !plan.canManage ? "/onboarding?tab=me" : "/onboarding?tab=onboarding"}>
            <ArrowLeft /> Onboarding
          </Link>
        </Button>
      </div>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <PersonAvatar id={e.id} name={e.name} className="size-12" />
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
              {e.name}
              <PlanStatusBadge status={plan.status} />
              {e.status === "pending" ? <StatusBadge status="pending" label="Pre-joining" /> : null}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[e.designation, e.department, `joins ${formatDate(e.joiningDate)}`].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {open ? <RefreshEvidenceButton planId={plan.id} /> : null}
          {plan.canManage && open ? <BuddyDialog planId={plan.id} current={plan.buddy?.id ?? null} buddies={buddies} /> : null}
          {canMarkJoined ? <MarkJoinedDialog employeeId={e.id} name={e.name} joiningDate={e.joiningDate} /> : null}
          {plan.canManage && open ? <CancelPlanButton planId={plan.id} /> : null}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Section
          title="Checklist"
          description={`${settled} of ${plan.tasks.length} tasks settled${overdue ? ` · ${overdue} overdue` : ""}`}
          actions={<ProgressMeter value={plan.progressPercent} className="w-40" label="Plan progress" />}
        >
          <TaskBoard
            employeeId={e.id}
            tasks={plan.tasks}
            pendingPolicies={plan.pendingPolicies}
            canManage={plan.canManage}
            isSubject={plan.isSubject}
            members={members}
          />
        </Section>
        <div className="space-y-5">
          <Section title="Details">
            <div className="p-5">
              <Facts
                items={[
                  ["Employee code", e.code],
                  ["Manager", e.managerName ?? "Not set"],
                  ["Buddy", plan.buddy?.name ?? "Not assigned"],
                  ["Template", plan.templateName],
                  ["Anchor date", formatDate(plan.anchorDate)],
                  [
                    "Login",
                    e.hasLogin ? (
                      "Active"
                    ) : plan.canManage && can(ctx, "users.manage", "all") ? (
                      <Link href="/settings/users" className="text-brand hover:underline">
                        Invite pending — invite in Settings
                      </Link>
                    ) : (
                      "Invite pending"
                    ),
                  ],
                  ["Started", formatDateTime(plan.createdAt)],
                  ["Completed", plan.completedAt ? formatDateTime(plan.completedAt) : null],
                ]}
              />
            </div>
          </Section>
          <Section title="Timeline">
            <ol className="space-y-3 p-5">
              {plan.timeline.slice(0, 30).map((t, i) => (
                <li key={`${t.at}-${i}`} className="relative pl-4 text-sm before:absolute before:top-1.5 before:left-0 before:size-1.5 before:rounded-full before:bg-border">
                  <p className="font-medium">{t.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(t.at)}
                    {t.detail ? ` · ${t.detail}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>
    </Reveal>
  );
}
