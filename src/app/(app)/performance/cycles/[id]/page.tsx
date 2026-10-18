import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Users } from "lucide-react";
import { EmptyState, NoAccess, Page, PageHeader, Section, StatGridSkeleton, TableSkeleton } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { getCycleDetail } from "@/server/services/talent/performance/cycles";
import { performanceSetup } from "@/server/services/talent/performance/setup";
import { employeeFormLookups } from "@/server/services/employees/lookups";
import { formatDate, titleCase } from "@/lib/format";
import { CycleDialog } from "../../_components/hr-dialogs";
import { RunButton } from "../../_components/run-button";
import { closeCycleAction, launchCycleAction, shareReviewsAction, startCalibrationAction } from "../../actions";

export const metadata: Metadata = { title: "Review cycle" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function CyclePage({ params }: PageProps<"/performance/cycles/[id]">) {
  return (
    <Page>
      <Suspense
        fallback={
          <div className="space-y-6">
            <StatGridSkeleton />
            <TableSkeleton rows={6} columns={6} />
          </div>
        }
      >
        <Body params={params} />
      </Suspense>
    </Page>
  );
}

async function Body({ params }: { params: PageProps<"/performance/cycles/[id]">["params"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireContext();
  if (!can(ctx, "performance.manage", "all")) return <NoAccess />;
  let detail;
  try {
    detail = await getCycleDetail(ctx, id);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const { cycle, progress, participants } = detail;
  const editData = cycle.status === "draft" ? await Promise.all([performanceSetup(ctx), employeeFormLookups(ctx)]) : null;
  const cond = cycle.participantConditions as { departmentIds?: string[]; locationIds?: string[]; joinedOnOrBefore?: string };

  const stat = (label: string, s: { total: number; submitted: number }) => (
    <div className="space-y-1 bg-card p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular">
        {s.submitted}
        <span className="text-sm font-normal text-muted-foreground"> / {s.total}</span>
      </p>
    </div>
  );

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/performance?tab=cycles" className="hover:underline">
            Performance · Cycles
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {cycle.name} <StatusBadge status={cycle.status} tone={cycle.status === "calibration" ? "warning" : undefined} />
          </span>
        }
        description={`${titleCase(cycle.kind)} · ${formatDate(cycle.periodStart)} – ${formatDate(cycle.periodEnd)} · ${detail.templateName ?? "Template"} · ${detail.scaleName ?? "Scale"}`}
        actions={
          <>
            {cycle.status === "draft" && editData ? (
              <CycleDialog
                templates={editData[0].templates.map((t) => ({ value: t.id, label: t.name }))}
                scales={editData[0].scales.map((s) => ({ value: s.id, label: s.name }))}
                departments={editData[1].departments}
                locations={editData[1].locations}
                values={{
                  id: cycle.id,
                  name: cycle.name,
                  kind: cycle.kind as "annual",
                  periodStart: cycle.periodStart,
                  periodEnd: cycle.periodEnd,
                  templateId: cycle.templateId,
                  ratingScaleId: cycle.ratingScaleId,
                  selfDueOn: cycle.selfDueOn,
                  peerDueOn: cycle.peerDueOn,
                  managerDueOn: cycle.managerDueOn,
                  calibrationDueOn: cycle.calibrationDueOn,
                  includePeers: cycle.includePeers,
                  includeUpward: cycle.includeUpward,
                  departmentIds: cond.departmentIds ?? [],
                  locationIds: cond.locationIds ?? [],
                  joinedOnOrBefore: cond.joinedOnOrBefore ?? null,
                }}
              />
            ) : null}
            {cycle.status === "draft" ? (
              <RunButton
                action={launchCycleAction}
                input={{ id: cycle.id }}
                variant="default"
                success="Cycle launched; participants notified"
                confirm={{
                  title: "Launch this cycle?",
                  description: `${detail.preview?.count ?? 0} employees will get a self review${detail.preview?.withoutManager ? `; ${detail.preview.withoutManager} have no manager and will not get a manager review` : ""}. Participants are notified now.`,
                  confirmLabel: "Launch",
                }}
              >
                Launch cycle
              </RunButton>
            ) : null}
            {cycle.status === "active" ? (
              <RunButton
                action={startCalibrationAction}
                input={{ id: cycle.id }}
                variant="default"
                success="Calibration started"
                confirm={{ title: "Start calibration?", description: "Self, peer and upward reviews close. Managers can still finish their reviews; HR can adjust ratings.", confirmLabel: "Start calibration" }}
              >
                Start calibration
              </RunButton>
            ) : null}
            {cycle.status === "calibration" ? (
              <>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/performance?tab=calibration&cycle=${cycle.id}`}>Calibrate</Link>
                </Button>
                <RunButton
                  action={shareReviewsAction}
                  input={{ id: cycle.id }}
                  success="Submitted manager reviews shared"
                  confirm={{ title: "Share manager reviews?", description: "Every submitted manager review becomes visible to its employee, who is asked to acknowledge it. Shared reviews can no longer be calibrated.", confirmLabel: "Share" }}
                >
                  Share reviews
                </RunButton>
                <RunButton
                  action={closeCycleAction}
                  input={{ id: cycle.id }}
                  variant="default"
                  success="Cycle closed"
                  confirm={{ title: "Close this cycle?", description: "All reviews are locked and kept as history. Upward feedback summaries are released to managers (only with 3 or more responses).", confirmLabel: "Close cycle", destructive: true }}
                >
                  Close cycle
                </RunButton>
              </>
            ) : null}
          </>
        }
      />

      {cycle.status === "draft" ? (
        <Section title="Before launch" className="mb-6">
          <div className="space-y-1 px-5 py-4 text-sm">
            <p>
              <span className="font-medium tabular">{detail.preview?.count ?? 0}</span> eligible employees (current, joined on or before {formatDate(detail.cutoff)}
              {cond.departmentIds?.length ? `, ${cond.departmentIds.length} departments` : ""}
              {cond.locationIds?.length ? `, ${cond.locationIds.length} locations` : ""}).
            </p>
            {detail.preview?.withoutManager ? <p className="text-warning">{detail.preview.withoutManager} have no manager; HR will be notified to review them.</p> : null}
            <p className="text-muted-foreground">
              Peers: {cycle.includePeers ? "on (managers assign up to 3)" : "off"} · Upward feedback: {cycle.includeUpward ? "on" : "off"}
            </p>
          </div>
        </Section>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-5">
          {stat("Self reviews", progress.self)}
          {stat("Manager reviews", progress.manager)}
          {stat("Peer reviews", progress.peer)}
          {stat("Upward feedback", progress.upward)}
          {stat("Acknowledged", { submitted: detail.acknowledged, total: progress.manager.total })}
        </div>
      )}

      <Section title="Participants" description={cycle.status === "draft" ? "Reviews are created when you launch." : `${participants.length} people`}>
        {participants.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Employee</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Self</TableHead>
                  <TableHead>Manager</TableHead>
                  <TableHead className="text-right">Peers</TableHead>
                  <TableHead className="text-right">Rating</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {participants.map((p) => (
                  <TableRow key={p.employeeId}>
                    <TableCell>
                      <Link href={`/employees/${p.employeeId}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{p.code}</p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.department ?? "—"}</TableCell>
                    <TableCell>{p.selfStatus ? <StatusBadge status={p.selfStatus} /> : "—"}</TableCell>
                    <TableCell>
                      {p.managerStatus ? (
                        <span className="flex flex-col gap-0.5">
                          <StatusBadge status={p.managerStatus} />
                          <span className="text-xs text-muted-foreground">{p.managerName}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-warning">No manager</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular">{p.peerCount || "—"}</TableCell>
                    <TableCell className="text-right tabular">{p.finalRating != null ? p.finalRating.toFixed(2) : "—"}</TableCell>
                    <TableCell className="text-right">
                      {p.managerReviewId ? (
                        <Button size="sm" variant="ghost" asChild>
                          <Link href={`/performance/reviews/${p.managerReviewId}`}>Open</Link>
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState icon={Users} title={cycle.status === "draft" ? "Not launched yet" : "No participants"} className="m-4" />
        )}
      </Section>
    </>
  );
}
