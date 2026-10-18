import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { NoAccess, Page, Reveal, Section, TableSkeleton } from "@/components/page";
import { PersonAvatar } from "@/components/person";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { getExitCase } from "@/server/services/lifecycle/exits";
import { assignableMembers } from "@/server/services/lifecycle/plans";
import { formatDate, formatDateTime, formatMoney, formatNumber, todayIn } from "@/lib/format";
import {
  EXIT_REASON_LABELS,
  EXIT_TYPE_LABELS,
  INTERVIEW_RATING_KEYS,
  INTERVIEW_RATING_LABELS,
  SHORTFALL_LABELS,
  type ExitReasonCategory,
  type ExitType,
} from "@/lib/validation/lifecycle";
import { ExitStatusBadge, Facts, ProgressMeter, SettlementBadge } from "../../_components/ui";
import { TaskBoard } from "../../_components/task-board";
import {
  CancelExitDialog,
  CompleteExitDialog,
  ExitTermsDialog,
  GenerateLettersDialog,
  InterviewDialog,
  ReturnAssetDialog,
  SettlementInputsDialog,
  SettlementStatusActions,
  SuspendLoginButton,
} from "../../_components/exit-controls";

export const metadata: Metadata = { title: "Exit" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reasonLabel = (r: string | null | undefined) => (r ? (EXIT_REASON_LABELS[r as ExitReasonCategory] ?? r) : null);

export default function ExitPage({ params }: PageProps<"/onboarding/exits/[id]">) {
  return (
    <Page>
      <Suspense fallback={<TableSkeleton rows={8} columns={3} />}>
        <ExitBody params={params} />
      </Suspense>
    </Page>
  );
}

async function ExitBody({ params }: { params: PageProps<"/onboarding/exits/[id]">["params"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireContext();
  let ec;
  try {
    ec = await getExitCase(ctx, id);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    if (err instanceof AppError && err.code === "FORBIDDEN") return <NoAccess />;
    throw err;
  }
  if (ec.access === "self") redirect("/onboarding?tab=my-exit");
  const members = ec.can.manage ? await assignableMembers(ctx) : [];
  const active = ec.status === "accepted" || ec.status === "in_progress";
  const open = active || ec.status === "submitted" || ec.status === "under_review";
  const e = ec.employee;
  const settlementEditable = active && (ec.settlementStatus === "not_started" || ec.settlementStatus === "draft");
  const lettersVisibleNow = ec.status === "completed" || (!!ec.lastWorkingDate && ec.lastWorkingDate <= todayIn());

  return (
    <Reveal>
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
          <Link href="/onboarding?tab=exits">
            <ArrowLeft /> Exits
          </Link>
        </Button>
      </div>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <PersonAvatar id={e.id} name={e.name} className="size-12" />
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
              <Link href={`/employees/${e.id}`} className="hover:underline">
                {e.name}
              </Link>
              <ExitStatusBadge status={ec.status} />
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[EXIT_TYPE_LABELS[ec.type as ExitType] ?? ec.type, e.designation, e.department, ec.lastWorkingDate ? `last day ${formatDate(ec.lastWorkingDate)}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
        {ec.can.manage ? (
          <div className="flex flex-wrap items-center gap-2">
            {active ? <ExitTermsDialog exitCaseId={ec.id} lastWorkingDate={ec.lastWorkingDate} treatment={ec.shortfallTreatment} submittedOn={ec.submittedOn} /> : null}
            {ec.can.suspendLogin ? <SuspendLoginButton exitCaseId={ec.id} name={e.name} /> : null}
            {open ? <CancelExitDialog exitCaseId={ec.id} /> : null}
            {active ? <CompleteExitDialog exitCaseId={ec.id} name={e.name} blockers={ec.completionBlockers} reason={reasonLabel(ec.reasonCategory)} /> : null}
          </div>
        ) : null}
      </header>

      {ec.can.manage && active && ec.completionBlockers.length ? (
        <div role="status" className="mb-5 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Before completing the exit</p>
            <ul className="mt-1 list-disc pl-4">
              {ec.completionBlockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {ec.plan ? (
            <Section
              title="Offboarding checklist"
              description={`Due dates are relative to the last working day (${formatDate(ec.plan.anchorDate)}).`}
              actions={<ProgressMeter value={ec.plan.progressPercent} className="w-40" label="Checklist progress" />}
            >
              <TaskBoard
                employeeId={e.id}
                tasks={ec.plan.tasks}
                pendingPolicies={[]}
                canManage={ec.can.manage}
                isSubject={false}
                canConfirmAccess={ec.can.confirmAccess}
                members={members}
              />
            </Section>
          ) : (
            <Section title="Offboarding checklist">
              <p className="px-5 py-6 text-sm text-muted-foreground">
                {ec.status === "submitted" || ec.status === "under_review" ? "The checklist starts when the exit is approved." : "No checklist for this exit."}
              </p>
            </Section>
          )}

          {ec.access !== "viewer" ? (
            <Section title="Company assets" description="Returns are recorded on the employee's asset history.">
              {ec.assets.length ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Asset</TableHead>
                        <TableHead>Assigned</TableHead>
                        <TableHead>Returned</TableHead>
                        <TableHead className="w-32" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ec.assets.map((a) => (
                        <TableRow key={a.assignmentId}>
                          <TableCell>
                            <span className="font-medium">{a.name}</span>
                            <span className="ml-1 text-xs text-muted-foreground">
                              {a.tag} · {a.category}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap tabular">{formatDate(a.assignedOn)}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {a.returnedOn ? (
                              <span className="tabular">
                                {formatDate(a.returnedOn)}
                                {a.conditionIn ? <span className="text-xs text-muted-foreground"> · {a.conditionIn}</span> : null}
                              </span>
                            ) : (
                              <StatusBadge status="pending" label="Outstanding" />
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {!a.returnedOn && ec.can.returnAssets && active ? <ReturnAssetDialog exitCaseId={ec.id} assignmentId={a.assignmentId} label={a.name} /> : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="px-5 py-6 text-sm text-muted-foreground">No assets were assigned.</p>
              )}
            </Section>
          ) : null}

          {ec.can.settle ? (
            <Section
              title="Full-and-final settlement inputs"
              description="Payroll computes the amounts; this records the inputs and approval status."
              actions={<SettlementBadge status={ec.settlementStatus} />}
            >
              <div className="space-y-4 p-5">
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Leave balances today</p>
                  {ec.leave.length ? (
                    <ul className="flex flex-wrap gap-2">
                      {ec.leave.map((l) => (
                        <li key={l.leaveTypeId} className="rounded-lg border px-3 py-1.5 text-sm">
                          {l.name} <span className="font-medium tabular">{formatNumber(l.balance, 1)}</span>
                          {l.pending ? <span className="text-xs text-muted-foreground"> ({formatNumber(l.pending, 1)} pending)</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No leave balances on record.</p>
                  )}
                </div>
                {ec.settlementInputs ? (
                  <Facts
                    items={[
                      ["Notice recovery", `${ec.settlementInputs.noticeRecoveryDays} days`],
                      ["Notice pay in lieu", `${ec.settlementInputs.noticePayInLieuDays} days`],
                      ["Leave encashment", `${formatNumber(ec.settlementInputs.leaveEncashmentDays, 1)} days`],
                      ["Other recoveries", `${formatMoney(ec.settlementInputs.otherRecoveries)}${ec.settlementInputs.otherRecoveriesNote ? ` · ${ec.settlementInputs.otherRecoveriesNote}` : ""}`],
                      ["Other payments", `${formatMoney(ec.settlementInputs.otherPayments)}${ec.settlementInputs.otherPaymentsNote ? ` · ${ec.settlementInputs.otherPaymentsNote}` : ""}`],
                      ["Notes", ec.settlementInputs.notes],
                      ["Saved", formatDateTime(ec.settlementInputs.savedAt)],
                    ]}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No inputs prepared yet.</p>
                )}
                <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                  {settlementEditable ? (
                    <SettlementInputsDialog
                      exitCaseId={ec.id}
                      value={ec.settlementInputs}
                      shortfallDays={ec.noticeShortfallDays}
                      treatment={ec.shortfallTreatment}
                      leave={ec.leave.map((l) => ({ name: l.name, balance: l.balance }))}
                    />
                  ) : null}
                  <SettlementStatusActions exitCaseId={ec.id} status={ec.settlementStatus} canManage={ec.can.manage} canApprove={ec.can.approveSettlement} hasInputs={!!ec.settlementInputs} />
                </div>
              </div>
            </Section>
          ) : null}

          {ec.can.manage ? (
            <Section
              title="Exit interview"
              description="Confidential to HR."
              actions={ec.status !== "submitted" && ec.status !== "under_review" && ec.status !== "rejected" && ec.status !== "withdrawn" ? <InterviewDialog exitCaseId={ec.id} value={ec.interview} /> : null}
            >
              {ec.interview ? (
                <div className="space-y-4 p-5">
                  <Facts
                    items={[
                      ["Conducted", `${formatDate(ec.interview.conductedOn)}${ec.interview.conductedByName ? ` by ${ec.interview.conductedByName}` : ""}`],
                      ["Primary reason", reasonLabel(ec.interview.primaryReason)],
                      ["Would recommend", ec.interview.wouldRecommend ? "Yes" : "No"],
                      ["Regretted loss", ec.interview.regretted ? "Yes" : "No"],
                    ]}
                  />
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {INTERVIEW_RATING_KEYS.map((k) => (
                      <li key={k} className="rounded-lg border px-3 py-2">
                        <p className="text-xs text-muted-foreground">{INTERVIEW_RATING_LABELS[k]}</p>
                        <p className="text-lg font-semibold tabular">{ec.interview?.ratings?.[k] ?? "—"}<span className="text-xs font-normal text-muted-foreground">/5</span></p>
                      </li>
                    ))}
                  </ul>
                  {ec.interview.comments ? <p className="text-sm whitespace-pre-line text-muted-foreground">{ec.interview.comments}</p> : null}
                </div>
              ) : (
                <p className="px-5 py-6 text-sm text-muted-foreground">Not recorded yet.</p>
              )}
            </Section>
          ) : null}

          {ec.can.manage ? (
            <Section
              title="Letters"
              description={lettersVisibleNow ? "Visible to the employee." : "HR-only until the last working day."}
              actions={ec.status === "accepted" || ec.status === "in_progress" || ec.status === "completed" ? <GenerateLettersDialog exitCaseId={ec.id} hasLetters={ec.letters.length > 0} visibleNow={lettersVisibleNow} /> : null}
            >
              {ec.letters.length ? (
                <ul className="divide-y">
                  {ec.letters.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium">{l.title}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {formatDateTime(l.createdAt)} · {l.employeeVisible ? "visible to employee" : "HR only"}
                        </span>
                      </span>
                      <a className="shrink-0 font-medium text-brand hover:underline" href={`/api/documents/${l.id}/download`}>
                        Download
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-6 text-sm text-muted-foreground">No letters generated yet.</p>
              )}
            </Section>
          ) : null}
        </div>

        <div className="space-y-5">
          <Section title="Exit details">
            <div className="p-5">
              <Facts
                items={[
                  ["Employee code", e.code],
                  ["Joined", formatDate(e.joiningDate)],
                  ["Submitted", formatDate(ec.submittedOn)],
                  ["Requested last day", formatDate(ec.requestedLastWorkingDate)],
                  ["Approved last day", ec.approvedLastWorkingDate ? formatDate(ec.approvedLastWorkingDate) : "Pending approval"],
                  ["Notice period", `${ec.noticePeriodDays} days`],
                  ["Notice shortfall", ec.noticeShortfallDays ? `${ec.noticeShortfallDays} days · ${SHORTFALL_LABELS[ec.shortfallTreatment as "none"] ?? ec.shortfallTreatment}` : "None"],
                  ["Reason", reasonLabel(ec.reasonCategory)],
                  ...(ec.reasonDetail ? ([["Details", ec.reasonDetail]] as [string, string][]) : []),
                  ["Initiated by", ec.initiatedByName],
                  ...(ec.can.manage ? ([["Login", e.hasLogin ? (e.membershipStatus ?? "—") : "No login"]] as [string, string][]) : []),
                  ...(ec.status === "completed"
                    ? ([
                        ["Exited on", formatDate(e.exitDate)],
                        ["Rehire eligible", ec.eligibleForRehire === null ? "—" : ec.eligibleForRehire ? "Yes" : "No"],
                      ] as [string, string][])
                    : []),
                ]}
              />
            </div>
          </Section>
          {ec.approval ? (
            <Section title="Approval">
              <ol className="space-y-2 p-5 text-sm">
                {ec.approval.steps.map((s) => (
                  <li key={s.stepNo}>
                    <div className="flex items-center justify-between gap-2">
                      <span>{s.name}</span>
                      <StatusBadge status={s.status} />
                    </div>
                    {s.decidedAt ? (
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(s.decidedAt)}
                        {s.comment ? ` · ${s.comment}` : ""}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
              {ec.approval.status === "pending" ? (
                <p className="border-t px-5 py-3 text-xs text-muted-foreground">
                  Approvers decide in{" "}
                  <Link href="/inbox?tab=approvals" className="text-brand hover:underline">
                    Approvals &amp; tasks
                  </Link>
                  .
                </p>
              ) : null}
            </Section>
          ) : null}
        </div>
      </div>
    </Reveal>
  );
}
