import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ClipboardCheck, Flag, Scale, Settings2, Target, Users } from "lucide-react";
import { EmptyState, ErrorState, NoAccess, Page, PageHeader, Reveal, Section, TableSkeleton } from "@/components/page";
import { LinkTabs } from "@/components/documents/link-tabs";
import { StatusBadge } from "@/components/status-badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartCard, HorizontalBars } from "@/components/charts";
import { can, getTeamEmployeeIds, requireContext, scopeOf, type RequestContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { listGoals, alignableGoals, type GoalView } from "@/server/services/talent/performance/goals";
import { calibrationView, listCycles, openCycleOptions } from "@/server/services/talent/performance/cycles";
import { listMyReviews, listTeamReviews, myUpwardSummary } from "@/server/services/talent/performance/reviews";
import { listPips, listPromotions } from "@/server/services/talent/performance/development";
import { performanceSetup } from "@/server/services/talent/performance/setup";
import { employeeFormLookups } from "@/server/services/employees/lookups";
import { employeeOptions } from "@/server/services/talent/shared";
import { formatDate, formatMoney, titleCase } from "@/lib/format";
import { REVIEW_KIND_LABELS } from "@/lib/validation/talent";
import { CheckinDialog, GoalDialog, GoalHistoryButton } from "./_components/goal-dialogs";
import { CalibrateDialog, CompetencyDialog, CycleDialog, ScaleDialog, TemplateDialog } from "./_components/hr-dialogs";
import { PeerDialog, PipDialog, PipObjectiveList, PipUpdateDialog, PromotionDialog } from "./_components/team-dialogs";
import { RunButton } from "./_components/run-button";
import { decidePromotionAction, installPerformanceDefaultsAction } from "./actions";

export const metadata: Metadata = { title: "Performance" };

type Tab = "goals" | "reviews" | "team" | "cycles" | "calibration" | "settings";

export default function PerformancePage({ searchParams }: PageProps<"/performance">) {
  return (
    <Page>
      <PageHeader title="Performance" description="Goals and OKRs, reviews, calibration and development, in one place." />
      <Suspense fallback={<TableSkeleton rows={6} columns={5} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Body({ searchParams }: { searchParams: PageProps<"/performance">["searchParams"] }) {
  const ctx = await requireContext();
  const hr = can(ctx, "performance.manage", "all");
  if (!scopeOf(ctx, "performance.view") && !hr) return <NoAccess />;
  const sp = await searchParams;
  const teamScope = scopeOf(ctx, "performance.view");
  const hasTeam = (teamScope === "team" || teamScope === "all") && (await getTeamEmployeeIds(ctx)).length > 0;
  const tabs: { key: Tab; label: string }[] = [
    { key: "goals", label: "My goals" },
    { key: "reviews", label: "My reviews" },
    ...(hasTeam ? [{ key: "team" as const, label: "Team" }] : []),
    ...(hr
      ? [
          { key: "cycles" as const, label: "Cycles" },
          { key: "calibration" as const, label: "Calibration" },
          { key: "settings" as const, label: "Settings" },
        ]
      : []),
  ];
  const requested = (typeof sp.tab === "string" ? sp.tab : "goals") as Tab;
  const tab = tabs.some((t) => t.key === requested) ? requested : "goals";
  const cycleParam = typeof sp.cycle === "string" ? sp.cycle : undefined;
  return (
    <>
      <LinkTabs label="Performance sections" active={tab} tabs={tabs.map((t) => ({ ...t, href: `/performance?tab=${t.key}` }))} />
      <Reveal key={tab}>
        {tab === "goals" ? <GoalsTab ctx={ctx} /> : null}
        {tab === "reviews" ? <ReviewsTab ctx={ctx} /> : null}
        {tab === "team" ? <TeamTab ctx={ctx} /> : null}
        {tab === "cycles" ? <CyclesTab ctx={ctx} /> : null}
        {tab === "calibration" ? <CalibrationTab ctx={ctx} cycleId={cycleParam} /> : null}
        {tab === "settings" ? <SettingsTab ctx={ctx} /> : null}
      </Reveal>
    </>
  );
}

/** Tabs load through guard(): failures render an inline error or no-access state instead of failing the page. */
async function guard<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; node: React.ReactNode }> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof AppError && err.code === "FORBIDDEN") return { ok: false, node: <NoAccess /> };
    logger.error("performance.tab_failed", { err });
    return { ok: false, node: <ErrorState /> };
  }
}

/* ------------------------------------------------------------------ */
/* Goals                                                               */
/* ------------------------------------------------------------------ */

function GoalTable({ goals, cycles, parents, showOwner }: { goals: GoalView[]; cycles: { value: string; label: string }[]; parents: { value: string; label: string }[]; showOwner?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="min-w-56">Goal</TableHead>
            {showOwner ? <TableHead>Owner</TableHead> : null}
            <TableHead>Cycle</TableHead>
            <TableHead className="text-right">Weight</TableHead>
            <TableHead className="min-w-36">Progress</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-40" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {goals.map((g) => (
            <TableRow key={g.id}>
              <TableCell>
                <p className="font-medium">{g.title}</p>
                <p className="text-xs text-muted-foreground">
                  {g.kind === "okr" ? "OKR" : g.kind === "kpi" ? "KPI" : "Goal"}
                  {g.parentTitle ? ` · aligns to ${g.parentTitle}` : ""}
                  {!g.employeeId ? ` · ${g.departmentName ?? "Company"}` : ""}
                  {g.visibility !== "private" && g.employeeId ? ` · ${g.visibility}` : ""}
                </p>
              </TableCell>
              {showOwner ? <TableCell>{g.ownerName ?? g.departmentName ?? "Company"}</TableCell> : null}
              <TableCell className="text-muted-foreground">{g.cycleName ?? "—"}</TableCell>
              <TableCell className="text-right tabular">{g.employeeId ? `${g.weight}%` : "—"}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Progress value={g.progressPercent} className="h-1.5 w-24" aria-label={`${g.progressPercent}% complete`} />
                  <span className="text-xs tabular text-muted-foreground">{g.progressPercent}%</span>
                </div>
                {g.targetValue != null ? (
                  <p className="text-xs text-muted-foreground tabular">
                    {g.currentValue ?? g.startValue ?? 0} / {g.targetValue}
                    {g.metricUnit ?? ""}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(g.dueOn)}</TableCell>
              <TableCell>
                <StatusBadge status={g.status} tone={g.status === "achieved" ? "success" : g.status === "missed" ? "danger" : g.status === "partially_achieved" ? "warning" : undefined} />
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-0.5">
                  {g.canEdit ? <CheckinDialog goal={g} /> : null}
                  <GoalHistoryButton goalId={g.id} title={g.title} />
                  {g.canEdit ? (
                    <GoalDialog
                      mode={g.employeeId ? "self" : "company"}
                      cycles={cycles}
                      parents={parents}
                      values={{
                        id: g.id,
                        employeeId: g.employeeId,
                        departmentId: g.departmentId,
                        cycleId: g.cycleId,
                        parentGoalId: g.parentGoalId,
                        kind: g.kind as "goal",
                        title: g.title,
                        description: g.description,
                        metricUnit: g.metricUnit,
                        startValue: g.startValue,
                        targetValue: g.targetValue,
                        weight: g.weight,
                        dueOn: g.dueOn,
                        visibility: g.visibility as "private",
                      }}
                    />
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function weightSummary(goals: GoalView[]) {
  const byCycle = new Map<string, { name: string; total: number }>();
  for (const g of goals) {
    if (!g.employeeId) continue;
    const key = g.cycleId ?? "none";
    const entry = byCycle.get(key) ?? { name: g.cycleName ?? "No cycle", total: 0 };
    entry.total += g.weight;
    byCycle.set(key, entry);
  }
  return [...byCycle.values()];
}

async function GoalsTab({ ctx }: { ctx: RequestContext }) {
  const hr = can(ctx, "performance.manage", "all");
  const res = await guard(async () => {
    const [mine, shared, cycles, parents, lookups] = await Promise.all([
      listGoals(ctx, "mine"),
      listGoals(ctx, "company"),
      openCycleOptions(ctx),
      alignableGoals(ctx),
      hr ? employeeFormLookups(ctx) : Promise.resolve(null),
    ]);
    return { mine, shared, cycles, parents, lookups };
  });
  if (!res.ok) return res.node;
  const { mine, shared, cycles, parents, lookups } = res.data;
  const weights = weightSummary(mine);
  return (
    <div className="space-y-6">
      <Section
        title="My goals"
        description={weights.length ? weights.map((w) => `${w.name}: ${w.total}% weighted`).join(" · ") : "Set goals for the current cycle and check in as you go."}
        actions={
          <>
            {hr ? <GoalDialog mode="company" cycles={cycles} parents={parents} departments={lookups?.departments ?? []} /> : null}
            {ctx.employeeId ? <GoalDialog mode="self" employeeId={ctx.employeeId} cycles={cycles} parents={parents} /> : null}
          </>
        }
      >
        {!ctx.employeeId ? (
          <EmptyState icon={Target} title="No employee record" description="Your account is not linked to an employee, so you have no personal goals." className="m-4" />
        ) : mine.length ? (
          <GoalTable goals={mine} cycles={cycles} parents={parents} />
        ) : (
          <EmptyState icon={Target} title="No goals yet" description="Add your first goal, or align one to a company goal." className="m-4" />
        )}
      </Section>
      <Section title="Company and shared goals" description="Company and department goals, plus colleagues' goals shared with you.">
        {shared.length ? <GoalTable goals={shared} cycles={cycles} parents={parents} showOwner /> : <EmptyState icon={Flag} title="Nothing shared yet" className="m-4" />}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* My reviews                                                          */
/* ------------------------------------------------------------------ */

async function ReviewsTab({ ctx }: { ctx: RequestContext }) {
  const res = await guard(async () => {
    const [reviews, upward, pips] = await Promise.all([listMyReviews(ctx), myUpwardSummary(ctx), listPips(ctx)]);
    return { reviews, upward, pips: pips.filter((p) => p.employeeId === ctx.employeeId) };
  });
  if (!res.ok) return res.node;
  const { reviews, upward, pips } = res.data;
  const open = reviews.toWrite.filter((r) => r.status === "not_started" || r.status === "in_progress");
  const written = reviews.toWrite.filter((r) => !(r.status === "not_started" || r.status === "in_progress"));
  return (
    <div className="space-y-6">
      <Section title="To complete" description="Self reviews, manager reviews, peer feedback and upward feedback assigned to you.">
        {open.length ? (
          <ReviewTable rows={open} mode="write" />
        ) : (
          <EmptyState icon={ClipboardCheck} title="Nothing to complete" description="You'll be notified when a review cycle opens." className="m-4" />
        )}
      </Section>
      <Section title="About me" description="Your manager's reviews appear here once HR shares them.">
        {reviews.aboutMe.length ? <ReviewTable rows={reviews.aboutMe} mode="read" /> : <EmptyState icon={ClipboardCheck} title="No shared reviews yet" className="m-4" />}
      </Section>
      {written.length ? (
        <Section title="Submitted">
          <ReviewTable rows={written} mode="read" />
        </Section>
      ) : null}
      {upward.length ? (
        <Section title="Upward feedback about me" description="Averages from your reports, shown only for closed cycles with at least 3 responses. Individual answers are never shown.">
          <ul className="divide-y">
            {upward.map((u) => (
              <li key={u.cycleId} className="px-5 py-3 text-sm">
                <p className="font-medium">{u.cycleName}</p>
                {u.suppressed ? (
                  <p className="text-muted-foreground">Not enough responses to show results.</p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {u.questions.map((q) => (
                      <li key={q.id} className="flex justify-between gap-3">
                        <span className="text-muted-foreground">{q.label}</span>
                        <span className="tabular font-medium">{q.average.toFixed(2)}</span>
                      </li>
                    ))}
                    <li className="text-xs text-muted-foreground">{u.responses} responses</li>
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {pips.length ? (
        <Section title="My improvement plan">
          <ul className="divide-y">
            {pips.map((p) => (
              <li key={p.id} className="space-y-2 px-5 py-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    {formatDate(p.startsOn)} to {formatDate(p.endsOn)} · with {p.managerName}
                  </span>
                  <StatusBadge status={p.status} />
                </div>
                <PipObjectiveList objectives={p.objectives} />
                {p.outcome ? <p className="text-sm text-muted-foreground">Outcome: {p.outcome}</p> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

function ReviewTable({ rows, mode }: { rows: Awaited<ReturnType<typeof listMyReviews>>["toWrite"]; mode: "write" | "read" }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Review</TableHead>
            <TableHead>About</TableHead>
            <TableHead>Cycle</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{REVIEW_KIND_LABELS[r.kind]}</TableCell>
              <TableCell>{r.kind === "self" ? "Me" : r.employeeName}</TableCell>
              <TableCell className="text-muted-foreground">{r.cycleName}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(r.dueOn)}</TableCell>
              <TableCell>
                <StatusBadge status={r.status} />
              </TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant={mode === "write" ? "default" : "outline"} asChild>
                  <Link href={`/performance/reviews/${r.id}`}>{mode === "write" ? (r.status === "in_progress" ? "Continue" : "Start") : "Open"}</Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Team                                                                */
/* ------------------------------------------------------------------ */

async function TeamTab({ ctx }: { ctx: RequestContext }) {
  const res = await guard(async () => {
    const teamIds = await getTeamEmployeeIds(ctx);
    const [rows, goals, cycles, parents, team, colleagues, lookups, pips, promotions] = await Promise.all([
      listTeamReviews(ctx),
      listGoals(ctx, "team"),
      openCycleOptions(ctx),
      alignableGoals(ctx),
      ctx.db((tx) => employeeOptions(tx, { ids: teamIds })),
      ctx.db((tx) => employeeOptions(tx)),
      employeeFormLookups(ctx),
      listPips(ctx),
      listPromotions(ctx),
    ]);
    return { rows, goals, cycles, parents, team, colleagues, lookups, pips: pips.filter((p) => p.employeeId !== ctx.employeeId), promotions };
  });
  if (!res.ok) return res.node;
  const { rows, goals, cycles, parents, team, colleagues, lookups, pips, promotions } = res.data;
  const canReview = !!scopeOf(ctx, "performance.review");
  return (
    <div className="space-y-6">
      <Section title="Team reviews" description="Your reports' self and manager reviews. You see a self review once it is submitted.">
        {rows.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Employee</TableHead>
                  <TableHead>Cycle</TableHead>
                  <TableHead>Self review</TableHead>
                  <TableHead>Manager review</TableHead>
                  <TableHead className="text-right">Rating</TableHead>
                  <TableHead className="w-72" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.cycleId}:${r.employeeId}`}>
                    <TableCell className="font-medium">{r.employeeName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.cycleName} <StatusBadge status={r.cycleStatus} className="ml-1" />
                    </TableCell>
                    <TableCell>{r.selfStatus ? <StatusBadge status={r.selfStatus} /> : "—"}</TableCell>
                    <TableCell>{r.managerStatus ? <StatusBadge status={r.managerStatus} /> : <span className="text-xs text-muted-foreground">No manager review</span>}</TableCell>
                    <TableCell className="text-right tabular">{r.finalRating != null ? r.finalRating.toFixed(2) : "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-0.5">
                        {r.includePeers && r.cycleStatus === "active" && canReview ? <PeerDialog cycleId={r.cycleId} employeeId={r.employeeId} employeeName={r.employeeName} colleagues={colleagues} /> : null}
                        {canReview ? <PromotionDialog employeeId={r.employeeId} employeeName={r.employeeName} cycleId={r.cycleId} designations={lookups.designations} grades={lookups.grades} /> : null}
                        {canReview ? <PipDialog employeeId={r.employeeId} employeeName={r.employeeName} /> : null}
                        {r.managerReviewId ? (
                          <Button size="sm" variant={r.iAmReviewer && (r.managerStatus === "not_started" || r.managerStatus === "in_progress") ? "default" : "outline"} asChild>
                            <Link href={`/performance/reviews/${r.managerReviewId}`}>{r.iAmReviewer && (r.managerStatus === "not_started" || r.managerStatus === "in_progress") ? "Write review" : "Open"}</Link>
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState icon={Users} title="No team reviews yet" description="Reviews appear here when HR launches a cycle that includes your reports." className="m-4" />
        )}
      </Section>
      <Section title="Team goals" actions={canReview ? <GoalDialog mode="report" cycles={cycles} parents={parents} employees={team} /> : null}>
        {goals.length ? <GoalTable goals={goals} cycles={cycles} parents={parents} showOwner /> : <EmptyState icon={Target} title="No team goals yet" className="m-4" />}
      </Section>
      {pips.length ? (
        <Section title="Improvement plans" description="Visible to you, the employee and HR.">
          <ul className="divide-y">
            {pips.map((p) => (
              <li key={p.id} className="space-y-2 px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">
                    {p.employeeName} <span className="font-normal text-muted-foreground">· {formatDate(p.startsOn)} to {formatDate(p.endsOn)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={p.status} />
                    {p.canEdit ? <PipUpdateDialog plan={p} /> : null}
                  </span>
                </div>
                <PipObjectiveList objectives={p.objectives} />
                {p.outcome ? <p className="text-sm text-muted-foreground">Outcome: {p.outcome}</p> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {promotions.length ? (
        <Section title="Promotion recommendations">
          <PromotionTable rows={promotions} />
        </Section>
      ) : null}
    </div>
  );
}

function PromotionTable({ rows, decide }: { rows: Awaited<ReturnType<typeof listPromotions>>; decide?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Employee</TableHead>
            <TableHead>To</TableHead>
            <TableHead className="min-w-64">Justification</TableHead>
            <TableHead className="text-right">Proposed CTC</TableHead>
            <TableHead>Status</TableHead>
            {decide ? <TableHead className="w-56" /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.employeeName}</TableCell>
              <TableCell className="text-muted-foreground">{[p.toDesignation, p.toGrade].filter(Boolean).join(" · ") || "—"}</TableCell>
              <TableCell className="max-w-96 whitespace-normal text-sm">{p.justification}</TableCell>
              <TableCell className="text-right tabular">{p.proposedAnnualCtc != null ? formatMoney(p.proposedAnnualCtc) : p.hasProposedCtc ? "Restricted" : "—"}</TableCell>
              <TableCell>
                <StatusBadge status={p.status} tone={p.status === "approved" ? "success" : p.status === "rejected" ? "danger" : p.status === "deferred" ? "warning" : "info"} />
              </TableCell>
              {decide ? (
                <TableCell>
                  {p.status === "proposed" || p.status === "deferred" ? (
                    <div className="flex justify-end gap-1">
                      <RunButton action={decidePromotionAction} input={{ id: p.id, decision: "approved" as const }} success="Recommendation approved">
                        Approve
                      </RunButton>
                      {p.status === "proposed" ? (
                        <RunButton action={decidePromotionAction} input={{ id: p.id, decision: "deferred" as const }} success="Deferred" variant="ghost">
                          Defer
                        </RunButton>
                      ) : null}
                      <RunButton action={decidePromotionAction} input={{ id: p.id, decision: "rejected" as const }} success="Recommendation declined" variant="ghost">
                        Decline
                      </RunButton>
                    </div>
                  ) : null}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* HR: cycles, calibration, settings                                   */
/* ------------------------------------------------------------------ */

async function CyclesTab({ ctx }: { ctx: RequestContext }) {
  const res = await guard(async () => {
    const [cycles, setup, lookups] = await Promise.all([listCycles(ctx), performanceSetup(ctx), employeeFormLookups(ctx)]);
    return { cycles, setup, lookups };
  });
  if (!res.ok) return res.node;
  const { cycles, setup, lookups } = res.data;
  const templates = setup.templates.map((t) => ({ value: t.id, label: t.name }));
  const scales = setup.scales.map((s) => ({ value: s.id, label: s.name }));
  return (
    <Section
      title="Review cycles"
      description="Draft → launch → calibration → share → close."
      actions={templates.length ? <CycleDialog templates={templates} scales={scales} departments={lookups.departments} locations={lookups.locations} /> : null}
    >
      {!templates.length ? (
        <EmptyState
          icon={Settings2}
          title="Set up a review template first"
          description="Install the default 5-point scale and a standard template, then adjust them under Settings."
          action={
            <RunButton action={installPerformanceDefaultsAction} input={{}} success="Defaults installed" variant="default">
              Install defaults
            </RunButton>
          }
          className="m-4"
        />
      ) : cycles.length ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Cycle</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Template</TableHead>
                <TableHead className="min-w-40">Completion</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cycles.map((c) => {
                const pct = c.reviewsTotal ? Math.round((c.reviewsDone / c.reviewsTotal) * 100) : 0;
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/performance/cycles/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{titleCase(c.kind)}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(c.periodStart)} – {formatDate(c.periodEnd)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.templateName}</TableCell>
                    <TableCell>
                      {c.reviewsTotal ? (
                        <div className="flex items-center gap-2">
                          <Progress value={pct} className="h-1.5 w-24" aria-label={`${pct}% submitted`} />
                          <span className="text-xs tabular text-muted-foreground">
                            {c.reviewsDone}/{c.reviewsTotal}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not launched</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} tone={c.status === "calibration" ? "warning" : undefined} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState icon={ClipboardCheck} title="No review cycles yet" description="Create a draft cycle, check who is eligible, then launch it." className="m-4" />
      )}
    </Section>
  );
}

async function CalibrationTab({ ctx, cycleId }: { ctx: RequestContext; cycleId?: string }) {
  const res = await guard(async () => {
    const cycles = (await listCycles(ctx)).filter((c) => c.status === "calibration" || c.status === "closed" || c.status === "active");
    const selected = cycles.find((c) => c.id === cycleId) ?? cycles.find((c) => c.status === "calibration") ?? cycles[0];
    const [view, promotions] = selected ? await Promise.all([calibrationView(ctx, selected.id), listPromotions(ctx, { cycleId: selected.id })]) : [null, []];
    return { cycles, selected, view, promotions };
  });
  if (!res.ok) return res.node;
  const { cycles, selected, view, promotions } = res.data;
  if (!selected || !view) return <EmptyState icon={Scale} title="Nothing to calibrate" description="Calibration opens after a cycle is launched and manager reviews come in." />;
  const canCalibrate = view.cycle.status === "calibration";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Cycle:</span>
        {cycles.map((c) => (
          <Button key={c.id} size="sm" variant={c.id === selected.id ? "default" : "outline"} asChild>
            <Link href={`/performance?tab=calibration&cycle=${c.id}`}>
              {c.name} <span className="text-xs opacity-75">· {c.status}</span>
            </Link>
          </Button>
        ))}
        <Button size="sm" variant="ghost" asChild>
          <Link href={`/performance/cycles/${selected.id}`}>Cycle controls →</Link>
        </Button>
      </div>
      {!canCalibrate ? (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {view.cycle.status === "active" ? "Start calibration from the cycle page to adjust ratings." : "This cycle is closed; ratings are locked."}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Rating distribution" description="Final manager ratings (calibrated where adjusted)." columns={[{ key: "label", label: "Rating" }, { key: "count", label: "Employees" }]} rows={view.distribution.map((d) => ({ label: `${d.value} · ${d.label}`, count: d.count }))}>
          <HorizontalBars data={view.distribution.map((d) => ({ label: `${d.value} · ${d.label}`, count: d.count }))} categoryKey="label" valueKey="count" label="Employees" />
        </ChartCard>
        <Section title="By department">
          {view.byDepartment.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Department</TableHead>
                    {view.levels.map((l) => (
                      <TableHead key={l.value} className="text-right">
                        {l.value}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Avg</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.byDepartment.map((d) => (
                    <TableRow key={d.department}>
                      <TableCell>{d.department}</TableCell>
                      {view.levels.map((l) => (
                        <TableCell key={l.value} className="text-right tabular">
                          {d.levels[String(l.value)] || ""}
                        </TableCell>
                      ))}
                      <TableCell className="text-right tabular font-medium">{d.average?.toFixed(2) ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="px-5 py-4 text-sm text-muted-foreground">No submitted manager reviews yet.</p>
          )}
        </Section>
      </div>
      <Section title="Manager reviews">
        {view.rows.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Employee</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Manager</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Manager rating</TableHead>
                  <TableHead className="text-right">Calibrated</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.rows.map((r) => (
                  <TableRow key={r.reviewId}>
                    <TableCell>
                      <Link href={`/performance/reviews/${r.reviewId}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.department}</TableCell>
                    <TableCell className="text-muted-foreground">{r.managerName ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right tabular">{r.overallRating?.toFixed(2) ?? "—"}</TableCell>
                    <TableCell className="text-right tabular">
                      {r.calibratedRating != null ? <span title={r.calibrationNote ?? undefined}>{r.calibratedRating.toFixed(2)}</span> : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {canCalibrate && r.status === "submitted" ? <CalibrateDialog reviewId={r.reviewId} name={r.name} current={r.finalRating} levels={view.levels} /> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="px-5 py-4 text-sm text-muted-foreground">This cycle has no manager reviews.</p>
        )}
      </Section>
      <Section title="Promotion recommendations" description="Decisions are recorded here; change the employee's job in their record.">
        {promotions.length ? <PromotionTable rows={promotions} decide /> : <p className="px-5 py-4 text-sm text-muted-foreground">No recommendations for this cycle.</p>}
      </Section>
    </div>
  );
}

async function SettingsTab({ ctx }: { ctx: RequestContext }) {
  const res = await guard(() => performanceSetup(ctx));
  if (!res.ok) return res.node;
  const { scales, competencies, templates } = res.data;
  const competencyOptions = competencies.filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.name }));
  return (
    <div className="space-y-6">
      {!scales.length || !templates.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-brand-soft px-5 py-4 text-sm">
          <p>Start with the standard 5-point rating scale and review template. You can change both before launching a cycle.</p>
          <RunButton action={installPerformanceDefaultsAction} input={{}} success="Defaults installed" variant="default">
            Install defaults
          </RunButton>
        </div>
      ) : null}
      <Section title="Rating scales" actions={<ScaleDialog />}>
        {scales.length ? (
          <ul className="divide-y">
            {scales.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.levels.map((l) => `${l.value} ${l.label}`).join(" · ")}</p>
                </div>
                <ScaleDialog values={{ id: s.id, name: s.name, levels: s.levels }} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-4 text-sm text-muted-foreground">No rating scales yet.</p>
        )}
      </Section>
      <Section title="Competencies" actions={<CompetencyDialog />}>
        {competencies.length ? (
          <ul className="divide-y">
            {competencies.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {c.name} {!c.isActive ? <StatusBadge status="inactive" className="ml-1" /> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">{[c.category, c.description].filter(Boolean).join(" · ")}</p>
                </div>
                <CompetencyDialog values={c} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-4 text-sm text-muted-foreground">No competencies yet. Add the behaviours you want to assess.</p>
        )}
      </Section>
      <Section title="Review templates" actions={<TemplateDialog competencies={competencyOptions} />}>
        {templates.length ? (
          <ul className="divide-y">
            {templates.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.questions.length} questions · {t.includeGoals ? `goals weighted ${t.goalsWeightPercent}%` : "goals not scored"}
                  </p>
                </div>
                <TemplateDialog competencies={competencyOptions} values={{ id: t.id, name: t.name, questions: t.questions, includeGoals: t.includeGoals, goalsWeightPercent: t.goalsWeightPercent }} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-4 text-sm text-muted-foreground">No templates yet.</p>
        )}
      </Section>
    </div>
  );
}
