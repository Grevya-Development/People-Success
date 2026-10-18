import "server-only";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { RequestContext } from "../../auth/context";
import type { Tx } from "../../db/client";
import { applications, candidates, interviews, jobOpenings, offers, recruitmentStages, referrals, tenants } from "../../db/schema";
import { audit } from "../../lib/audit";
import { invalidState, notFound } from "../../lib/errors";
import { emitDomainEvent } from "../events";
import { queueCandidateEmail } from "./messaging";
import { activeStages, fullName, logEvent, requireRecruitmentManage, requireRecruitmentView } from "./shared";

type StageRow = typeof recruitmentStages.$inferSelect;

export type BoardCard = {
  applicationId: string;
  candidateId: string;
  name: string;
  currentTitle: string | null;
  currentCompany: string | null;
  source: string;
  tags: string[];
  stageId: string;
  status: string;
  appliedAt: string;
  stageEnteredAt: string;
  averageRating: number | null;
  hasAiSummary: boolean;
  nextInterviewAt: string | null;
  referred: boolean;
};

export type Board = {
  stages: { id: string; name: string; kind: string }[];
  cards: BoardCard[];
  closed: BoardCard[];
};

/**
 * Pipeline for an opening. Cards are listed in the order they entered their
 * stage (oldest first) — never sorted by AI output or ratings.
 */
export async function getBoard(ctx: RequestContext, openingId: string): Promise<Board> {
  requireRecruitmentView(ctx);
  return ctx.db(async (tx) => {
    const [o] = await tx.select({ id: jobOpenings.id }).from(jobOpenings).where(eq(jobOpenings.id, openingId));
    if (!o) throw notFound("Job opening");
    const stages = await activeStages(tx, ctx.tenantId);
    const rows = await tx
      .select({
        a: applications,
        c: { id: candidates.id, firstName: candidates.firstName, lastName: candidates.lastName, currentTitle: candidates.currentTitle, currentCompany: candidates.currentCompany, tags: candidates.tags },
        nextInterviewAt: sql<string | null>`(select min(i.scheduled_start) from interviews i where i.application_id = ${applications.id} and i.status = 'scheduled' and i.scheduled_start > now())`,
      })
      .from(applications)
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .where(eq(applications.openingId, openingId))
      .orderBy(asc(applications.stageEnteredAt))
      .limit(2000);
    const toCard = ({ a, c, nextInterviewAt }: (typeof rows)[number]): BoardCard => ({
      applicationId: a.id,
      candidateId: c.id,
      name: fullName(c),
      currentTitle: c.currentTitle,
      currentCompany: c.currentCompany,
      source: a.source,
      tags: c.tags,
      stageId: a.stageId,
      status: a.status,
      appliedAt: a.appliedAt.toISOString(),
      stageEnteredAt: a.stageEnteredAt.toISOString(),
      averageRating: a.averageRating,
      hasAiSummary: !!a.aiSummary,
      nextInterviewAt: nextInterviewAt ? new Date(nextInterviewAt).toISOString() : null,
      referred: !!a.referralId,
    });
    return {
      stages: stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
      cards: rows.filter((r) => r.a.status === "active" || r.a.status === "hired").map(toCard),
      closed: rows.filter((r) => r.a.status === "rejected" || r.a.status === "withdrawn").map(toCard),
    };
  });
}

async function lockApplication(tx: Tx, id: string) {
  const [a] = await tx.select().from(applications).where(eq(applications.id, id)).for("update");
  if (!a) throw notFound("Application");
  return a;
}

/** Keep the referral's status in step with the application it produced. */
export async function syncReferralStatus(tx: Tx, application: { id: string; referralId: string | null; status: string }, stage: StageRow | null) {
  if (!application.referralId) return;
  let status: (typeof referrals.$inferSelect)["status"] | null = null;
  if (application.status === "hired") status = "hired";
  else if (application.status === "rejected") status = "rejected";
  else if (application.status === "withdrawn") status = "withdrawn";
  else if (stage) {
    if (["interview", "final", "offer"].includes(stage.kind)) status = "interviewing";
    else if (stage.kind !== "applied") status = "in_review";
  }
  if (!status) return;
  await tx
    .update(referrals)
    .set({ status })
    .where(and(eq(referrals.id, application.referralId), sql`${referrals.status} not in ('duplicate','hired')`));
}

export async function moveApplicationStage(ctx: RequestContext, input: { applicationId: string; stageId: string; note: string | null }) {
  requireRecruitmentManage(ctx);
  return ctx.db(async (tx) => {
    const a = await lockApplication(tx, input.applicationId);
    if (a.status !== "active") throw invalidState(`This application is ${a.status}; reopen it before moving it.`);
    const [to] = await tx.select().from(recruitmentStages).where(eq(recruitmentStages.id, input.stageId));
    if (!to || !to.isActive) throw notFound("Stage");
    if (to.id === a.stageId) return { applicationId: a.id, stageId: to.id, unchanged: true };
    if (to.kind === "hired") throw invalidState("Candidates move to Hired automatically when they accept an offer.");
    const now = new Date();
    await tx.update(applications).set({ stageId: to.id, stageEnteredAt: now }).where(eq(applications.id, a.id));
    await logEvent(tx, { tenantId: ctx.tenantId, applicationId: a.id, type: "stage_changed", actorUserId: ctx.userId, fromStageId: a.stageId, toStageId: to.id, body: input.note });
    await syncReferralStatus(tx, a, to);
    await audit(tx, ctx, { action: "application.stage_changed", entityType: "application", entityId: a.id, metadata: { fromStageId: a.stageId, toStageId: to.id } });
    await emitDomainEvent(tx, ctx.tenantId, "candidate.stage_changed", {
      applicationId: a.id,
      candidateId: a.candidateId,
      openingId: a.openingId,
      fromStageId: a.stageId,
      toStageId: to.id,
      toStageKind: to.kind,
      toStageName: to.name,
    });
    return { applicationId: a.id, stageId: to.id, unchanged: false };
  });
}

async function closeOpenWork(tx: Tx, applicationId: string) {
  const [live] = await tx
    .select({ id: offers.id, status: offers.status })
    .from(offers)
    .where(and(eq(offers.applicationId, applicationId), inArray(offers.status, ["sent", "accepted"])));
  if (live) throw invalidState(live.status === "accepted" ? "This candidate accepted an offer." : "An offer is out with this candidate. Rescind it first.");
  await tx
    .update(offers)
    .set({ status: "rescinded", responseNote: "Application closed" })
    .where(and(eq(offers.applicationId, applicationId), inArray(offers.status, ["draft", "approved"])));
  await tx
    .update(interviews)
    .set({ status: "cancelled" })
    .where(and(eq(interviews.applicationId, applicationId), eq(interviews.status, "scheduled"), gt(interviews.scheduledStart, new Date())));
}

/**
 * Reject an application with an internal reason. A rejection email is sent
 * only when the recruiter explicitly asks for it (never automatically).
 */
export async function rejectApplication(ctx: RequestContext, input: { applicationId: string; reason: string; sendEmail: boolean; emailBody: string | null }) {
  requireRecruitmentManage(ctx);
  return ctx.db(async (tx) => {
    const a = await lockApplication(tx, input.applicationId);
    if (a.status !== "active") throw invalidState(`This application is already ${a.status}.`);
    const [pending] = await tx.select({ id: offers.id }).from(offers).where(and(eq(offers.applicationId, a.id), eq(offers.status, "pending_approval")));
    if (pending) throw invalidState("An offer for this candidate is awaiting approval. Rescind it first.");
    await closeOpenWork(tx, a.id);
    await tx.update(applications).set({ status: "rejected", rejectionReason: input.reason, decidedAt: new Date() }).where(eq(applications.id, a.id));
    await logEvent(tx, { tenantId: ctx.tenantId, applicationId: a.id, type: "rejected", actorUserId: ctx.userId, body: input.reason });
    await syncReferralStatus(tx, { ...a, status: "rejected" }, null);
    await audit(tx, ctx, { action: "application.rejected", entityType: "application", entityId: a.id });
    let outboxId: string | null = null;
    if (input.sendEmail && input.emailBody) {
      const [info] = await tx
        .select({ email: candidates.email, title: jobOpenings.title, company: tenants.name })
        .from(applications)
        .innerJoin(candidates, eq(candidates.id, applications.candidateId))
        .innerJoin(jobOpenings, eq(jobOpenings.id, applications.openingId))
        .innerJoin(tenants, eq(tenants.id, applications.tenantId))
        .where(eq(applications.id, a.id));
      outboxId = await queueCandidateEmail(tx, {
        tenantId: ctx.tenantId,
        applicationId: a.id,
        to: info.email,
        companyName: info.company,
        subject: `Your application for ${info.title}`,
        paragraphs: input.emailBody.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
        template: "candidate.rejection",
        actorUserId: ctx.userId,
        dedupeKey: `rejection:${a.id}`,
      });
    }
    return { applicationId: a.id, outboxId };
  });
}

export async function withdrawApplication(ctx: RequestContext, input: { applicationId: string; reason: string | null }) {
  requireRecruitmentManage(ctx);
  return ctx.db(async (tx) => {
    const a = await lockApplication(tx, input.applicationId);
    if (a.status !== "active") throw invalidState(`This application is already ${a.status}.`);
    const [pending] = await tx.select({ id: offers.id }).from(offers).where(and(eq(offers.applicationId, a.id), eq(offers.status, "pending_approval")));
    if (pending) throw invalidState("An offer for this candidate is awaiting approval. Rescind it first.");
    await closeOpenWork(tx, a.id);
    await tx.update(applications).set({ status: "withdrawn", rejectionReason: input.reason, decidedAt: new Date() }).where(eq(applications.id, a.id));
    await logEvent(tx, { tenantId: ctx.tenantId, applicationId: a.id, type: "withdrawn", actorUserId: ctx.userId, body: input.reason ?? "Candidate withdrew." });
    await syncReferralStatus(tx, { ...a, status: "withdrawn" }, null);
    await audit(tx, ctx, { action: "application.withdrawn", entityType: "application", entityId: a.id });
    return { applicationId: a.id };
  });
}

/** Return a rejected or withdrawn application to the pipeline (same stage). */
export async function reopenApplication(ctx: RequestContext, applicationId: string) {
  requireRecruitmentManage(ctx);
  return ctx.db(async (tx) => {
    const a = await lockApplication(tx, applicationId);
    if (a.status !== "rejected" && a.status !== "withdrawn") throw invalidState("Only rejected or withdrawn applications can be reopened.");
    const [o] = await tx.select({ status: jobOpenings.status }).from(jobOpenings).where(eq(jobOpenings.id, a.openingId));
    if (o?.status === "closed") throw invalidState("The job is closed.");
    await tx.update(applications).set({ status: "active", decidedAt: null, rejectionReason: null, stageEnteredAt: new Date() }).where(eq(applications.id, a.id));
    await logEvent(tx, { tenantId: ctx.tenantId, applicationId: a.id, type: "reopened", actorUserId: ctx.userId });
    if (a.referralId) await tx.update(referrals).set({ status: "in_review" }).where(and(eq(referrals.id, a.referralId), inArray(referrals.status, ["rejected", "withdrawn"])));
    await audit(tx, ctx, { action: "application.reopened", entityType: "application", entityId: a.id });
    return { applicationId: a.id };
  });
}

export async function addApplicationNote(ctx: RequestContext, input: { applicationId: string; body: string }) {
  requireRecruitmentView(ctx);
  return ctx.db(async (tx) => {
    const [a] = await tx.select({ id: applications.id }).from(applications).where(eq(applications.id, input.applicationId));
    if (!a) throw notFound("Application");
    await logEvent(tx, { tenantId: ctx.tenantId, applicationId: a.id, type: "note", actorUserId: ctx.userId, body: input.body });
    return { applicationId: a.id };
  });
}

/** Send a one-off email to the candidate (logged on the timeline). */
export async function emailCandidate(ctx: RequestContext, input: { applicationId: string; subject: string; body: string }) {
  requireRecruitmentManage(ctx);
  return ctx.db(async (tx) => {
    const [info] = await tx
      .select({ id: applications.id, email: candidates.email, company: tenants.name })
      .from(applications)
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .innerJoin(tenants, eq(tenants.id, applications.tenantId))
      .where(eq(applications.id, input.applicationId));
    if (!info) throw notFound("Application");
    const outboxId = await queueCandidateEmail(tx, {
      tenantId: ctx.tenantId,
      applicationId: info.id,
      to: info.email,
      companyName: info.company,
      subject: input.subject,
      paragraphs: input.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
      template: "candidate.message",
      actorUserId: ctx.userId,
    });
    await audit(tx, ctx, { action: "application.emailed", entityType: "application", entityId: info.id, metadata: { subject: input.subject } });
    return { outboxId };
  });
}

/** Applications in a stage of kind "offer" without a live offer (offer creation picker). */
export async function applicationsReadyForOffer(ctx: RequestContext) {
  requireRecruitmentView(ctx);
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ id: applications.id, first: candidates.firstName, last: candidates.lastName, title: jobOpenings.title })
      .from(applications)
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .innerJoin(jobOpenings, eq(jobOpenings.id, applications.openingId))
      .innerJoin(recruitmentStages, eq(recruitmentStages.id, applications.stageId))
      .where(
        and(
          eq(applications.status, "active"),
          eq(recruitmentStages.kind, "offer"),
          sql`not exists (select 1 from offers o where o.application_id = ${applications.id} and o.status in ('draft','pending_approval','approved','sent','accepted'))`,
        ),
      )
      .orderBy(desc(applications.stageEnteredAt))
      .limit(200);
    return rows.map((r) => ({ value: r.id, label: `${[r.first, r.last].filter(Boolean).join(" ")} · ${r.title}` }));
  });
}
