import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EyeOff } from "lucide-react";
import { EmptyState, Page, PageHeader, Section, StatGridSkeleton } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { getSurveyAdmin } from "@/server/services/talent/engagement/surveys";
import { surveyResults, type SurveyResults } from "@/server/services/talent/engagement/results";
import { listActionPlans } from "@/server/services/talent/engagement/career";
import { employeeFormLookups } from "@/server/services/employees/lookups";
import { employeeOptions } from "@/server/services/talent/shared";
import { formatDate, formatPercent, titleCase } from "@/lib/format";
import { SURVEY_QUESTION_TYPE_LABELS } from "@/lib/validation/talent";
import type { BreakdownGroup, QuestionResult } from "@/lib/talent/aggregation";
import { RunButton } from "@/app/(app)/performance/_components/run-button";
import { SurveyDialog } from "../../_components/survey-dialog";
import { ActionPlanDialog } from "../../_components/people-dialogs";
import { ThemeSummary } from "../../_components/survey-client";
import { closeSurveyAction, launchSurveyAction } from "../../actions";

export const metadata: Metadata = { title: "Survey" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function SurveyPage({ params }: PageProps<"/engagement/surveys/[id]">) {
  return (
    <Page>
      <Suspense fallback={<StatGridSkeleton />}>
        <Body params={params} />
      </Suspense>
    </Page>
  );
}

const NOT_ENOUGH = "Not enough responses";

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <span className="inline-block h-1.5 w-28 overflow-hidden rounded-full bg-muted align-middle" aria-hidden>
      <span className="block h-full rounded-full bg-chart-seq" style={{ width: `${pct}%` }} />
    </span>
  );
}

function QuestionBlock({ q, surveyId }: { q: QuestionResult; surveyId: string }) {
  return (
    <li className="space-y-2 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{q.label}</p>
        <span className="text-xs text-muted-foreground">
          {SURVEY_QUESTION_TYPE_LABELS[q.type]}
          {q.driver ? ` · ${q.driver}` : ""}
        </span>
      </div>
      {q.type === "scale" ? (
        q.stats ? (
          <div className="space-y-1 text-sm">
            <p>
              <span className="text-lg font-semibold tabular">{q.stats.average.toFixed(2)}</span> <span className="text-muted-foreground">average · {q.stats.favorablePercent}% favourable · {q.stats.count} answers</span>
            </p>
            <ul className="space-y-0.5 text-xs">
              {[5, 4, 3, 2, 1].map((v) => (
                <li key={v} className="flex items-center gap-2">
                  <span className="w-3 tabular text-muted-foreground">{v}</span>
                  <Bar value={q.stats!.distribution[v] ?? 0} max={q.stats!.count} />
                  <span className="tabular text-muted-foreground">{q.stats!.distribution[v] ?? 0}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No answers.</p>
        )
      ) : null}
      {q.type === "enps" ? (
        q.enps ? (
          <p className="text-sm">
            <span className="text-lg font-semibold tabular">{q.enps.score > 0 ? `+${q.enps.score}` : q.enps.score}</span>{" "}
            <span className="text-muted-foreground">
              eNPS · {q.enps.promoters} promoters, {q.enps.passives} passives, {q.enps.detractors} detractors
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No answers.</p>
        )
      ) : null}
      {q.type === "choice" ? (
        <ul className="space-y-0.5 text-xs">
          {q.counts.map((c) => (
            <li key={c.option} className="flex items-center gap-2">
              <span className="w-32 truncate">{c.option}</span>
              <Bar value={c.count} max={q.total} />
              <span className="tabular text-muted-foreground">{c.count}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {q.type === "text" ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            {q.answered} comments. Individual comments are never shown{q.themes.length ? "; frequent words:" : "."} {q.themes.map((t) => `${t.term} (${t.count})`).join(", ")}
          </p>
          <ThemeSummary surveyId={surveyId} questionId={q.id} />
        </div>
      ) : null}
    </li>
  );
}

function BreakdownTable({ title, groups }: { title: string; groups: BreakdownGroup[] }) {
  return (
    <Section title={`By ${title}`}>
      {groups.length ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{titleCase(title)}</TableHead>
                <TableHead className="text-right">Responses</TableHead>
                <TableHead className="text-right">Average</TableHead>
                <TableHead className="text-right">eNPS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow key={g.key}>
                  <TableCell>{g.label}</TableCell>
                  {g.suppressed ? (
                    <TableCell colSpan={3} className="text-right text-xs text-muted-foreground">
                      <EyeOff className="mr-1 inline size-3.5" />
                      {NOT_ENOUGH}
                    </TableCell>
                  ) : (
                    <>
                      <TableCell className="text-right tabular">{g.count}</TableCell>
                      <TableCell className="text-right tabular">{g.overallAverage?.toFixed(2) ?? "—"}</TableCell>
                      <TableCell className="text-right tabular">{g.enps ?? "—"}</TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="px-5 py-4 text-sm text-muted-foreground">No data.</p>
      )}
    </Section>
  );
}

function Results({ r }: { r: SurveyResults }) {
  const a = r.aggregate;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
        {[
          ["Responses", a.suppressed ? NOT_ENOUGH : String(a.responseCount)],
          ["Response rate", a.responseRate == null ? "—" : formatPercent(a.responseRate)],
          ["Engagement (1–5)", a.overallAverage?.toFixed(2) ?? "—"],
          ["eNPS", a.enps ? (a.enps.score > 0 ? `+${a.enps.score}` : String(a.enps.score)) : "—"],
        ].map(([label, value]) => (
          <div key={label} className="space-y-1 bg-card p-5">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-semibold tabular">{value}</p>
          </div>
        ))}
      </div>
      {a.suppressed ? (
        <EmptyState
          icon={EyeOff}
          title={NOT_ENOUGH}
          description={`Results appear once at least ${a.minGroupSize} people have responded, so no one can be identified.`}
        />
      ) : (
        <>
          {a.drivers.length ? (
            <Section title="Drivers">
              <ul className="divide-y">
                {a.drivers.map((d) => (
                  <li key={d.driver} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span>{d.driver}</span>
                    <span className="flex items-center gap-2">
                      <Bar value={d.average - 1} max={4} />
                      <span className="w-10 text-right font-medium tabular">{d.average.toFixed(2)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          <Section title="Questions">
            <ul className="divide-y">
              {a.questions.map((q) => (
                <QuestionBlock key={q.id} q={q} surveyId={r.survey.id} />
              ))}
            </ul>
          </Section>
          <div className="grid gap-6 lg:grid-cols-3">
            <BreakdownTable title="department" groups={r.breakdowns.department} />
            <BreakdownTable title="location" groups={r.breakdowns.location} />
            <BreakdownTable title="tenure" groups={r.breakdowns.tenure} />
          </div>
        </>
      )}
    </div>
  );
}

async function Body({ params }: { params: PageProps<"/engagement/surveys/[id]">["params"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireContext();
  const manage = can(ctx, "engagement.manage", "all");
  const resultsAccess = can(ctx, "engagement.results", "all");
  if (!manage && !resultsAccess) notFound();
  let info;
  try {
    info = await getSurveyAdmin(ctx, id);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const s = info.survey;
  const [results, lookups, plans, people] = await Promise.all([
    resultsAccess && s.status !== "draft" ? surveyResults(ctx, id) : Promise.resolve(null),
    employeeFormLookups(ctx),
    listActionPlans(ctx, { surveyId: id }),
    manage ? ctx.db((tx) => employeeOptions(tx)) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/engagement?tab=surveys" className="hover:underline">
            People success · Surveys
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {s.title} <StatusBadge status={s.status} />
          </span>
        }
        description={[titleCase(s.kind), s.isAnonymous ? `Anonymous · groups of ${s.minGroupSize}+` : "Named responses", s.opensOn ? `Opens ${formatDate(s.opensOn)}` : null, s.closesOn ? `Closes ${formatDate(s.closesOn)}` : null].filter(Boolean).join(" · ")}
        actions={
          manage ? (
            <>
              {s.status === "draft" ? (
                <SurveyDialog
                  departments={lookups.departments}
                  locations={lookups.locations}
                  values={{
                    id: s.id,
                    title: s.title,
                    kind: s.kind as "pulse",
                    description: s.description,
                    isAnonymous: s.isAnonymous,
                    minGroupSize: s.minGroupSize,
                    questions: s.questions.map((q) => ({ ...q, driver: q.driver ?? undefined })),
                    audienceAll: !!s.audience.all,
                    departmentIds: s.audience.departmentIds ?? [],
                    locationIds: s.audience.locationIds ?? [],
                    opensOn: s.opensOn,
                    closesOn: s.closesOn,
                  }}
                />
              ) : null}
              {s.status === "draft" ? (
                <RunButton action={launchSurveyAction} input={{ id: s.id }} variant="default" success="Survey launched; invitees notified" confirm={{ title: "Launch this survey?", description: "Everyone in the audience is invited and notified. Questions cannot be changed after launch.", confirmLabel: "Launch" }}>
                  Launch
                </RunButton>
              ) : null}
              {s.status === "active" ? (
                <RunButton action={closeSurveyAction} input={{ id: s.id }} success="Survey closed" confirm={{ title: "Close this survey?", description: "No more responses will be accepted.", confirmLabel: "Close survey" }}>
                  Close survey
                </RunButton>
              ) : null}
            </>
          ) : null
        }
      />
      <div className="space-y-6">
        {s.status === "draft" ? (
          <Section title="Questions" description={`${s.questions.length} questions · audience: ${s.audience.all ? "everyone" : "selected departments / locations"}`}>
            <ol className="divide-y">
              {s.questions.map((q, i) => (
                <li key={q.id} className="flex justify-between gap-3 px-5 py-2.5 text-sm">
                  <span>
                    {i + 1}. {q.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {SURVEY_QUESTION_TYPE_LABELS[q.type]}
                    {q.required ? "" : " · optional"}
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        ) : results ? (
          <Results r={results} />
        ) : (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            {info.responded} of {info.participants} invitees have responded. Viewing results needs the survey results permission.
          </p>
        )}
        {s.status !== "draft" ? (
          <Section
            title="Action plans"
            actions={manage ? <ActionPlanDialog employees={people} surveys={[{ value: s.id, label: s.title }]} departments={lookups.departments} /> : null}
          >
            {plans.length ? (
              <ul className="divide-y">
                {plans.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div>
                      <p className="text-sm font-medium">
                        {p.focusArea} <StatusBadge status={p.status} className="ml-1" />
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Owner {p.ownerName}
                        {p.departmentName ? ` · ${p.departmentName}` : ""} · {p.actions.filter((x) => x.done).length}/{p.actions.length} done
                      </p>
                    </div>
                    {p.canEdit ? (
                      <ActionPlanDialog
                        employees={people}
                        surveys={[{ value: s.id, label: s.title }]}
                        departments={lookups.departments}
                        canChangeScope={manage}
                        values={{ id: p.id, surveyId: p.surveyId, departmentId: p.departmentId, ownerEmployeeId: p.ownerEmployeeId, focusArea: p.focusArea, actions: p.actions, status: p.status as "open" }}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-muted-foreground">No action plans for this survey yet.</p>
            )}
          </Section>
        ) : null}
        {s.status === "active" && manage ? (
          <p className="text-xs text-muted-foreground">
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
              <Link href={`/engagement/surveys/${s.id}/respond`}>Preview the response form</Link>
            </Button>{" "}
            (available if you were invited).
          </p>
        ) : null}
      </div>
    </>
  );
}
