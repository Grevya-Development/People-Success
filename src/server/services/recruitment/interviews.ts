import "server-only";
import { addMinutes } from "date-fns";
import { and, asc, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { can, type RequestContext } from "../../auth/context";
import type { Tx } from "../../db/client";
import { withSystem } from "../../db/tx";
import {
  applications,
  candidates,
  documents,
  interviewFeedback,
  interviewPanelists,
  interviews,
  jobOpenings,
  scorecardTemplates,
  tenants,
  users,
} from "../../db/schema";
import type { ScorecardCriterion } from "../../db/schema/recruitment";
import { audit } from "../../lib/audit";
import { AppError, forbidden, invalidState, notFound, validation } from "../../lib/errors";
import { enqueueEmail, renderEmail } from "../email";
import { notify } from "../notifications";
import { formatIst, istLocalToDate, type FeedbackInput, type ScheduleInterviewInput } from "@/lib/validation/recruitment";
import { queueCandidateEmail } from "./messaging";
import { appUrl, canManageRecruitment, canViewRecruitment, fullName, logEvent, requireRecruitmentManage, userNames, usersWithPermission } from "./shared";

/* ------------------------------------------------------------------ */
/* Scheduling                                                          */
/* ------------------------------------------------------------------ */

export type InterviewConflict = { userId: string; name: string; roundName: string; candidateName: string; start: string; end: string };

/** Scheduled interviews of any of `userIds` overlapping [start, end). */
export async function findConflicts(tx: Tx, userIds: string[], start: Date, end: Date, excludeInterviewId?: string): Promise<InterviewConflict[]> {
  if (!userIds.length) return [];
  const rows = await tx
    .select({
      userId: interviewPanelists.userId,
      roundName: interviews.roundName,
      start: interviews.scheduledStart,
      end: interviews.scheduledEnd,
      first: candidates.firstName,
      last: candidates.lastName,
    })
    .from(interviewPanelists)
    .innerJoin(interviews, eq(interviews.id, interviewPanelists.interviewId))
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .where(
      and(
        inArray(interviewPanelists.userId, userIds),
        eq(interviews.status, "scheduled"),
        lt(interviews.scheduledStart, end),
        gt(interviews.scheduledEnd, start),
        excludeInterviewId ? ne(interviews.id, excludeInterviewId) : undefined,
      ),
    );
  const names = await userNames(tx, rows.map((r) => r.userId));
  return rows.map((r) => ({
    userId: r.userId,
    name: names.get(r.userId) ?? "Interviewer",
    roundName: r.roundName,
    candidateName: fullName({ firstName: r.first, lastName: r.last }),
    start: r.start.toISOString(),
    end: r.end.toISOString(),
  }));
}

export class InterviewConflictError extends AppError {
  constructor(readonly conflicts: InterviewConflict[]) {
    super(
      "CONFLICT",
      `Schedule clash: ${conflicts
        .slice(0, 3)
        .map((c) => `${c.name} has “${c.roundName}” (${formatIst(c.start, { withZone: false })})`)
        .join("; ")}${conflicts.length > 3 ? ` and ${conflicts.length - 3} more` : ""}. Choose another time or schedule anyway.`,
      { details: { conflicts } },
    );
  }
}

export async function scheduleInterview(ctx: RequestContext, input: ScheduleInterviewInput) {
  requireRecruitmentManage(ctx);
  const start = istLocalToDate(input.start);
  const end = addMinutes(start, input.durationMinutes);
  if (Number.isNaN(start.getTime())) throw validation("Choose a valid start time.", { start: ["Invalid date"] });
  if (start.getTime() < Date.now() - 5 * 60_000) throw validation("The interview must be in the future.", { start: ["Choose a future time"] });
  const panel = [...new Set(input.panelUserIds)];
  return ctx.db(async (tx) => {
    const [a] = await tx
      .select({ a: applications, email: candidates.email, first: candidates.firstName, last: candidates.lastName, title: jobOpenings.title, company: tenants.name })
      .from(applications)
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .innerJoin(jobOpenings, eq(jobOpenings.id, applications.openingId))
      .innerJoin(tenants, eq(tenants.id, applications.tenantId))
      .where(eq(applications.id, input.applicationId))
      .for("update", { of: applications });
    if (!a) throw notFound("Application");
    if (a.a.status !== "active") throw invalidState(`This application is ${a.a.status}.`);
    const eligible = new Set(await usersWithPermission(tx, ctx.tenantId, "interviews.feedback"));
    const notEligible = panel.filter((u) => !eligible.has(u));
    if (notEligible.length) throw validation("Every interviewer needs the “Submit interview feedback” permission.", { panelUserIds: ["Someone on the panel cannot give feedback"] });
    if (input.scorecardTemplateId) {
      const [sc] = await tx.select({ id: scorecardTemplates.id }).from(scorecardTemplates).where(eq(scorecardTemplates.id, input.scorecardTemplateId));
      if (!sc) throw validation("Scorecard not found.", { scorecardTemplateId: ["Not found"] });
    }
    const conflicts = await findConflicts(tx, panel, start, end);
    if (conflicts.length && !input.allowConflicts) throw new InterviewConflictError(conflicts);

    const [iv] = await tx
      .insert(interviews)
      .values({
        tenantId: ctx.tenantId,
        applicationId: a.a.id,
        roundName: input.roundName,
        mode: input.mode,
        scheduledStart: start,
        scheduledEnd: end,
        location: input.location,
        meetingUrl: input.meetingUrl,
        scorecardTemplateId: input.scorecardTemplateId,
        createdBy: ctx.userId,
      })
      .returning();
    await tx.insert(interviewPanelists).values(panel.map((userId, i) => ({ tenantId: ctx.tenantId, interviewId: iv.id, userId, isLead: i === 0 })));

    const candidateName = fullName({ firstName: a.first, lastName: a.last });
    const when = formatIst(start);
    const where = input.mode === "onsite" ? (input.location ?? "") : (input.meetingUrl ?? input.location ?? "");
    await logEvent(tx, {
      tenantId: ctx.tenantId,
      applicationId: a.a.id,
      type: "interview_scheduled",
      actorUserId: ctx.userId,
      body: `${input.roundName} on ${when}`,
      metadata: { interviewId: iv.id, conflictsOverridden: conflicts.length },
    });
    await audit(tx, ctx, { action: "interview.scheduled", entityType: "interview", entityId: iv.id, metadata: { applicationId: a.a.id, panel: panel.length, conflictsOverridden: conflicts.length } });
    await notify(tx, {
      tenantId: ctx.tenantId,
      userIds: panel,
      category: "recruitment",
      title: `Interview: ${candidateName} · ${input.roundName}`,
      body: `${a.title} · ${when}`,
      href: `/recruitment/interviews/${iv.id}`,
      dedupeKey: `interview:${iv.id}:scheduled`,
    });
    const people = await tx.select({ id: users.id, email: users.email, name: users.fullName }).from(users).where(inArray(users.id, panel));
    const outboxIds: string[] = [];
    for (const p of people) {
      const { html, text } = renderEmail({
        title: `Interview scheduled: ${candidateName}`,
        body: [
          `You are on the panel for ${candidateName} (${a.title}), round “${input.roundName}”.`,
          `When: ${when} (${input.durationMinutes} minutes). ${input.mode === "onsite" ? "Venue" : "Join"}: ${where || "details in PeopleSuccess"}.`,
          "Please submit your scorecard in PeopleSuccess after the interview. Other panelists' feedback stays hidden until you submit yours.",
        ],
        cta: { label: "Open interview", href: appUrl(`/recruitment/interviews/${iv.id}`) },
      });
      const id = await enqueueEmail(tx, { tenantId: ctx.tenantId, to: p.email, template: "interview.panel", subject: `Interview: ${candidateName} · ${when}`, html, text, dedupeKey: `interview:${iv.id}:panel:${p.id}` });
      if (id) outboxIds.push(id);
    }
    if (input.notifyCandidate) {
      const id = await queueCandidateEmail(tx, {
        tenantId: ctx.tenantId,
        applicationId: a.a.id,
        to: a.email,
        companyName: a.company,
        subject: `Interview for ${a.title} at ${a.company}`,
        paragraphs: [
          `Hi ${a.first},`,
          `Your interview for ${a.title} (${input.roundName}) is scheduled for ${when} and will take about ${input.durationMinutes} minutes.`,
          input.mode === "onsite" ? `Venue: ${input.location}.` : input.meetingUrl ? `Join using this link: ${input.meetingUrl}` : "We will share the joining details shortly.",
          "If you need to reschedule, please reply to this email.",
        ],
        template: "candidate.interview_invite",
        actorUserId: ctx.userId,
        dedupeKey: `interview:${iv.id}:candidate`,
      });
      if (id) outboxIds.push(id);
    }
    return { id: iv.id, outboxIds, conflicts };
  });
}

export async function setInterviewStatus(ctx: RequestContext, input: { interviewId: string; status: "completed" | "cancelled" | "no_show"; reason: string | null }) {
  requireRecruitmentManage(ctx);
  return ctx.db(async (tx) => {
    const [iv] = await tx.select().from(interviews).where(eq(interviews.id, input.interviewId)).for("update");
    if (!iv) throw notFound("Interview");
    if (iv.status !== "scheduled") throw invalidState(`This interview is already ${iv.status.replace("_", " ")}.`);
    await tx.update(interviews).set({ status: input.status }).where(eq(interviews.id, iv.id));
    await logEvent(tx, { tenantId: ctx.tenantId, applicationId: iv.applicationId, type: `interview_${input.status}`, actorUserId: ctx.userId, body: input.reason ?? iv.roundName, metadata: { interviewId: iv.id } });
    await audit(tx, ctx, { action: `interview.${input.status}`, entityType: "interview", entityId: iv.id, metadata: { reason: input.reason } });
    if (input.status === "cancelled") {
      const panel = await tx.select({ userId: interviewPanelists.userId }).from(interviewPanelists).where(eq(interviewPanelists.interviewId, iv.id));
      await notify(tx, {
        tenantId: ctx.tenantId,
        userIds: panel.map((p) => p.userId),
        category: "recruitment",
        title: `Interview cancelled: ${iv.roundName}`,
        body: formatIst(iv.scheduledStart),
        href: `/recruitment/interviews/${iv.id}`,
        dedupeKey: `interview:${iv.id}:cancelled`,
      });
    }
  });
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

export type InterviewListItem = {
  id: string;
  roundName: string;
  mode: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
  candidateName: string;
  candidateId: string;
  openingTitle: string;
  openingId: string;
  meetingUrl: string | null;
  location: string | null;
  isPanelist: boolean;
  myFeedbackSubmitted: boolean;
};

async function interviewRows(tx: Tx, userId: string, where: ReturnType<typeof and>, limit = 200) {
  return tx
    .select({
      i: interviews,
      first: candidates.firstName,
      last: candidates.lastName,
      candidateId: candidates.id,
      title: jobOpenings.title,
      openingId: jobOpenings.id,
      isPanelist: sql<boolean>`exists (select 1 from interview_panelists p where p.interview_id = ${interviews.id} and p.user_id = ${userId})`,
      mine: sql<boolean>`exists (select 1 from interview_feedback f where f.interview_id = ${interviews.id} and f.interviewer_user_id = ${userId})`,
    })
    .from(interviews)
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(jobOpenings, eq(jobOpenings.id, applications.openingId))
    .where(where)
    .orderBy(asc(interviews.scheduledStart))
    .limit(limit);
}

const toItem = (r: Awaited<ReturnType<typeof interviewRows>>[number]): InterviewListItem => ({
  id: r.i.id,
  roundName: r.i.roundName,
  mode: r.i.mode,
  scheduledStart: r.i.scheduledStart.toISOString(),
  scheduledEnd: r.i.scheduledEnd.toISOString(),
  status: r.i.status,
  candidateName: fullName({ firstName: r.first, lastName: r.last }),
  candidateId: r.candidateId,
  openingTitle: r.title,
  openingId: r.openingId,
  meetingUrl: r.i.meetingUrl,
  location: r.i.location,
  isPanelist: r.isPanelist,
  myFeedbackSubmitted: r.mine,
});

/** The signed-in interviewer's upcoming interviews and those awaiting their feedback. */
export async function myInterviews(ctx: RequestContext) {
  if (!can(ctx, "interviews.feedback", "all") && !canViewRecruitment(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const mine = sql`exists (select 1 from interview_panelists p where p.interview_id = ${interviews.id} and p.user_id = ${ctx.userId})`;
    const now = new Date();
    const [upcoming, past] = await Promise.all([
      interviewRows(tx, ctx.userId, and(mine, eq(interviews.status, "scheduled"), gt(interviews.scheduledEnd, now))),
      interviewRows(tx, ctx.userId, and(mine, inArray(interviews.status, ["scheduled", "completed"]), lt(interviews.scheduledStart, now)), 300),
    ]);
    return {
      upcoming: upcoming.map(toItem),
      awaitingFeedback: past.map(toItem).filter((i) => !i.myFeedbackSubmitted),
    };
  });
}

/** All scheduled interviews in the next 30 days (recruitment viewers). */
export async function upcomingInterviews(ctx: RequestContext) {
  if (!canViewRecruitment(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const now = new Date();
    const rows = await interviewRows(tx, ctx.userId, and(eq(interviews.status, "scheduled"), gt(interviews.scheduledEnd, now), lt(interviews.scheduledStart, addMinutes(now, 60 * 24 * 30))));
    return rows.map(toItem);
  });
}

/* ------------------------------------------------------------------ */
/* Interview detail and feedback                                       */
/* ------------------------------------------------------------------ */

export type FeedbackView = {
  interviewerUserId: string;
  interviewerName: string;
  recommendation: string;
  overallRating: number;
  scores: { key: string; rating: number; notes?: string | null }[];
  strengths: string | null;
  concerns: string | null;
  submittedAt: string;
};

export type InterviewDetail = InterviewListItem & {
  applicationId: string;
  panel: { userId: string; name: string; isLead: boolean; submitted: boolean }[];
  criteria: ScorecardCriterion[];
  scorecardName: string | null;
  resume: { id: string; fileName: string } | null;
  candidate: { currentTitle: string | null; currentCompany: string | null; totalExperienceMonths: number | null; linkedinUrl: string | null };
  openingSkills: string[];
  myFeedback: FeedbackView | null;
  /** Other panelists' feedback; null when hidden (you have not submitted yet). */
  othersFeedback: FeedbackView[] | null;
  othersHiddenReason: string | null;
  canManage: boolean;
  canGiveFeedback: boolean;
  hasStarted: boolean;
};

const DEFAULT_CRITERIA: ScorecardCriterion[] = [
  { key: "role_skills", label: "Role-related skills" },
  { key: "problem_solving", label: "Problem solving" },
  { key: "communication", label: "Communication" },
];

export async function getInterview(ctx: RequestContext, interviewId: string): Promise<InterviewDetail> {
  const manage = canManageRecruitment(ctx);
  const view = canViewRecruitment(ctx);
  const detail = await ctx.db(async (tx) => {
    const rows = await interviewRows(tx, ctx.userId, eq(interviews.id, interviewId), 1);
    const r = rows[0];
    if (!r) throw notFound("Interview");
    if (!view && !r.isPanelist) throw forbidden("Only the interview panel and recruiters can open this interview.");
    const panel = await tx.select().from(interviewPanelists).where(eq(interviewPanelists.interviewId, interviewId));
    const names = await userNames(tx, panel.map((p) => p.userId));
    const [sc] = r.i.scorecardTemplateId ? await tx.select().from(scorecardTemplates).where(eq(scorecardTemplates.id, r.i.scorecardTemplateId)) : [];
    const [cand] = await tx
      .select({ currentTitle: candidates.currentTitle, currentCompany: candidates.currentCompany, totalExperienceMonths: candidates.totalExperienceMonths, linkedinUrl: candidates.linkedinUrl, resumeId: candidates.resumeDocumentId })
      .from(candidates)
      .where(eq(candidates.id, r.candidateId));
    const [resume] = cand?.resumeId ? await tx.select({ id: documents.id, fileName: documents.fileName }).from(documents).where(eq(documents.id, cand.resumeId)) : [];
    const [opening] = await tx.select({ skills: jobOpenings.skills }).from(jobOpenings).where(eq(jobOpenings.id, r.openingId));
    // Under RLS interviewers only ever read their own feedback row here.
    const [mine] = await tx.select().from(interviewFeedback).where(and(eq(interviewFeedback.interviewId, interviewId), eq(interviewFeedback.interviewerUserId, ctx.userId)));
    return { r, panel, names, sc, cand, resume, opening, mine };
  });
  const { r, panel, names, sc, cand, resume, opening, mine } = detail;
  const toView = (f: typeof interviewFeedback.$inferSelect): FeedbackView => ({
    interviewerUserId: f.interviewerUserId,
    interviewerName: names.get(f.interviewerUserId) ?? "Interviewer",
    recommendation: f.recommendation,
    overallRating: f.overallRating,
    scores: f.scores,
    strengths: f.strengths,
    concerns: f.concerns,
    submittedAt: f.submittedAt.toISOString(),
  });

  // Anchoring guard: panelists see colleagues' feedback only after submitting
  // their own; recruitment managers always see it. Non-panelist approvers
  // (offers.approve) can read it through RLS.
  let othersFeedback: FeedbackView[] | null = null;
  let othersHiddenReason: string | null = null;
  const mayReadAll = manage || (!r.isPanelist && can(ctx, "offers.approve", "all"));
  if (mayReadAll || (r.isPanelist && mine)) {
    // Panelists without recruiting rights cannot read others' rows under RLS,
    // so this read runs in system context after the check above.
    const all = await withSystem(
      (tx) => tx.select().from(interviewFeedback).where(and(eq(interviewFeedback.tenantId, ctx.tenantId), eq(interviewFeedback.interviewId, interviewId))).orderBy(desc(interviewFeedback.submittedAt)),
      ctx.tenantId,
    );
    othersFeedback = all.filter((f) => f.interviewerUserId !== ctx.userId).map(toView);
  } else if (r.isPanelist) {
    othersHiddenReason = "Submit your feedback to see what other panelists wrote. This keeps every scorecard independent.";
  } else {
    othersHiddenReason = "Feedback is visible to the panel and to recruitment managers.";
  }

  return {
    ...toItem(r),
    applicationId: r.i.applicationId,
    panel: panel.map((p) => ({ userId: p.userId, name: names.get(p.userId) ?? "Interviewer", isLead: p.isLead, submitted: p.userId === ctx.userId ? !!mine : !!othersFeedback?.some((f) => f.interviewerUserId === p.userId) })),
    criteria: sc?.criteria?.length ? sc.criteria : DEFAULT_CRITERIA,
    scorecardName: sc?.name ?? null,
    resume: resume ?? null,
    candidate: { currentTitle: cand?.currentTitle ?? null, currentCompany: cand?.currentCompany ?? null, totalExperienceMonths: cand?.totalExperienceMonths ?? null, linkedinUrl: cand?.linkedinUrl ?? null },
    openingSkills: opening?.skills ?? [],
    myFeedback: mine ? toView(mine) : null,
    othersFeedback,
    othersHiddenReason,
    canManage: manage,
    canGiveFeedback: r.isPanelist && can(ctx, "interviews.feedback", "all") && r.i.status !== "cancelled",
    hasStarted: r.i.scheduledStart.getTime() <= Date.now(),
  };
}

/** One scorecard per interviewer per interview (re-submitting updates it). */
export async function submitFeedback(ctx: RequestContext, input: FeedbackInput) {
  if (!can(ctx, "interviews.feedback", "all")) throw forbidden();
  const result = await ctx.db(async (tx) => {
    const [iv] = await tx.select().from(interviews).where(eq(interviews.id, input.interviewId));
    if (!iv) throw notFound("Interview");
    const [me] = await tx.select().from(interviewPanelists).where(and(eq(interviewPanelists.interviewId, iv.id), eq(interviewPanelists.userId, ctx.userId)));
    if (!me) throw forbidden("Only interviewers on this panel can submit feedback.");
    if (iv.status === "cancelled") throw invalidState("This interview was cancelled.");
    if (iv.scheduledStart.getTime() > Date.now()) throw invalidState("Feedback opens when the interview starts.");
    const values = {
      recommendation: input.recommendation,
      overallRating: input.overallRating,
      scores: input.scores.map((s) => ({ key: s.key, rating: s.rating, ...(s.notes ? { notes: s.notes } : {}) })),
      strengths: input.strengths,
      concerns: input.concerns,
      submittedAt: new Date(),
    };
    const [row] = await tx
      .insert(interviewFeedback)
      .values({ tenantId: ctx.tenantId, interviewId: iv.id, interviewerUserId: ctx.userId, ...values })
      .onConflictDoUpdate({ target: [interviewFeedback.interviewId, interviewFeedback.interviewerUserId], set: values })
      .returning({ id: interviewFeedback.id, createdAt: interviewFeedback.createdAt, updatedAt: interviewFeedback.updatedAt });
    const updated = row.updatedAt.getTime() - row.createdAt.getTime() > 1000;
    await logEvent(tx, {
      tenantId: ctx.tenantId,
      applicationId: iv.applicationId,
      type: updated ? "feedback_updated" : "feedback_submitted",
      actorUserId: ctx.userId,
      body: iv.roundName,
      metadata: { interviewId: iv.id },
    });
    await audit(tx, ctx, { action: updated ? "interview.feedback_updated" : "interview.feedback_submitted", entityType: "interview", entityId: iv.id });
    return { feedbackId: row.id, applicationId: iv.applicationId, interviewId: iv.id };
  });
  await recomputeRatings(ctx.tenantId, result.applicationId, result.interviewId);
  return result;
}

/**
 * Average overall rating on the application, and mark the interview
 * completed once every panelist has submitted. System context because
 * interviewers cannot read each other's rows; only aggregates are written.
 */
export async function recomputeRatings(tenantId: string, applicationId: string, interviewId: string) {
  await withSystem(async (tx) => {
    const [{ avg }] = await tx.execute<{ avg: string | null }>(sql`
      select round(avg(f.overall_rating)::numeric, 2)::text as avg
      from interview_feedback f join interviews i on i.id = f.interview_id
      where i.application_id = ${applicationId} and i.tenant_id = ${tenantId} and i.status <> 'cancelled'`);
    await tx
      .update(applications)
      .set({ averageRating: avg == null ? null : Number(avg) })
      .where(and(eq(applications.id, applicationId), eq(applications.tenantId, tenantId)));
    const [{ pending }] = await tx.execute<{ pending: number }>(sql`
      select count(*)::int as pending from interview_panelists p
      where p.interview_id = ${interviewId} and p.tenant_id = ${tenantId}
        and not exists (select 1 from interview_feedback f where f.interview_id = p.interview_id and f.interviewer_user_id = p.user_id)`);
    if (Number(pending) === 0) {
      await tx.update(interviews).set({ status: "completed" }).where(and(eq(interviews.id, interviewId), eq(interviews.tenantId, tenantId), eq(interviews.status, "scheduled")));
    }
  }, tenantId);
}

/* ------------------------------------------------------------------ */
/* Reminders (job)                                                     */
/* ------------------------------------------------------------------ */

/**
 * Remind panelists about interviews starting within the next 24 hours.
 * Idempotent: notification and email dedupe keys are per interview, user and
 * start time, so re-runs (and reschedules) never send duplicates.
 */
export async function sendInterviewReminders(tx: Tx, tenantId: string, now = new Date()) {
  const due = await tx
    .select({ i: interviews, first: candidates.firstName, last: candidates.lastName, title: jobOpenings.title })
    .from(interviews)
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(jobOpenings, eq(jobOpenings.id, applications.openingId))
    .where(and(eq(interviews.tenantId, tenantId), eq(interviews.status, "scheduled"), gt(interviews.scheduledStart, now), lt(interviews.scheduledStart, addMinutes(now, 24 * 60))))
    .limit(500);
  let sent = 0;
  for (const d of due) {
    const panel = await tx
      .select({ userId: interviewPanelists.userId, email: users.email })
      .from(interviewPanelists)
      .innerJoin(users, eq(users.id, interviewPanelists.userId))
      .where(eq(interviewPanelists.interviewId, d.i.id));
    const name = fullName({ firstName: d.first, lastName: d.last });
    const when = formatIst(d.i.scheduledStart);
    const stamp = d.i.scheduledStart.toISOString();
    for (const p of panel) {
      await notify(tx, {
        tenantId,
        userIds: [p.userId],
        category: "recruitment",
        title: `Reminder: interview with ${name}`,
        body: `${d.i.roundName} · ${when}`,
        href: `/recruitment/interviews/${d.i.id}`,
        dedupeKey: `interview-reminder:${d.i.id}:${stamp}`,
      });
      const { html, text } = renderEmail({
        title: `Reminder: interview with ${name}`,
        body: [`${d.i.roundName} for ${d.title} starts ${when}.`, d.i.meetingUrl ? `Join: ${d.i.meetingUrl}` : d.i.location ? `Venue: ${d.i.location}` : ""].filter(Boolean),
      });
      const id = await enqueueEmail(tx, { tenantId, to: p.email, template: "interview.reminder", subject: `Reminder: ${name} · ${when}`, html, text, dedupeKey: `interview-reminder:${d.i.id}:${p.userId}:${stamp}` });
      if (id) sent++;
    }
  }
  return { interviews: due.length, emails: sent };
}
