import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Award, Briefcase, CalendarClock, ClipboardList, HeartHandshake, MessagesSquare, ShieldCheck } from "lucide-react";
import { EmptyState, ErrorState, NoAccess, Page, PageHeader, Reveal, Section, TableSkeleton } from "@/components/page";
import { LinkTabs } from "@/components/documents/link-tabs";
import { StatusBadge } from "@/components/status-badge";
import { PersonAvatar } from "@/components/person";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartCard, HorizontalBars } from "@/components/charts";
import { can, requireContext, type RequestContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { listSurveys } from "@/server/services/talent/engagement/surveys";
import { engagementTrend } from "@/server/services/talent/engagement/results";
import { listRecognitions } from "@/server/services/talent/engagement/recognition";
import { listOneOnOnes, oneOnOnePartners } from "@/server/services/talent/engagement/one-on-ones";
import { getCareerPlan, internalOpenings, listActionPlans, listSuccessionPlans, positionOptions } from "@/server/services/talent/engagement/career";
import { peopleSuccessOverview } from "@/server/services/talent/engagement/overview";
import { employeeFormLookups } from "@/server/services/employees/lookups";
import { directReportIds, employeeOptions } from "@/server/services/talent/shared";
import { formatDate, formatPercent, titleCase, todayIn } from "@/lib/format";
import { READINESS_LABELS } from "@/lib/validation/talent";
import { RunButton } from "@/app/(app)/performance/_components/run-button";
import { SurveyDialog } from "./_components/survey-dialog";
import { ActionPlanDialog, CareerPlanDialog, ManagerNotesDialog, OneOnOneDialog, RecognitionDialog, SuccessionDialog } from "./_components/people-dialogs";
import { closeSurveyAction, launchSurveyAction } from "./actions";

export const metadata: Metadata = { title: "People success" };

type Tab = "overview" | "surveys" | "results" | "recognition" | "one-on-ones" | "career" | "succession";

export default function EngagementPage({ searchParams }: PageProps<"/engagement">) {
  return (
    <Page>
      <PageHeader title="People success" description="Surveys, recognition, 1:1s and careers. Built on explicit feedback, never on activity monitoring." />
      <Suspense fallback={<TableSkeleton rows={6} columns={4} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function guard<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; node: React.ReactNode }> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof AppError && err.code === "FORBIDDEN") return { ok: false, node: <NoAccess /> };
    logger.error("engagement.tab_failed", { err });
    return { ok: false, node: <ErrorState /> };
  }
}

async function Body({ searchParams }: { searchParams: PageProps<"/engagement">["searchParams"] }) {
  const ctx = await requireContext();
  if (!ctx.grants["engagement.view"] && !can(ctx, "engagement.manage", "all")) return <NoAccess />;
  const sp = await searchParams;
  const isManager = ctx.employeeId ? (await ctx.db((tx) => directReportIds(tx, ctx.employeeId!))).length > 0 : false;
  const tabs: { key: Tab; label: string }[] = [
    ...(isManager ? [{ key: "overview" as const, label: "Overview" }] : []),
    { key: "surveys", label: "Surveys" },
    ...(can(ctx, "engagement.results", "all") ? [{ key: "results" as const, label: "Results" }] : []),
    { key: "recognition", label: "Recognition" },
    { key: "one-on-ones", label: "1:1s" },
    { key: "career", label: "Career" },
    ...(can(ctx, "succession.manage", "all") ? [{ key: "succession" as const, label: "Succession" }] : []),
  ];
  const fallback: Tab = isManager ? "overview" : "surveys";
  const requested = (typeof sp.tab === "string" ? sp.tab : fallback) as Tab;
  const tab = tabs.some((t) => t.key === requested) ? requested : fallback;
  return (
    <>
      <LinkTabs label="People success sections" active={tab} tabs={tabs.map((t) => ({ ...t, href: `/engagement?tab=${t.key}` }))} />
      <Reveal key={tab}>
        {tab === "overview" ? <OverviewTab ctx={ctx} /> : null}
        {tab === "surveys" ? <SurveysTab ctx={ctx} /> : null}
        {tab === "results" ? <ResultsTab ctx={ctx} /> : null}
        {tab === "recognition" ? <RecognitionTab ctx={ctx} /> : null}
        {tab === "one-on-ones" ? <OneOnOnesTab ctx={ctx} /> : null}
        {tab === "career" ? <CareerTab ctx={ctx} /> : null}
        {tab === "succession" ? <SuccessionTab ctx={ctx} /> : null}
      </Reveal>
    </>
  );
}

/* ------------------------------------------------------------------ */

async function OverviewTab({ ctx }: { ctx: RequestContext }) {
  const res = await guard(() => peopleSuccessOverview(ctx));
  if (!res.ok) return res.node;
  const o = res.data;
  const trend = o.departmentTrend.points.filter((p) => !p.suppressed && p.average != null);
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="1:1s due" description="Direct reports without a 1:1 in the last 30 days." actions={<Button size="sm" variant="ghost" asChild><Link href="/engagement?tab=one-on-ones">1:1s</Link></Button>}>
          {o.overdueOneOnOnes.length ? (
            <ul className="divide-y">
              {o.overdueOneOnOnes.map((p) => (
                <li key={p.employeeId} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <span className="flex items-center gap-2">
                    <PersonAvatar id={p.employeeId} name={p.name} className="size-6" />
                    {p.name}
                  </span>
                  <span className="text-xs text-muted-foreground">{p.lastHeldOn ? `last ${formatDate(p.lastHeldOn)}` : "never"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-sm text-muted-foreground">Everyone had a 1:1 recently.</p>
          )}
        </Section>
        <Section title="Goal check-ins due" description="Active goals with no check-in for 30 days.">
          {o.overdueCheckins.length ? (
            <ul className="divide-y">
              {o.overdueCheckins.slice(0, 12).map((g) => (
                <li key={g.goalId} className="px-5 py-2.5 text-sm">
                  <p className="font-medium">{g.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {g.name} · {g.lastCheckinOn ? `last check-in ${formatDate(g.lastCheckinOn)}` : "no check-ins yet"}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-sm text-muted-foreground">All goals are up to date.</p>
          )}
        </Section>
        <Section title="Upcoming anniversaries" description="Next 30 days.">
          {o.anniversaries.length ? (
            <ul className="divide-y">
              {o.anniversaries.map((a) => (
                <li key={a.employeeId} className="flex justify-between gap-3 px-5 py-2.5 text-sm">
                  <span>{a.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(a.date, "dd MMM")} · {a.years} yr{a.years === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-sm text-muted-foreground">No anniversaries coming up.</p>
          )}
        </Section>
      </div>
      <ChartCard
        title={`Engagement trend${o.departmentTrend.departmentName ? `: ${o.departmentTrend.departmentName}` : ""}`}
        description="Average of 1–5 scale answers in your department. Surveys with fewer responses than their minimum group size are not shown."
        columns={[
          { key: "title", label: "Survey" },
          { key: "average", label: "Average" },
        ]}
        rows={trend.map((p) => ({ title: p.title, average: p.average ?? 0 }))}
      >
        <HorizontalBars data={trend.map((p) => ({ title: p.title, average: p.average ?? 0 }))} categoryKey="title" valueKey="average" label="Average score" />
      </ChartCard>
      {o.departmentTrend.points.some((p) => p.suppressed) ? (
        <p className="text-xs text-muted-foreground">{o.departmentTrend.points.filter((p) => p.suppressed).length} survey(s) hidden: not enough responses from your department.</p>
      ) : null}
    </div>
  );
}

async function SurveysTab({ ctx }: { ctx: RequestContext }) {
  const manage = can(ctx, "engagement.manage", "all");
  const res = await guard(async () => {
    const [surveys, lookups, plans] = await Promise.all([listSurveys(ctx), manage ? employeeFormLookups(ctx) : Promise.resolve(null), listActionPlans(ctx)]);
    return { surveys, lookups, plans };
  });
  if (!res.ok) return res.node;
  const { surveys, lookups, plans } = res.data;
  const invited = surveys.filter((s) => s.invited && s.status === "active");
  const today = todayIn();
  return (
    <div className="space-y-6">
      {ctx.employeeId ? (
        <Section title="For you" description="Anonymous surveys never record who answered what.">
          {invited.length ? (
            <ul className="divide-y">
              {invited.map((s) => (
                <li key={s.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{s.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {titleCase(s.kind)} · {s.questionCount} questions · {s.isAnonymous ? "anonymous" : "not anonymous"}
                      {s.closesOn ? ` · closes ${formatDate(s.closesOn)}` : ""}
                    </p>
                  </div>
                  {s.respondedOn ? (
                    <StatusBadge status="responded" tone="success" label={`Responded ${formatDate(s.respondedOn)}`} />
                  ) : s.opensOn && s.opensOn > today ? (
                    <span className="text-xs text-muted-foreground">Opens {formatDate(s.opensOn)}</span>
                  ) : (
                    <Button size="sm" asChild>
                      <Link href={`/engagement/surveys/${s.id}/respond`}>Respond</Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={MessagesSquare} title="No open surveys" description="You'll be notified when there is a survey for you." className="m-4" />
          )}
        </Section>
      ) : null}
      {manage && lookups ? (
        <Section title="All surveys" actions={<SurveyDialog departments={lookups.departments} locations={lookups.locations} />}>
          {surveys.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Survey</TableHead>
                    <TableHead>Window</TableHead>
                    <TableHead className="text-right">Response rate</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-48" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {surveys.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Link href={`/engagement/surveys/${s.id}`} className="font-medium hover:underline">
                          {s.title}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {titleCase(s.kind)} · {s.isAnonymous ? `anonymous, groups of ${s.minGroupSize}+` : "named"}
                        </p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {s.opensOn ? formatDate(s.opensOn) : "—"} – {s.closesOn ? formatDate(s.closesOn) : "open-ended"}
                      </TableCell>
                      <TableCell className="text-right tabular">{s.participants ? `${formatPercent((s.responded ?? 0) / s.participants)} (${s.responded}/${s.participants})` : "—"}</TableCell>
                      <TableCell>
                        <StatusBadge status={s.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {s.status === "draft" ? (
                            <RunButton
                              action={launchSurveyAction}
                              input={{ id: s.id }}
                              variant="default"
                              success="Survey launched; invitees notified"
                              confirm={{ title: `Launch "${s.title}"?`, description: "Everyone in the audience is invited and notified. Questions cannot be changed after launch.", confirmLabel: "Launch" }}
                            >
                              Launch
                            </RunButton>
                          ) : null}
                          {s.status === "active" ? (
                            <RunButton action={closeSurveyAction} input={{ id: s.id }} success="Survey closed" confirm={{ title: "Close this survey?", description: "No more responses will be accepted.", confirmLabel: "Close survey" }}>
                              Close
                            </RunButton>
                          ) : null}
                          <Button size="sm" variant="ghost" asChild>
                            <Link href={`/engagement/surveys/${s.id}`}>{s.status === "draft" ? "Details" : "Results"}</Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyState icon={MessagesSquare} title="No surveys yet" description="Start with a quick pulse: five questions, anonymous, results in groups of five or more." className="m-4" />
          )}
        </Section>
      ) : null}
      {!can(ctx, "engagement.results", "all") && plans.length ? (
        <Section title="My action plans">
          <ActionPlanList plans={plans} employees={[]} surveys={[]} departments={[]} />
        </Section>
      ) : null}
    </div>
  );
}

function ActionPlanList({ plans, employees, surveys, departments }: { plans: Awaited<ReturnType<typeof listActionPlans>>; employees: { value: string; label: string }[]; surveys: { value: string; label: string }[]; departments: { value: string; label: string }[] }) {
  return (
    <ul className="divide-y">
      {plans.map((p) => (
        <li key={p.id} className="flex items-start justify-between gap-3 px-5 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {p.focusArea} <StatusBadge status={p.status} className="ml-1" />
            </p>
            <p className="text-xs text-muted-foreground">
              Owner {p.ownerName}
              {p.surveyTitle ? ` · ${p.surveyTitle}` : ""}
              {p.departmentName ? ` · ${p.departmentName}` : ""} · {p.actions.filter((a) => a.done).length}/{p.actions.length} actions done
            </p>
          </div>
          {p.canEdit ? (
            <ActionPlanDialog
              employees={employees}
              surveys={surveys}
              departments={departments}
              canChangeScope={employees.length > 0}
              values={{ id: p.id, surveyId: p.surveyId, departmentId: p.departmentId, ownerEmployeeId: p.ownerEmployeeId, focusArea: p.focusArea, actions: p.actions, status: p.status as "open" }}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

async function ResultsTab({ ctx }: { ctx: RequestContext }) {
  const manage = can(ctx, "engagement.manage", "all");
  const res = await guard(async () => {
    const [surveys, trend, plans, lookups, people] = await Promise.all([listSurveys(ctx), engagementTrend(ctx), listActionPlans(ctx), employeeFormLookups(ctx), ctx.db((tx) => employeeOptions(tx))]);
    return { surveys: surveys.filter((s) => s.status !== "draft"), trend, plans, lookups, people };
  });
  if (!res.ok) return res.node;
  const { surveys, trend, plans, lookups, people } = res.data;
  const shown = trend.filter((t) => !t.suppressed && t.average != null);
  const surveyOptions = surveys.map((s) => ({ value: s.id, label: s.title }));
  return (
    <div className="space-y-6">
      <ChartCard
        title="Engagement over time"
        description="Average 1–5 score per survey. Surveys below their minimum group size are hidden."
        columns={[
          { key: "title", label: "Survey" },
          { key: "average", label: "Average" },
          { key: "enps", label: "eNPS" },
        ]}
        rows={shown.map((t) => ({ title: t.title, average: t.average ?? 0, enps: t.enps ?? "—" }))}
      >
        <HorizontalBars data={shown.map((t) => ({ title: t.title, average: t.average ?? 0 }))} categoryKey="title" valueKey="average" label="Average score" />
      </ChartCard>
      <Section title="Survey results">
        {surveys.length ? (
          <ul className="divide-y">
            {surveys.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div>
                  <Link href={`/engagement/surveys/${s.id}`} className="font-medium hover:underline">
                    {s.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {s.participants ? `${s.responded}/${s.participants} responded` : "No participants"} · {s.status}
                  </p>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/engagement/surveys/${s.id}`}>View results</Link>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={ClipboardList} title="No launched surveys" className="m-4" />
        )}
      </Section>
      <Section title="Action plans" actions={manage ? <ActionPlanDialog employees={people} surveys={surveyOptions} departments={lookups.departments} /> : null}>
        {plans.length ? (
          <ActionPlanList plans={plans} employees={manage ? people : []} surveys={surveyOptions} departments={lookups.departments} />
        ) : (
          <p className="px-5 py-4 text-sm text-muted-foreground">No action plans yet. Create one from a survey&apos;s results.</p>
        )}
      </Section>
    </div>
  );
}

async function RecognitionTab({ ctx }: { ctx: RequestContext }) {
  const res = await guard(async () => {
    const [items, colleagues] = await Promise.all([listRecognitions(ctx), ctx.db((tx) => employeeOptions(tx))]);
    return { items, colleagues: colleagues.filter((c) => c.value !== ctx.employeeId) };
  });
  if (!res.ok) return res.node;
  const { items, colleagues } = res.data;
  return (
    <Section title="Recognition wall" actions={ctx.employeeId ? <RecognitionDialog colleagues={colleagues} /> : null}>
      {items.length ? (
        <ul className="grid gap-px bg-border sm:grid-cols-2">
          {items.map((r) => (
            <li key={r.id} className="space-y-2 bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <PersonAvatar id={r.to.id} name={r.to.name} className="size-7" />
                  <span className="truncate">
                    <span className="font-medium">{r.to.name}</span> <span className="text-muted-foreground">from {r.from.name}</span>
                  </span>
                </span>
                <StatusBadge status="badge" label={r.badge} tone="brand" />
              </div>
              <p className="text-sm">{r.message}</p>
              <p className="text-xs text-muted-foreground">
                {formatDistanceToNowStrict(new Date(r.createdAt), { addSuffix: true })}
                {!r.isPublic ? " · private" : ""}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Award} title="No recognitions yet" description="Be the first to thank a colleague." className="m-4" />
      )}
    </Section>
  );
}

async function OneOnOnesTab({ ctx }: { ctx: RequestContext }) {
  if (!ctx.employeeId) return <EmptyState icon={CalendarClock} title="No employee record" description="1:1s are between a manager and a direct report." />;
  const res = await guard(async () => {
    const [items, partners] = await Promise.all([listOneOnOnes(ctx), oneOnOnePartners(ctx)]);
    return { items, partners };
  });
  if (!res.ok) return res.node;
  const { items, partners } = res.data;
  const partnerOptions = [...partners, ...items.filter((i) => !partners.some((p) => p.value === i.counterpart.id)).map((i) => ({ value: i.counterpart.id, label: i.counterpart.name, hint: i.iAmManager ? "Former report" : "Former manager" }))];
  return (
    <Section title="1:1s" description="Private to you and the other person." actions={partners.length ? <OneOnOneDialog partners={partners} /> : null}>
      {items.length ? (
        <ul className="divide-y">
          {items.map((m) => (
            <li key={m.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="text-sm">
                  <span className="font-medium">{m.counterpart.name}</span> <span className="text-muted-foreground">· {formatDate(m.heldOn)} · {m.iAmManager ? "your report" : "your manager"}</span>
                </p>
                {m.agenda ? <p className="line-clamp-2 text-sm text-muted-foreground">{m.agenda}</p> : null}
                {m.actionItems.length ? (
                  <p className="text-xs text-muted-foreground">
                    {m.actionItems.filter((a) => a.done).length}/{m.actionItems.length} action items done
                  </p>
                ) : null}
              </div>
              <OneOnOneDialog
                partners={partnerOptions}
                values={{ id: m.id, withEmployeeId: m.counterpart.id, heldOn: m.heldOn, agenda: m.agenda, notes: m.notes, actionItems: m.actionItems }}
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={HeartHandshake} title="No 1:1s recorded" description={partners.length ? "Record your next 1:1 with an agenda and action items." : "You have no manager or direct reports set up yet."} className="m-4" />
      )}
    </Section>
  );
}

async function CareerTab({ ctx }: { ctx: RequestContext }) {
  const res = await guard(async () => {
    const reports = ctx.employeeId ? await ctx.db((tx) => directReportIds(tx, ctx.employeeId!)) : [];
    const [mine, openings, reportPlans] = await Promise.all([
      ctx.employeeId ? getCareerPlan(ctx, ctx.employeeId) : Promise.resolve(null),
      internalOpenings(ctx),
      Promise.all(reports.slice(0, 50).map((id) => getCareerPlan(ctx, id).catch(() => null))),
    ]);
    return { mine, openings, reportPlans: reportPlans.filter((p): p is NonNullable<typeof p> => !!p) };
  });
  if (!res.ok) return res.node;
  const { mine, openings, reportPlans } = res.data;
  return (
    <div className="space-y-6">
      {mine ? (
        <Section
          title="My career plan"
          description={mine.plan?.reviewedOn ? `Last reviewed ${formatDate(mine.plan.reviewedOn)}` : "Share where you want to grow. Your manager and HR can see it."}
          actions={
            <CareerPlanDialog
              values={{
                employeeId: mine.employee.id,
                aspirations: mine.plan?.aspirations ?? null,
                targetRoles: mine.plan?.targetRoles ?? [],
                interestedInMobility: mine.plan?.interestedInMobility ?? false,
                actions: mine.plan?.actions ?? [],
              }}
            />
          }
        >
          <CareerPlanBody plan={mine.plan} />
        </Section>
      ) : null}
      {reportPlans.length ? (
        <Section title="My team's plans">
          <ul className="divide-y">
            {reportPlans.map((p) => (
              <li key={p.employee.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{p.employee.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.plan ? `${p.plan.targetRoles.join(", ") || "No target roles"} · ${p.plan.actions.filter((a) => a.done).length}/${p.plan.actions.length} actions done${p.plan.interestedInMobility ? " · open to moves" : ""}` : "No plan yet"}
                  </p>
                </div>
                {p.canManagerNote ? <ManagerNotesDialog employeeId={p.employee.id} name={p.employee.name} notes={p.plan?.managerNotes ?? null} /> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title="Internal openings" description="Published roles you can apply for internally.">
        {openings.length ? (
          <ul className="divide-y">
            {openings.map((o) => (
              <li key={o.id} className="px-5 py-3">
                <p className="text-sm font-medium">{o.title}</p>
                <p className="text-xs text-muted-foreground">
                  {[o.department, o.location, titleCase(o.workMode), titleCase(o.employmentType), o.closesOn ? `closes ${formatDate(o.closesOn)}` : null].filter(Boolean).join(" · ")}
                </p>
                {o.skills.length ? <p className="mt-1 text-xs text-muted-foreground">Skills: {o.skills.join(", ")}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Briefcase} title="No internal openings right now" className="m-4" />
        )}
      </Section>
    </div>
  );
}

function CareerPlanBody({ plan }: { plan: Awaited<ReturnType<typeof getCareerPlan>>["plan"] }) {
  if (!plan) return <p className="px-5 py-4 text-sm text-muted-foreground">You have not written a career plan yet.</p>;
  return (
    <div className="space-y-4 px-5 py-4 text-sm">
      {plan.aspirations ? <p className="whitespace-pre-wrap">{plan.aspirations}</p> : null}
      <p className="text-muted-foreground">
        Target roles: {plan.targetRoles.join(", ") || "—"} · {plan.interestedInMobility ? "Open to internal moves" : "Not looking to move"}
      </p>
      {plan.actions.length ? (
        <ul className="space-y-1">
          {plan.actions.map((a, i) => (
            <li key={i} className="flex items-center justify-between gap-3">
              <span className={a.done ? "text-muted-foreground line-through" : ""}>{a.title}</span>
              <span className="text-xs text-muted-foreground">
                {titleCase(a.kind)}
                {a.dueOn ? ` · ${formatDate(a.dueOn)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {plan.managerNotes ? (
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-xs font-medium text-muted-foreground">Manager notes</p>
          <p className="whitespace-pre-wrap">{plan.managerNotes}</p>
        </div>
      ) : null}
    </div>
  );
}

async function SuccessionTab({ ctx }: { ctx: RequestContext }) {
  const res = await guard(async () => {
    const [plans, employees, positions] = await Promise.all([listSuccessionPlans(ctx), ctx.db((tx) => employeeOptions(tx)), positionOptions(ctx)]);
    return { plans, employees, positions };
  });
  if (!res.ok) return res.node;
  const { plans, employees, positions } = res.data;
  return (
    <Section title="Succession plans" description="Critical roles, incumbents and ready successors. Restricted access." actions={<SuccessionDialog employees={employees} positions={positions} />}>
      {plans.length ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Role</TableHead>
                <TableHead>Incumbent</TableHead>
                <TableHead>Criticality</TableHead>
                <TableHead className="min-w-64">Successors</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <p className="font-medium">{p.roleTitle}</p>
                    {p.positionLabel ? <p className="text-xs text-muted-foreground">{p.positionLabel}</p> : null}
                  </TableCell>
                  <TableCell>{p.incumbentName ?? <span className="text-muted-foreground">Vacant</span>}</TableCell>
                  <TableCell>
                    <StatusBadge status={p.criticality} tone={p.criticality === "critical" ? "danger" : p.criticality === "high" ? "warning" : "neutral"} />
                  </TableCell>
                  <TableCell>
                    {p.candidates.length ? (
                      <ul className="space-y-0.5 text-sm">
                        {p.candidates.map((c) => (
                          <li key={c.employeeId}>
                            {c.name} <span className="text-xs text-muted-foreground">· {READINESS_LABELS[c.readiness]}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-danger">No successor identified</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <SuccessionDialog
                      employees={employees}
                      positions={positions}
                      values={{ id: p.id, positionId: p.positionId, roleTitle: p.roleTitle, incumbentEmployeeId: p.incumbentEmployeeId, criticality: p.criticality as "high", candidates: p.candidates.map(({ employeeId, readiness, notes }) => ({ employeeId, readiness, notes })) }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState icon={ShieldCheck} title="No succession plans" description="Start with the roles that would hurt most to lose." className="m-4" />
      )}
    </Section>
  );
}
