import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Page, PageHeader, Section } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { getReview, type ReviewDetail } from "@/server/services/talent/performance/reviews";
import { formatDate, formatDateTime } from "@/lib/format";
import { REVIEW_KIND_LABELS } from "@/lib/validation/talent";
import { RunButton } from "../../_components/run-button";
import { acknowledgeReviewAction, updateDevelopmentPlanAction } from "../../actions";
import { ReviewAssist } from "./review-assist";
import { RatingPicker, ReviewForm } from "./review-form";

export const metadata: Metadata = { title: "Review" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ReviewPage({ params }: PageProps<"/performance/reviews/[id]">) {
  return (
    <Page>
      <Suspense
        fallback={
          <div className="space-y-4">
            <Skeleton className="h-8 w-72" />
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <Skeleton className="h-96 rounded-xl" />
              <Skeleton className="h-64 rounded-xl" />
            </div>
          </div>
        }
      >
        <Body params={params} />
      </Suspense>
    </Page>
  );
}

function Answers({ questions, responses, levels, competencyNames }: Pick<ReviewDetail, "questions" | "levels" | "competencyNames"> & { responses: ReviewDetail["responses"] }) {
  return (
    <div className="space-y-3">
      {questions.map((q, i) => {
        const a = responses[q.id];
        return (
          <div key={q.id} className="rounded-xl border bg-card p-4">
            <p className="text-sm font-medium">
              <span className="text-muted-foreground tabular">{i + 1}.</span> {q.label}
            </p>
            {q.type === "competency" && q.competencyId ? <p className="text-xs text-muted-foreground">Competency: {competencyNames[q.competencyId] ?? "—"}</p> : null}
            <div className="mt-2 space-y-2">
              {q.type !== "text" ? a?.rating != null ? <RatingPicker levels={levels} value={a.rating} label={q.label} disabled /> : <p className="text-sm text-muted-foreground">Not rated</p> : null}
              {a?.text ? <p className="text-sm whitespace-pre-wrap">{a.text}</p> : q.type === "text" ? <p className="text-sm text-muted-foreground">No answer</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

async function Body({ params }: { params: PageProps<"/performance/reviews/[id]">["params"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireContext();
  let r: ReviewDetail;
  try {
    r = await getReview(ctx, id);
  } catch (err) {
    if (err instanceof AppError && (err.code === "NOT_FOUND" || err.code === "FORBIDDEN")) notFound();
    throw err;
  }
  const title = r.kind === "self" ? (r.access.isReviewer ? "My self review" : `${r.employee.name}'s self review`) : `${REVIEW_KIND_LABELS[r.kind]}: ${r.employee.name}`;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={r.access.isHr && !r.access.isReviewer ? `/performance/cycles/${r.cycle.id}` : "/performance?tab=reviews"} className="hover:underline">
            Performance · {r.cycle.name}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {title} <StatusBadge status={r.status} />
          </span>
        }
        description={[
          r.reviewer && r.kind !== "self" ? `Reviewer: ${r.reviewer.name}` : null,
          r.cycle.dueOn ? `Due ${formatDate(r.cycle.dueOn)}` : null,
          r.submittedAt ? `Submitted ${formatDateTime(r.submittedAt)}` : null,
          r.acknowledgedAt ? `Acknowledged ${formatDateTime(r.acknowledgedAt)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            {r.access.canAcknowledge ? (
              <RunButton action={acknowledgeReviewAction} input={{ id: r.id }} variant="default" success="Review acknowledged" confirm={{ title: "Acknowledge this review?", description: "Acknowledging confirms you have read the review and discussed it. It does not mean you agree with every point.", confirmLabel: "Acknowledge" }}>
                Acknowledge
              </RunButton>
            ) : null}
            {r.access.canUpdateDevelopmentPlan && r.developmentAreas ? (
              <RunButton action={updateDevelopmentPlanAction} input={{ id: r.id }} success="Development plan updated">
                Update development plan
              </RunButton>
            ) : null}
          </>
        }
      />
      {r.kind === "upward" && r.access.isReviewer ? (
        <p className="mb-4 rounded-md border bg-info-soft px-3 py-2 text-sm text-info">
          Your manager never sees individual answers. They see averages only when at least 3 people respond, after the cycle closes.
        </p>
      ) : null}
      {r.kind === "peer" && r.access.isReviewer ? (
        <p className="mb-4 rounded-md border bg-info-soft px-3 py-2 text-sm text-info">Peer feedback is visible to HR, not to {r.employee.name} directly.</p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {r.access.canEdit ? (
            <ReviewForm
              reviewId={r.id}
              kind={r.kind}
              questions={r.questions}
              competencyNames={r.competencyNames}
              levels={r.levels}
              initial={r.responses}
              initialOverall={r.kind === "manager" && r.status === "in_progress" && r.overallRating != null && r.suggestion && Math.abs((r.suggestion.overall ?? 0) - r.overallRating) >= 0.01 ? r.overallRating : null}
              initialJustification={r.overrideJustification}
              initialDevelopment={r.developmentAreas}
              goals={r.goals}
              includeGoals={r.includeGoals}
              goalsWeightPercent={r.goalsWeightPercent}
            />
          ) : (
            <>
              {r.status === "not_started" || r.status === "in_progress" ? (
                <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  {r.cycle.status === "closed" ? "The cycle closed before this review was submitted." : "This review has not been submitted yet."}
                </p>
              ) : null}
              <Answers questions={r.questions} responses={r.responses} levels={r.levels} competencyNames={r.competencyNames} />
              {r.kind === "manager" && r.developmentAreas ? (
                <Section title="Agreed development areas">
                  <ul className="list-disc space-y-0.5 px-9 py-3 text-sm">
                    {r.developmentAreas
                      .split("\n")
                      .filter((l) => l.trim())
                      .map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                  </ul>
                </Section>
              ) : null}
            </>
          )}
          {r.selfReview ? (
            <Section title={`${r.employee.name}'s self review`} description={r.selfReview.submittedAt ? `Submitted ${formatDateTime(r.selfReview.submittedAt)}` : undefined}>
              <div className="p-4">
                <Answers questions={r.selfReview.questions} responses={r.selfReview.responses} levels={r.levels} competencyNames={r.competencyNames} />
              </div>
            </Section>
          ) : r.kind === "manager" && !r.access.isSubject ? (
            <p className="text-sm text-muted-foreground">The self review appears here once {r.employee.name} submits it.</p>
          ) : null}
        </div>
        <aside className="space-y-4">
          {r.kind === "manager" || r.kind === "self" ? (
            <Section title="Rating">
              <div className="space-y-2 px-5 py-4 text-sm">
                {r.finalRating != null && r.status !== "in_progress" && r.status !== "not_started" ? (
                  <p>
                    <span className="text-2xl font-semibold tabular">{r.finalRating.toFixed(2)}</span>
                    <span className="ml-1 text-muted-foreground">/ {Math.max(...r.levels.map((l) => l.value))}</span>
                  </p>
                ) : null}
                {r.suggestion ? (
                  <p className="text-muted-foreground">
                    Suggested from answers{r.includeGoals ? " and goals" : ""}: <span className="font-medium text-foreground tabular">{r.suggestion.overall?.toFixed(2) ?? "—"}</span>
                  </p>
                ) : null}
                {r.calibratedRating != null ? (
                  <p className="text-muted-foreground">
                    Calibrated to <span className="font-medium text-foreground tabular">{r.calibratedRating.toFixed(2)}</span>
                    {r.calibrationNote ? ` · ${r.calibrationNote}` : ""}
                  </p>
                ) : null}
                {r.overrideJustification && !r.access.canEdit ? <p className="text-muted-foreground">Manager&apos;s note on the rating: {r.overrideJustification}</p> : null}
              </div>
            </Section>
          ) : null}
          {r.includeGoals && r.goals.length ? (
            <Section title="Goals this cycle" description={`Goal attainment counts ${r.goalsWeightPercent}% toward the suggested rating.`}>
              <ul className="divide-y">
                {r.goals.map((g) => (
                  <li key={g.id} className="space-y-1 px-5 py-2.5 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{g.title}</span>
                      <span className="text-xs text-muted-foreground tabular">{g.weight}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Progress value={g.progressPercent} className="h-1.5 flex-1" aria-label={`${g.progressPercent}%`} />
                      <span className="text-xs tabular text-muted-foreground">{g.progressPercent}%</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {r.access.canAssist ? (
            <Section title="Assistant" description="Advisory only. Nothing is saved to the review and ratings are never computed by AI.">
              <ReviewAssist reviewId={r.id} />
            </Section>
          ) : null}
        </aside>
      </div>
    </>
  );
}
