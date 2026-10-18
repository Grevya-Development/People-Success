import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Download, EyeOff, Video } from "lucide-react";
import { NoAccess, Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { getInterview, type FeedbackView } from "@/server/services/recruitment/interviews";
import { formatDateTime, titleCase } from "@/lib/format";
import { formatIst, RECOMMENDATION_LABELS } from "@/lib/validation/recruitment";
import { FeedbackForm } from "../../_components/feedback-form";
import { ReasonDialog, ActionButton } from "../../_components/client";
import { interviewStatusAction } from "../../actions";

export const metadata: Metadata = { title: "Interview", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function InterviewPage({ params }: PageProps<"/recruitment/interviews/[id]">) {
  return (
    <Page>
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <Body params={params} />
      </Suspense>
    </Page>
  );
}

function FeedbackCard({ f, criteria }: { f: FeedbackView; criteria: { key: string; label: string }[] }) {
  const label = new Map(criteria.map((c) => [c.key, c.label]));
  return (
    <li className="space-y-2 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{f.interviewerName}</span>
        <span className="flex items-center gap-2 text-sm">
          <StatusBadge status={f.recommendation} label={RECOMMENDATION_LABELS[f.recommendation as keyof typeof RECOMMENDATION_LABELS]} tone={f.recommendation.endsWith("yes") ? "success" : "danger"} />
          <span className="tabular">{f.overallRating}/5</span>
        </span>
      </div>
      {f.scores.length ? (
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {f.scores.map((s) => (
            <li key={s.key}>
              <span className="text-muted-foreground">{label.get(s.key) ?? s.key}:</span> <span className="tabular">{s.rating}/5</span>
              {s.notes ? <span className="block text-xs text-muted-foreground">{s.notes}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {f.strengths ? <p className="text-sm"><span className="font-medium">Strengths:</span> {f.strengths}</p> : null}
      {f.concerns ? <p className="text-sm"><span className="font-medium">Concerns:</span> {f.concerns}</p> : null}
      <p className="text-xs text-muted-foreground">Submitted {formatDateTime(f.submittedAt)}</p>
    </li>
  );
}

async function Body({ params }: { params: PageProps<"/recruitment/interviews/[id]">["params"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireContext();
  let iv: Awaited<ReturnType<typeof getInterview>>;
  try {
    iv = await getInterview(ctx, id);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    if (err instanceof AppError && err.code === "FORBIDDEN") return <NoAccess message={err.message} />;
    throw err;
  }
  const started = iv.hasStarted;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/recruitment?tab=interviews" className="hover:underline">
            Interviews
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {iv.candidateName} · {iv.roundName} <StatusBadge status={iv.status} tone={iv.status === "scheduled" ? "info" : undefined} />
          </span>
        }
        description={`${iv.openingTitle} · ${formatIst(iv.scheduledStart)} · ${titleCase(iv.mode)}`}
        actions={
          <>
            {iv.meetingUrl && iv.status === "scheduled" ? (
              <Button size="sm" variant="outline" asChild>
                <a href={iv.meetingUrl} target="_blank" rel="noopener noreferrer">
                  <Video /> Join
                </a>
              </Button>
            ) : null}
            {iv.resume ? (
              <Button size="sm" variant="outline" asChild>
                <a href={`/api/recruitment/documents/${iv.resume.id}`}>
                  <Download /> Resume
                </a>
              </Button>
            ) : null}
            {iv.canManage && iv.status === "scheduled" ? (
              <>
                <ActionButton action={interviewStatusAction} input={{ interviewId: iv.id, status: "completed" as const, reason: null }} success="Marked completed">
                  Mark completed
                </ActionButton>
                <ActionButton action={interviewStatusAction} input={{ interviewId: iv.id, status: "no_show" as const, reason: null }} success="Marked as no-show" variant="ghost" confirm={{ title: "Mark as no-show?", description: "Records that the candidate did not attend.", label: "Mark no-show" }}>
                  No-show
                </ActionButton>
                <ReasonDialog
                  trigger={
                    <Button size="sm" variant="ghost">
                      Cancel interview
                    </Button>
                  }
                  title="Cancel this interview?"
                  description="The panel is notified. Let the candidate know separately if needed."
                  label="Reason"
                  confirmLabel="Cancel interview"
                  destructive
                  run={(reason) => interviewStatusAction({ interviewId: iv.id, status: "cancelled", reason })}
                  success="Interview cancelled"
                />
              </>
            ) : null}
            {iv.canManage ? (
              <Button size="sm" variant="ghost" asChild>
                <Link href={`/recruitment/candidates/${iv.candidateId}`}>Candidate profile</Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-5">
          {iv.canGiveFeedback ? (
            <Section title={iv.myFeedback ? "Your feedback" : "Your scorecard"} description={iv.scorecardName ? `Scorecard: ${iv.scorecardName}` : "General criteria"}>
              <div className="p-5">
                {started ? (
                  <FeedbackForm interviewId={iv.id} criteria={iv.criteria} existing={iv.myFeedback} />
                ) : (
                  <p className="text-sm text-muted-foreground">The scorecard opens when the interview starts ({formatIst(iv.scheduledStart)}).</p>
                )}
              </div>
            </Section>
          ) : null}
          <Section title="Panel feedback">
            {iv.othersFeedback ? (
              iv.othersFeedback.length ? (
                <ul className="divide-y">
                  {iv.othersFeedback.map((f) => (
                    <FeedbackCard key={f.interviewerUserId} f={f} criteria={iv.criteria} />
                  ))}
                </ul>
              ) : (
                <p className="p-5 text-sm text-muted-foreground">No other feedback yet.</p>
              )
            ) : (
              <div className="flex items-start gap-3 p-5 text-sm text-muted-foreground">
                <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden />
                {iv.othersHiddenReason}
              </div>
            )}
          </Section>
        </div>
        <div className="space-y-5">
          <Section title="Panel">
            <ul className="divide-y">
              {iv.panel.map((p) => (
                <li key={p.userId} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <span>
                    {p.name}
                    {p.isLead ? <span className="text-xs text-muted-foreground"> · lead</span> : null}
                  </span>
                  {p.submitted ? <StatusBadge status="submitted" label="Submitted" tone="success" /> : <StatusBadge status="pending" label="Pending" tone="neutral" />}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Candidate">
            <dl className="grid gap-3 p-5 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Current role</dt>
                <dd>{[iv.candidate.currentTitle, iv.candidate.currentCompany].filter(Boolean).join(" · ") || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Experience</dt>
                <dd>{iv.candidate.totalExperienceMonths != null ? `${Math.round(iv.candidate.totalExperienceMonths / 12)} years` : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Job skills to probe</dt>
                <dd>{iv.openingSkills.length ? iv.openingSkills.join(", ") : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Where</dt>
                <dd className="break-all">{iv.mode === "onsite" ? iv.location : (iv.meetingUrl ?? iv.location ?? "—")}</dd>
              </div>
            </dl>
          </Section>
        </div>
      </div>
    </>
  );
}
