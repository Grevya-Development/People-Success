import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, cache } from "react";
import { notFound } from "next/navigation";
import { Download, ExternalLink, FileSignature, UserRoundCheck } from "lucide-react";
import { NoAccess, Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { PersonAvatar } from "@/components/person";
import { requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { getCandidate, type CandidateApplication, type TimelineEvent } from "@/server/services/recruitment/candidates";
import { recruitmentLookups } from "@/server/services/recruitment/lookups";
import { listScorecards, pipelineStages } from "@/server/services/recruitment/stages";
import { openingOptions } from "@/server/services/recruitment/openings";
import { canManageOffers } from "@/server/services/recruitment/shared";
import { tenants } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { formatDate, formatDateTime, titleCase } from "@/lib/format";
import { formatIst, SOURCE_LABELS } from "@/lib/validation/recruitment";
import { MoveMenu } from "../../_components/pipeline";
import { EmailComposer, MatchPanel, ParsedProfile } from "../../_components/ai-panels";
import { ApplyToJob, NoteForm, PoolToggles, ScheduleInterviewDialog, TagsEditor } from "../../_components/candidate-panels";

export const metadata: Metadata = { title: "Candidate", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const load = cache(async (id: string) => {
  const ctx = await requireContext();
  if (!UUID.test(id)) notFound();
  try {
    return { ctx, c: await getCandidate(ctx, id) };
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    if (err instanceof AppError && err.code === "FORBIDDEN") return { ctx, c: null };
    throw err;
  }
});

export default function CandidatePage({ params }: PageProps<"/recruitment/candidates/[id]">) {
  return (
    <Page>
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <Body params={params} />
      </Suspense>
    </Page>
  );
}

const EVENT_LABEL: Record<string, string> = {
  applied: "Applied",
  stage_changed: "Stage changed",
  note: "Note",
  email: "Email sent",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  reopened: "Reopened",
  interview_scheduled: "Interview scheduled",
  interview_completed: "Interview completed",
  interview_cancelled: "Interview cancelled",
  interview_no_show: "No-show",
  feedback_submitted: "Feedback submitted",
  feedback_updated: "Feedback updated",
  ai_summary: "Match notes",
  hired: "Hired",
};

function Timeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  return (
    <ol className="space-y-3">
      {events.map((e) => (
        <li key={e.id} className="border-l-2 pl-3 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{EVENT_LABEL[e.type] ?? titleCase(e.type)}</span>
            {e.type === "stage_changed" || e.type === "hired" ? (
              <span className="text-muted-foreground">
                {e.fromStage ?? "—"} → {e.toStage ?? "—"}
              </span>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {formatDateTime(e.createdAt)}
              {e.actorName ? ` · ${e.actorName}` : e.type === "applied" || e.type.startsWith("offer_") ? " · candidate / system" : ""}
            </span>
          </div>
          {e.type === "email" && e.metadata?.subject ? <div className="text-xs text-muted-foreground">Subject: {String(e.metadata.subject)}</div> : null}
          {e.body ? <p className="mt-0.5 line-clamp-4 whitespace-pre-line text-muted-foreground">{e.body}</p> : null}
        </li>
      ))}
    </ol>
  );
}

async function ApplicationBlock({
  a,
  canManage,
  canOffer,
  stages,
  interviewers,
  scorecards,
  candidateName,
  companyName,
}: {
  a: CandidateApplication;
  canManage: boolean;
  canOffer: boolean;
  stages: { id: string; name: string; kind: string }[];
  interviewers: { value: string; label: string; hint?: string }[];
  scorecards: { value: string; label: string }[];
  candidateName: string;
  companyName: string;
}) {
  const liveOffer = a.offers.find((o) => ["draft", "pending_approval", "approved", "sent", "accepted"].includes(o.status));
  return (
    <Section
      title={
        <span className="flex flex-wrap items-center gap-2">
          <Link href={`/recruitment/openings/${a.opening.id}`} className="hover:underline">
            {a.opening.title}
          </Link>
          {a.status === "active" ? <StatusBadge status={a.stage.kind} label={a.stage.name} tone="info" /> : <StatusBadge status={a.status} />}
          {a.referral ? <StatusBadge status="referral" label={`Referred by ${a.referral.referrerName ?? "an employee"}`} tone="brand" /> : null}
        </span>
      }
      description={`Applied ${formatDate(a.appliedAt)} · ${SOURCE_LABELS[a.source] ?? titleCase(a.source)}${a.averageRating != null ? ` · average rating ${a.averageRating.toFixed(1)}/5` : ""}`}
      actions={
        canManage && a.status === "active" ? (
          <div className="flex flex-wrap justify-end gap-2">
            <EmailComposer applicationId={a.id} candidateName={candidateName} />
            <ScheduleInterviewDialog applicationId={a.id} interviewers={interviewers} scorecards={scorecards} />
            {canOffer && a.stage.kind === "offer" && !liveOffer ? (
              <Button size="sm" asChild>
                <Link href={`/recruitment/offers/new?application=${a.id}`}>
                  <FileSignature /> Create offer
                </Link>
              </Button>
            ) : null}
            <MoveMenu card={{ applicationId: a.id, stageId: a.stage.id, status: a.status, name: candidateName }} stages={stages} jobTitle={a.opening.title} companyName={companyName} trigger="button" />
          </div>
        ) : null
      }
    >
      <div className="grid gap-5 p-5 lg:grid-cols-2">
        <div className="space-y-5">
          {a.rejectionReason ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm">
              <span className="font-medium">{a.status === "withdrawn" ? "Withdrawal note" : "Rejection reason"}:</span> {a.rejectionReason}
            </p>
          ) : null}
          {a.answers.length || a.coverNote ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Application</h3>
              {a.answers.map((q) => (
                <div key={q.label} className="text-sm">
                  <div className="text-xs text-muted-foreground">{q.label}</div>
                  {q.answer}
                </div>
              ))}
              {a.coverNote ? <p className="text-sm whitespace-pre-line text-muted-foreground">{a.coverNote}</p> : null}
            </div>
          ) : null}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Interviews</h3>
            {a.interviews.length ? (
              <ul className="divide-y rounded-lg border">
                {a.interviews.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <div>
                      <Link href={`/recruitment/interviews/${i.id}`} className="font-medium hover:underline">
                        {i.roundName}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {formatIst(i.scheduledStart)} · {i.panel.map((p) => `${p.name}${p.submitted ? " ✓" : ""}`).join(", ")}
                      </div>
                    </div>
                    <StatusBadge status={i.status} tone={i.status === "scheduled" ? "info" : undefined} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No interviews yet.</p>
            )}
          </div>
          {a.offers.length ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Offers</h3>
              <ul className="divide-y rounded-lg border">
                {a.offers.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <Link href={`/recruitment/offers/${o.id}`} className="font-medium hover:underline">
                      Version {o.version} · joining {formatDate(o.joiningDate)}
                    </Link>
                    <StatusBadge status={o.status} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Job match</h3>
            <MatchPanel applicationId={a.id} summary={a.aiSummary} canManage={canManage} />
          </div>
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Activity and communication</h3>
          <NoteForm applicationId={a.id} />
          <Timeline events={a.events} />
        </div>
      </div>
    </Section>
  );
}

async function Body({ params }: { params: PageProps<"/recruitment/candidates/[id]">["params"] }) {
  const { id } = await params;
  const { ctx, c } = await load(id);
  if (!c) return <NoAccess message="Candidate profiles are visible to the recruiting team." />;
  const [stages, lookups, scorecards, openings, [tenant]] = await Promise.all([
    pipelineStages(ctx),
    c.canManage ? recruitmentLookups(ctx) : Promise.resolve(null),
    c.canManage ? listScorecards(ctx) : Promise.resolve([]),
    c.canManage ? openingOptions(ctx, { onlyOpen: true }) : Promise.resolve([]),
    ctx.db((tx) => tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, ctx.tenantId))),
  ]);
  const appliedTo = new Set(c.applications.map((a) => a.opening.id));
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/recruitment?tab=candidates" className="hover:underline">
            Candidates
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <PersonAvatar id={c.id} name={c.name} className="size-10" />
            <span>
              {c.name}
              <span className="block text-sm font-normal text-muted-foreground">{[c.currentTitle, c.currentCompany].filter(Boolean).join(" · ") || c.email}</span>
            </span>
          </span>
        }
        actions={
          <>
            {c.resume ? (
              <Button size="sm" variant="outline" asChild>
                <a href={`/api/recruitment/documents/${c.resume.id}`}>
                  <Download /> Resume
                </a>
              </Button>
            ) : null}
            {c.employeeId ? (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/employees/${c.employeeId}`}>
                  <UserRoundCheck /> Employee record
                </Link>
              </Button>
            ) : null}
            {c.canManage ? <ApplyToJob candidateId={c.id} openings={openings.filter((o) => !appliedTo.has(o.value))} /> : null}
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-5">
          {c.applications.length ? (
            c.applications.map((a) => (
              <ApplicationBlock
                key={a.id}
                a={a}
                canManage={c.canManage}
                canOffer={canManageOffers(ctx)}
                stages={stages}
                interviewers={lookups?.interviewers ?? []}
                scorecards={scorecards.map((s) => ({ value: s.id, label: s.name }))}
                candidateName={c.name}
                companyName={tenant?.name ?? ""}
              />
            ))
          ) : (
            <Section title="Applications">
              <p className="p-5 text-sm text-muted-foreground">This candidate has not applied to any job.</p>
            </Section>
          )}
        </div>
        <div className="space-y-5">
          <Section title="Contact">
            <dl className="grid gap-3 p-5 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Email</dt>
                <dd className="break-all">{c.email}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Phone</dt>
                <dd>{c.phone ?? "—"}</dd>
              </div>
              {c.linkedinUrl ? (
                <div>
                  <dt className="text-xs text-muted-foreground">LinkedIn</dt>
                  <dd>
                    <a href={c.linkedinUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 hover:underline">
                      Profile <ExternalLink className="size-3" aria-hidden />
                    </a>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs text-muted-foreground">Experience</dt>
                <dd>{c.totalExperienceMonths != null ? `${Math.round((c.totalExperienceMonths / 12) * 10) / 10} years` : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Source</dt>
                <dd>
                  {SOURCE_LABELS[c.source] ?? titleCase(c.source)}
                  {c.sourceDetail ? ` · ${c.sourceDetail}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Consent and retention</dt>
                <dd>
                  {c.consentAt ? `Consent recorded ${formatDate(c.consentAt)}` : "No consent recorded"}
                  {c.retainUntil ? ` · keep until ${formatDate(c.retainUntil)}` : c.employeeId ? " · joined (employee record)" : ""}
                </dd>
              </div>
            </dl>
          </Section>
          {c.canManage ? (
            <Section title="Tags and talent pools">
              <div className="space-y-4 p-5">
                <TagsEditor candidateId={c.id} tags={c.tags} />
                <PoolToggles candidateId={c.id} pools={c.pools} />
              </div>
            </Section>
          ) : c.tags.length ? (
            <Section title="Tags">
              <div className="flex flex-wrap gap-1 p-5">
                {c.tags.map((t) => (
                  <StatusBadge key={t} status={t} tone="neutral" className="normal-case" />
                ))}
              </div>
            </Section>
          ) : null}
          <Section title="Resume profile" description={c.resume ? `${c.resume.fileName} · uploaded ${formatDate(c.resume.uploadedAt)}` : "No resume on file"}>
            <ParsedProfile candidateId={c.id} profile={c.parsedProfile} canManage={c.canManage} hasResume={!!c.resume} />
          </Section>
        </div>
      </div>
    </>
  );
}
