import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { cn } from "cn";
import { ClipboardCheck, DoorOpen, FileStack, ListChecks, Sparkles } from "lucide-react";
import { EmptyState, NoAccess, Page, PageHeader, Reveal, Section, StatGridSkeleton, TableSkeleton } from "@/components/page";
import { PersonCell } from "@/components/person";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, requireContext, scopeOf, type RequestContext } from "@/server/auth/context";
import { buddyOptions, listPlans, myOnboarding, onboardingCandidates } from "@/server/services/lifecycle/plans";
import { exitCandidates, listExitCases, myExit } from "@/server/services/lifecycle/exits";
import { listTemplates, templateOptions } from "@/server/services/lifecycle/templates";
import { exitInsights, onboardingInsights } from "@/server/services/lifecycle/analytics";
import { employeeFormLookups } from "@/server/services/employees/lookups";
import { shiftDate } from "@/server/services/lifecycle/shared";
import { formatDate, formatNumber, formatPercent, todayIn } from "@/lib/format";
import { EXIT_REASON_LABELS, EXIT_TYPE_LABELS, type ExitReasonCategory, type ExitType } from "@/lib/validation/lifecycle";
import { ExitStatusBadge, Facts, PlanStatusBadge, ProgressMeter, SettlementBadge } from "./_components/ui";
import { InstallStandardTemplatesButton, StartPlanDialog } from "./_components/plan-controls";
import { TemplateDialog } from "./_components/template-controls";
import { InitiateExitDialog, ResignationForm, WithdrawResignationButton } from "./_components/exit-controls";
import { TaskBoard } from "./_components/task-board";

export const metadata: Metadata = { title: "Onboarding & exits" };

type Tab = "onboarding" | "exits" | "me" | "my-exit" | "templates" | "insights";

function tabsFor(ctx: RequestContext): { key: Tab; label: string }[] {
  const onboardingScope = can(ctx, "onboarding.manage", "all") ? "all" : scopeOf(ctx, "onboarding.view");
  const exitScope = can(ctx, "exits.manage", "all") || can(ctx, "payroll.run", "all") || can(ctx, "payroll.approve", "all") ? "all" : scopeOf(ctx, "exits.view");
  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: "onboarding", label: "Onboarding", show: onboardingScope === "all" || onboardingScope === "team" },
    { key: "exits", label: "Exits", show: exitScope === "all" || exitScope === "team" },
    { key: "me", label: "My onboarding", show: !!ctx.employeeId && !!scopeOf(ctx, "onboarding.view") },
    { key: "my-exit", label: "My exit", show: !!ctx.employeeId && !!scopeOf(ctx, "exits.view") },
    { key: "templates", label: "Templates", show: can(ctx, "onboarding.manage", "all") },
    { key: "insights", label: "Insights", show: can(ctx, "onboarding.manage", "all") || can(ctx, "exits.manage", "all") },
  ];
  return tabs.filter((t) => t.show).map(({ key, label }) => ({ key, label }));
}

export default function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  return (
    <Page>
      <PageHeader title="Onboarding & exits" description="New-joiner checklists, pre-boarding, resignations, offboarding and full-and-final inputs in one place." />
      <Suspense fallback={<TableSkeleton rows={6} columns={5} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Body({ searchParams }: { searchParams: PageProps<"/onboarding">["searchParams"] }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const tabs = tabsFor(ctx);
  if (!tabs.length) return <NoAccess />;
  const requested = typeof sp.tab === "string" ? (sp.tab as Tab) : null;
  const tab = tabs.find((t) => t.key === requested)?.key ?? tabs[0].key;
  const status = typeof sp.status === "string" ? sp.status : undefined;
  return (
    <>
      <nav aria-label="Onboarding sections" className="mb-5 overflow-x-auto border-b">
        <ul className="flex gap-1">
          {tabs.map((t) => (
            <li key={t.key}>
              <Link
                href={`?tab=${t.key}`}
                scroll={false}
                aria-current={t.key === tab ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-10 items-center px-3 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground",
                  t.key === tab && "font-medium text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground",
                )}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Reveal key={`${tab}-${status ?? ""}`}>
        <Suspense fallback={tab === "insights" ? <StatGridSkeleton /> : <TableSkeleton rows={6} columns={5} />}>
          {tab === "onboarding" ? (
            <OnboardingTab status={status} />
          ) : tab === "exits" ? (
            <ExitsTab status={status} />
          ) : tab === "me" ? (
            <MyOnboardingTab />
          ) : tab === "my-exit" ? (
            <MyExitTab />
          ) : tab === "templates" ? (
            <TemplatesTab />
          ) : (
            <InsightsTab />
          )}
        </Suspense>
      </Reveal>
    </>
  );
}

function StatusFilter({ tab, current, options }: { tab: Tab; current: string; options: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
      {options.map(([key, label]) => (
        <Link
          key={key}
          href={`?tab=${tab}&status=${key}`}
          scroll={false}
          aria-current={current === key ? "true" : undefined}
          className={cn(
            "inline-flex h-7 items-center rounded-full border px-3 text-xs",
            current === key ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Onboarding                                                          */
/* ------------------------------------------------------------------ */

async function OnboardingTab({ status }: { status?: string }) {
  const ctx = await requireContext();
  const filter = status === "completed" || status === "all" ? status : "open";
  const manage = can(ctx, "onboarding.manage", "all");
  const [plans, candidates, templates, buddies] = await Promise.all([
    listPlans(ctx, { kind: "onboarding", status: filter }),
    manage ? onboardingCandidates(ctx) : [],
    manage ? templateOptions(ctx, "onboarding") : [],
    manage ? buddyOptions(ctx) : [],
  ]);
  const today = todayIn();
  const weekAhead = shiftDate(today, 7);
  const overdue = plans.reduce((s, p) => s + p.overdueCount, 0);
  const startingSoon = plans.filter((p) => p.anchorDate >= today && p.anchorDate <= weekAhead).length;

  const actions = manage ? (
    templates.length ? (
      <StartPlanDialog candidates={candidates} templates={templates.map((t) => ({ value: t.id, label: t.name }))} buddies={buddies} />
    ) : (
      <InstallStandardTemplatesButton />
    )
  ) : null;

  return (
    <div className="space-y-5">
      {filter === "open" ? (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
          <Stat label="Active plans" value={plans.length} />
          <Stat label="Joining in 7 days" value={startingSoon} />
          <Stat label="Overdue tasks" value={overdue} tone={overdue ? "danger" : undefined} />
          <Stat label="Average progress" value={plans.length ? `${Math.round(plans.reduce((s, p) => s + p.progressPercent, 0) / plans.length)}%` : "—"} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusFilter tab="onboarding" current={filter} options={[["open", "Active"], ["completed", "Completed"], ["all", "All"]]} />
        {actions}
      </div>
      {!plans.length ? (
        <EmptyState
          icon={ClipboardCheck}
          title={filter === "open" ? "No active onboarding plans" : "No plans here"}
          description={
            manage
              ? templates.length
                ? "Plans start automatically when an offer is accepted, or start one for a pre-joining employee."
                : "Add the standard onboarding and offboarding templates to get started, then adjust them to your process."
              : "Onboarding plans for your team appear here."
          }
          action={actions}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Joiner</TableHead>
                <TableHead>Joining date</TableHead>
                <TableHead className="hidden md:table-cell">Template</TableHead>
                <TableHead className="w-48">Progress</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="min-w-56">
                    <PersonCell id={p.employee.id} name={p.employee.name} subtitle={[p.employee.designation, p.employee.department].filter(Boolean).join(" · ") || p.employee.code} href={`/onboarding/plans/${p.id}`} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular">
                    {formatDate(p.anchorDate)}
                    {p.employee.status === "pending" ? <StatusBadge status="pending" label="Pre-joining" className="ml-2" /> : null}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{p.templateName ?? "—"}</TableCell>
                  <TableCell>
                    <ProgressMeter value={p.progressPercent} label={`${p.employee.name} onboarding progress`} />
                  </TableCell>
                  <TableCell className="text-right tabular">{p.openCount}</TableCell>
                  <TableCell className={cn("text-right tabular", p.overdueCount && "font-medium text-danger")}>{p.overdueCount}</TableCell>
                  <TableCell>
                    <PlanStatusBadge status={p.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "danger" }) {
  return (
    <div className="bg-card p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1.5 text-2xl font-semibold tracking-tight tabular", tone === "danger" && "text-danger")}>{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Exits                                                               */
/* ------------------------------------------------------------------ */

async function ExitsTab({ status }: { status?: string }) {
  const ctx = await requireContext();
  const filter = status === "completed" || status === "all" ? status : "open";
  const manage = can(ctx, "exits.manage", "all");
  const [cases, candidates] = await Promise.all([listExitCases(ctx, { status: filter }), manage ? exitCandidates(ctx) : []]);
  const action = manage ? <InitiateExitDialog candidates={candidates} /> : null;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusFilter tab="exits" current={filter} options={[["open", "Open"], ["completed", "Completed"], ["all", "All"]]} />
        {action}
      </div>
      {!cases.length ? (
        <EmptyState
          icon={DoorOpen}
          title={filter === "open" ? "No open exits" : "No exits here"}
          description="Resignations submitted by employees and exits started by HR appear here with their checklist and settlement status."
          action={action}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Employee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last working day</TableHead>
                <TableHead className="w-40">Checklist</TableHead>
                <TableHead>Settlement</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="min-w-56">
                    <PersonCell id={c.employee.id} name={c.employee.name} subtitle={[c.employee.code, c.employee.department].filter(Boolean).join(" · ")} href={`/onboarding/exits/${c.id}`} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{EXIT_TYPE_LABELS[c.type as ExitType] ?? c.type}</TableCell>
                  <TableCell>
                    <ExitStatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className={cn("whitespace-nowrap tabular", c.lastWorkingDate && c.lastWorkingDate < todayIn() && c.status !== "completed" && "text-danger")}>
                    {formatDate(c.lastWorkingDate)}
                  </TableCell>
                  <TableCell>
                    {c.progressPercent === null ? <span className="text-xs text-muted-foreground">Starts on acceptance</span> : <ProgressMeter value={c.progressPercent} label={`${c.employee.name} exit checklist`} />}
                  </TableCell>
                  <TableCell>
                    <SettlementBadge status={c.settlementStatus} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Self-service                                                        */
/* ------------------------------------------------------------------ */

async function MyOnboardingTab() {
  const ctx = await requireContext();
  const plan = await myOnboarding(ctx);
  if (!plan) {
    return <EmptyState icon={ListChecks} title="No onboarding plan" description="When HR starts your onboarding, your pre-joining tasks, documents and policies will appear here." />;
  }
  const mine = plan.tasks.filter((t) => t.ownerGroup === "employee");
  const others = plan.tasks.filter((t) => t.ownerGroup !== "employee" && t.ownerGroup !== "buddy");
  const left = mine.filter((t) => t.status === "open" || t.status === "in_progress" || t.status === "blocked").length;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Section
        title="Your tasks"
        description={left ? `${left} of ${mine.length} still to do. Upload documents and acknowledge policies right here.` : "You're all set. Thank you!"}
      >
        {mine.length ? (
          <TaskBoard employeeId={plan.employee.id} tasks={mine} pendingPolicies={plan.pendingPolicies} canManage={false} isSubject grouped={false} />
        ) : (
          <p className="px-5 py-6 text-sm text-muted-foreground">Nothing for you to do right now.</p>
        )}
      </Section>
      <div className="space-y-5">
        <Section title="Your onboarding">
          <div className="space-y-4 p-5">
            <ProgressMeter value={plan.progressPercent} label="Overall onboarding progress" />
            <Facts
              items={[
                ["Joining date", formatDate(plan.employee.joiningDate)],
                ["Manager", plan.employee.managerName],
                ["Buddy", plan.buddy?.name ?? "Not assigned yet"],
                ["Role", plan.employee.designation],
              ]}
            />
          </div>
        </Section>
        {others.length ? (
          <Section title="Being prepared for you">
            <ul className="divide-y">
              {others.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <span className={cn("min-w-0 truncate", t.status === "done" && "text-muted-foreground")}>{t.title}</span>
                  <StatusBadge status={t.status} label={t.status === "done" ? "Done" : t.dueOn ? formatDate(t.dueOn, "dd MMM") : "Planned"} tone={t.status === "done" ? "success" : "neutral"} />
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </div>
  );
}

async function MyExitTab() {
  const ctx = await requireContext();
  const data = await myExit(ctx);
  if (!data) return <NoAccess />;
  const ec = data.current;
  if (!ec) {
    if (!data.canResign) {
      return (
        <EmptyState
          icon={DoorOpen}
          title="Nothing to show"
          description={data.employeeStatus === "pending" ? "You can resign after you have joined." : "There is no exit in progress for you."}
        />
      );
    }
    return (
      <Section title="Submit your resignation" description="Your manager reviews it first, then HR. You can withdraw it until it is accepted.">
        <div className="p-5">
          <ResignationForm noticePeriodDays={data.noticePeriodDays} defaultLastWorkingDate={data.defaultLastWorkingDate} />
        </div>
      </Section>
    );
  }
  const outstandingAssets = ec.assets.filter((a) => !a.returnedOn);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        {ec.plan && ec.plan.tasks.length ? (
          <Section title="Your exit tasks" description="Handover and anything else you need to do before your last day.">
            <TaskBoard employeeId={ec.employee.id} tasks={ec.plan.tasks} pendingPolicies={[]} canManage={false} isSubject grouped={false} />
          </Section>
        ) : null}
        {outstandingAssets.length ? (
          <Section title="Company assets to return">
            <ul className="divide-y">
              {outstandingAssets.map((a) => (
                <li key={a.assignmentId} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <span>
                    {a.name} <span className="text-muted-foreground">· {a.tag}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">since {formatDate(a.assignedOn)}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
        {ec.letters.length ? (
          <Section title="Your letters">
            <ul className="divide-y">
              {ec.letters.map((l) => (
                <li key={l.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <span>{l.title}</span>
                  <a className="text-sm font-medium text-brand hover:underline" href={`/api/documents/${l.id}/download`}>
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
      <Section title={EXIT_TYPE_LABELS[ec.type as ExitType] ?? "Exit"} actions={ec.can.withdraw ? <WithdrawResignationButton exitCaseId={ec.id} /> : null}>
        <div className="space-y-4 p-5">
          <ExitStatusBadge status={ec.status} />
          <Facts
            items={[
              ["Submitted", formatDate(ec.submittedOn)],
              ["Requested last day", formatDate(ec.requestedLastWorkingDate)],
              ["Approved last day", ec.approvedLastWorkingDate ? formatDate(ec.approvedLastWorkingDate) : "Awaiting approval"],
              ["Notice period", `${ec.noticePeriodDays} days`],
              ["Reason", ec.reasonCategory ? (EXIT_REASON_LABELS[ec.reasonCategory as ExitReasonCategory] ?? ec.reasonCategory) : null],
            ]}
          />
          {ec.approval ? (
            <ol className="space-y-1.5 border-t pt-3 text-sm">
              {ec.approval.steps.map((s) => (
                <li key={s.stepNo} className="flex items-center justify-between gap-2">
                  <span>{s.name}</span>
                  <StatusBadge status={s.status} />
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

async function TemplatesTab() {
  const ctx = await requireContext();
  const [templates, lookups] = await Promise.all([listTemplates(ctx), employeeFormLookups(ctx)]);
  const cond = { departments: lookups.departments, locations: lookups.locations, legalEntities: lookups.legalEntities };
  const header = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <InstallStandardTemplatesButton variant="outline" />
      <TemplateDialog lookups={cond} />
    </div>
  );
  if (!templates.length) {
    return (
      <EmptyState
        icon={FileStack}
        title="No checklist templates yet"
        description="Start from the standard onboarding and offboarding checklists for Indian companies, then tailor tasks, owners and due dates."
        action={<InstallStandardTemplatesButton />}
      />
    );
  }
  return (
    <div className="space-y-5">
      {header}
      {(["onboarding", "offboarding"] as const).map((kind) => {
        const items = templates.filter((t) => t.kind === kind);
        return (
          <Section key={kind} title={kind === "onboarding" ? "Onboarding templates" : "Offboarding templates"} description="The highest-priority active template whose conditions match is used.">
            {items.length ? (
              <ul className="divide-y">
                {items.map((t) => (
                  <li key={t.id} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <Link href={`/onboarding/templates/${t.id}`} className="font-medium hover:underline">
                        {t.name}
                      </Link>
                      {!t.isActive ? <StatusBadge status="inactive" tone="neutral" className="ml-2" /> : null}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t.conditions.length ? t.conditions.map((c) => `${c.label}: ${c.value}`).join(" · ") : "Applies to everyone"} · priority {t.priority}
                      </p>
                    </div>
                    <p className="shrink-0 text-xs text-muted-foreground tabular">
                      {t.taskCount} tasks · {t.planCount} plans
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-muted-foreground">No {kind} templates.</p>
            )}
          </Section>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Insights                                                            */
/* ------------------------------------------------------------------ */

async function InsightsTab() {
  const ctx = await requireContext();
  const [exits, onboarding] = await Promise.all([
    can(ctx, "exits.manage", "all") ? exitInsights(ctx) : null,
    can(ctx, "onboarding.manage", "all") ? onboardingInsights(ctx) : null,
  ]);
  return (
    <div className="space-y-6">
      {exits ? (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
            <Stat label="Exits (last 12 months)" value={exits.totalExits} />
            <Stat label="Voluntary / involuntary" value={`${exits.voluntary} / ${exits.involuntary}`} />
            <Stat label="Avg. notice served" value={exits.averageNoticeServedDays !== null ? `${exits.averageNoticeServedDays} d` : "—"} />
            <Stat label="Open exits" value={exits.openExits} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Exits by month" description="Completed exits by last working day.">
              <BarList rows={exits.byMonth.map((m) => ({ label: formatDate(`${m.month}-01`, "MMM yy"), value: m.count }))} empty="No completed exits in the last 12 months." />
            </Section>
            <Section title="Reasons" description="Primary reason from the exit interview, else the stated reason.">
              <BarList
                rows={exits.reasons.map((r) => ({ label: EXIT_REASON_LABELS[r.reason as ExitReasonCategory] ?? (r.reason === "unspecified" ? "Not specified" : r.reason), value: r.count }))}
                empty="No exits with reasons yet."
              />
            </Section>
            <Section title="Regretted vs non-regretted" description="From exit interviews (confidential to HR).">
              <BarList
                rows={[
                  { label: "Regretted", value: exits.regretted.regretted },
                  { label: "Non-regretted", value: exits.regretted.nonRegretted },
                  { label: "No interview yet", value: exits.regretted.unknown },
                ]}
                empty="No exits yet."
              />
            </Section>
            <Section title="Notice" description="Completed resignations.">
              <div className="p-5">
                <Facts
                  items={[
                    ["Average served", exits.averageNoticeServedDays !== null ? `${exits.averageNoticeServedDays} days` : "—"],
                    ["Average notice period", exits.averageNoticePeriodDays !== null ? `${exits.averageNoticePeriodDays} days` : "—"],
                  ]}
                />
              </div>
            </Section>
          </div>
        </>
      ) : null}
      {onboarding ? (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
            <Stat label="Active onboarding plans" value={onboarding.activePlans} />
            <Stat label="Completed plans" value={onboarding.completedPlans} />
            <Stat label="Avg. time to complete" value={onboarding.averageCompletionDays !== null ? `${formatNumber(onboarding.averageCompletionDays, 1)} d` : "—"} />
            <Stat label="Tasks done on time" value={formatPercent(onboarding.onTimeRate)} />
          </div>
          <Section title="Most overdue onboarding tasks" description={`${onboarding.overdueTasks} overdue tasks across active plans.`}>
            <BarList rows={onboarding.slowestTasks.map((t) => ({ label: t.title, value: t.overdue }))} empty="Nothing overdue. Nice." />
          </Section>
        </>
      ) : null}
      {!exits && !onboarding ? <EmptyState icon={Sparkles} title="No insights available" /> : null}
    </div>
  );
}

function BarList({ rows, empty }: { rows: { label: string; value: number }[]; empty: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (!max) return <p className="px-5 py-6 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2 p-5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,10rem)_1fr_2.5rem] items-center gap-3 text-sm">
          <span className="truncate text-muted-foreground" title={r.label}>
            {r.label}
          </span>
          <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span className="block h-full rounded-full bg-brand" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="text-right tabular">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}
