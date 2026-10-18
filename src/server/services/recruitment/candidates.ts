import "server-only";
import { aliasedTable, and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { RequestContext } from "../../auth/context";
import {
  applicationEvents,
  applications,
  candidates,
  documents,
  interviewFeedback,
  interviewPanelists,
  interviews,
  jobOpenings,
  offers,
  recruitmentStages,
  referrals,
  talentPoolMembers,
  talentPools,
  employees,
} from "../../db/schema";
import type { ApplicationAiSummary, ParsedResume } from "../../db/schema/recruitment";
import { audit, diff } from "../../lib/audit";
import { conflict, notFound } from "../../lib/errors";
import { todayIn } from "@/lib/format";
import { CANDIDATE_RETENTION_MONTHS, type CandidateListQuery, type ManualCandidateInput } from "@/lib/validation/recruitment";
import { canManageRecruitment, canSeeOffers, firstStage, fullName, logEvent, requireRecruitmentManage, requireRecruitmentView, retainUntilFrom, userNames } from "./shared";

const PAGE_SIZE = 50;

export type CandidateListItem = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  source: string;
  tags: string[];
  applications: number;
  latest: { openingTitle: string; stage: string; status: string; appliedAt: string } | null;
  createdAt: string;
};

export async function listCandidates(ctx: RequestContext, q: CandidateListQuery) {
  requireRecruitmentView(ctx);
  const where: SQL[] = [];
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    // Same expression as the trigram index candidates_search_trgm.
    where.push(sql`(${candidates.firstName} || ' ' || coalesce(${candidates.lastName}, '') || ' ' || ${candidates.email}) ilike ${like}`);
  }
  if (q.source) where.push(eq(candidates.source, q.source));
  if (q.tag) where.push(sql`${candidates.tags} @> array[${q.tag}]::text[]`);
  if (q.poolId) where.push(sql`exists (select 1 from talent_pool_members m where m.candidate_id = "candidates"."id" and m.pool_id = ${q.poolId})`);
  const cond = where.length ? and(...where) : undefined;
  return ctx.db(async (tx) => {
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(candidates).where(cond);
    const rows = await tx
      .select({
        c: candidates,
        apps: sql<number>`(select count(*)::int from applications a where a.candidate_id = "candidates"."id")`,
        latest: sql<{ openingTitle: string; stage: string; status: string; appliedAt: string } | null>`(
          select json_build_object('openingTitle', o.title, 'stage', s.name, 'status', a.status, 'appliedAt', a.applied_at)
          from applications a join job_openings o on o.id = a.opening_id join recruitment_stages s on s.id = a.stage_id
          where a.candidate_id = "candidates"."id" order by a.applied_at desc limit 1)`,
      })
      .from(candidates)
      .where(cond)
      .orderBy(desc(candidates.updatedAt))
      .limit(PAGE_SIZE)
      .offset((q.page - 1) * PAGE_SIZE);
    const items: CandidateListItem[] = rows.map(({ c, apps, latest }) => ({
      id: c.id,
      name: fullName(c),
      email: c.email,
      phone: c.phone,
      currentTitle: c.currentTitle,
      currentCompany: c.currentCompany,
      source: c.source,
      tags: c.tags,
      applications: apps,
      latest,
      createdAt: c.createdAt.toISOString(),
    }));
    return { items, total, page: q.page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
  });
}

export async function candidateFilterOptions(ctx: RequestContext) {
  requireRecruitmentView(ctx);
  return ctx.db(async (tx) => {
    const [pools, tags] = await Promise.all([
      tx.select({ id: talentPools.id, name: talentPools.name, description: talentPools.description, members: sql<number>`(select count(*)::int from talent_pool_members m where m.pool_id = "talent_pools"."id")` }).from(talentPools).orderBy(asc(talentPools.name)),
      tx.execute<{ tag: string }>(sql`select distinct unnest(tags) as tag from candidates where tenant_id = ${ctx.tenantId} order by 1 limit 200`),
    ]);
    return { pools, tags: [...tags].map((t) => t.tag) };
  });
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export type TimelineEvent = {
  id: string;
  type: string;
  body: string | null;
  fromStage: string | null;
  toStage: string | null;
  actorName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type CandidateApplication = {
  id: string;
  opening: { id: string; title: string; skills: string[] };
  stage: { id: string; name: string; kind: string };
  status: string;
  source: string;
  appliedAt: string;
  decidedAt: string | null;
  averageRating: number | null;
  rejectionReason: string | null;
  coverNote: string | null;
  answers: { label: string; answer: string }[];
  aiSummary: ApplicationAiSummary | null;
  referral: { id: string; referrerName: string | null; status: string } | null;
  events: TimelineEvent[];
  interviews: {
    id: string;
    roundName: string;
    mode: string;
    scheduledStart: string;
    scheduledEnd: string;
    status: string;
    panel: { userId: string; name: string; submitted: boolean }[];
  }[];
  offers: { id: string; version: number; status: string; joiningDate: string; createdAt: string }[];
};

export type CandidateProfile = {
  id: string;
  firstName: string;
  lastName: string | null;
  name: string;
  email: string;
  phone: string | null;
  currentCompany: string | null;
  currentTitle: string | null;
  totalExperienceMonths: number | null;
  city: string | null;
  linkedinUrl: string | null;
  source: string;
  sourceDetail: string | null;
  tags: string[];
  consentAt: string | null;
  retainUntil: string | null;
  employeeId: string | null;
  employeeName: string | null;
  parsedProfile: ParsedResume | null;
  resume: { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string } | null;
  pools: { id: string; name: string; member: boolean }[];
  applications: CandidateApplication[];
  canManage: boolean;
  canSeeOffers: boolean;
};

const fromStage = aliasedTable(recruitmentStages, "from_stage");
const toStage = aliasedTable(recruitmentStages, "to_stage");

export async function getCandidate(ctx: RequestContext, id: string): Promise<CandidateProfile> {
  requireRecruitmentView(ctx);
  const showOffers = canSeeOffers(ctx);
  return ctx.db(async (tx) => {
    const [c] = await tx.select().from(candidates).where(eq(candidates.id, id));
    if (!c) throw notFound("Candidate");
    const [resume] = c.resumeDocumentId
      ? await tx
          .select({ id: documents.id, fileName: documents.fileName, mimeType: documents.mimeType, sizeBytes: documents.sizeBytes, createdAt: documents.createdAt })
          .from(documents)
          .where(and(eq(documents.id, c.resumeDocumentId), sql`${documents.deletedAt} is null`))
      : [];
    const [emp] = c.employeeId ? await tx.select({ name: employees.displayName }).from(employees).where(eq(employees.id, c.employeeId)) : [];
    const pools = await tx
      .select({ id: talentPools.id, name: talentPools.name, member: sql<boolean>`exists (select 1 from talent_pool_members m where m.pool_id = "talent_pools"."id" and m.candidate_id = ${c.id})` })
      .from(talentPools)
      .orderBy(asc(talentPools.name));
    const apps = await tx
      .select({ a: applications, o: { id: jobOpenings.id, title: jobOpenings.title, skills: jobOpenings.skills, questions: jobOpenings.questions }, s: { id: recruitmentStages.id, name: recruitmentStages.name, kind: recruitmentStages.kind } })
      .from(applications)
      .innerJoin(jobOpenings, eq(jobOpenings.id, applications.openingId))
      .innerJoin(recruitmentStages, eq(recruitmentStages.id, applications.stageId))
      .where(eq(applications.candidateId, c.id))
      .orderBy(desc(applications.appliedAt));
    const appIds = apps.map((x) => x.a.id);
    const [events, ivs, refs, offerRows] = await Promise.all([
      appIds.length
        ? tx
            .select({ e: applicationEvents, from: fromStage.name, to: toStage.name })
            .from(applicationEvents)
            .leftJoin(fromStage, eq(fromStage.id, applicationEvents.fromStageId))
            .leftJoin(toStage, eq(toStage.id, applicationEvents.toStageId))
            .where(inArray(applicationEvents.applicationId, appIds))
            .orderBy(desc(applicationEvents.createdAt))
            .limit(500)
        : [],
      appIds.length ? tx.select().from(interviews).where(inArray(interviews.applicationId, appIds)).orderBy(asc(interviews.scheduledStart)) : [],
      appIds.length ? tx.select().from(referrals).where(inArray(referrals.applicationId, appIds)) : [],
      appIds.length && showOffers
        ? tx
            .select({ id: offers.id, applicationId: offers.applicationId, version: offers.version, status: offers.status, joiningDate: offers.joiningDate, createdAt: offers.createdAt })
            .from(offers)
            .where(inArray(offers.applicationId, appIds))
            .orderBy(desc(offers.version))
        : [],
    ]);
    const ivIds = ivs.map((i) => i.id);
    const [panel, submitted] = ivIds.length
      ? await Promise.all([
          tx.select().from(interviewPanelists).where(inArray(interviewPanelists.interviewId, ivIds)),
          // Only whether feedback exists (not its content): readable to recruitment managers under RLS.
          tx.select({ interviewId: interviewFeedback.interviewId, userId: interviewFeedback.interviewerUserId }).from(interviewFeedback).where(inArray(interviewFeedback.interviewId, ivIds)),
        ])
      : [[], []];
    const referrerIds = refs.map((r) => r.referrerEmployeeId);
    const referrerNames = referrerIds.length
      ? new Map((await tx.select({ id: employees.id, name: employees.displayName }).from(employees).where(inArray(employees.id, referrerIds))).map((r) => [r.id, r.name]))
      : new Map<string, string>();
    const names = await userNames(tx, [...events.map((e) => e.e.actorUserId), ...panel.map((p) => p.userId)]);
    const done = new Set(submitted.map((s) => `${s.interviewId}:${s.userId}`));

    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      name: fullName(c),
      email: c.email,
      phone: c.phone,
      currentCompany: c.currentCompany,
      currentTitle: c.currentTitle,
      totalExperienceMonths: c.totalExperienceMonths,
      city: c.city,
      linkedinUrl: c.linkedinUrl,
      source: c.source,
      sourceDetail: c.sourceDetail,
      tags: c.tags,
      consentAt: c.consentAt?.toISOString() ?? null,
      retainUntil: c.retainUntil,
      employeeId: c.employeeId,
      employeeName: emp?.name ?? null,
      parsedProfile: c.parsedProfile,
      resume: resume ? { id: resume.id, fileName: resume.fileName, mimeType: resume.mimeType, sizeBytes: resume.sizeBytes, uploadedAt: resume.createdAt.toISOString() } : null,
      pools,
      canManage: canManageRecruitment(ctx),
      canSeeOffers: showOffers,
      applications: apps.map(({ a, o, s }) => {
        const ref = refs.find((r) => r.applicationId === a.id);
        return {
          id: a.id,
          opening: { id: o.id, title: o.title, skills: o.skills },
          stage: s,
          status: a.status,
          source: a.source,
          appliedAt: a.appliedAt.toISOString(),
          decidedAt: a.decidedAt?.toISOString() ?? null,
          averageRating: a.averageRating,
          rejectionReason: a.rejectionReason,
          coverNote: a.coverNote,
          answers: o.questions.filter((q) => a.answers[q.id]).map((q) => ({ label: q.label, answer: a.answers[q.id] })),
          aiSummary: a.aiSummary,
          referral: ref ? { id: ref.id, referrerName: referrerNames.get(ref.referrerEmployeeId) ?? null, status: ref.status } : null,
          events: events
            .filter((e) => e.e.applicationId === a.id)
            .map(({ e, from, to }) => ({
              id: e.id,
              type: e.type,
              body: e.body,
              fromStage: from,
              toStage: to,
              actorName: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null,
              metadata: e.metadata,
              createdAt: e.createdAt.toISOString(),
            })),
          interviews: ivs
            .filter((i) => i.applicationId === a.id)
            .map((i) => ({
              id: i.id,
              roundName: i.roundName,
              mode: i.mode,
              scheduledStart: i.scheduledStart.toISOString(),
              scheduledEnd: i.scheduledEnd.toISOString(),
              status: i.status,
              panel: panel
                .filter((p) => p.interviewId === i.id)
                .map((p) => ({ userId: p.userId, name: names.get(p.userId) ?? "Interviewer", submitted: done.has(`${i.id}:${p.userId}`) })),
            })),
          offers: offerRows.filter((x) => x.applicationId === a.id).map((x) => ({ id: x.id, version: x.version, status: x.status, joiningDate: x.joiningDate, createdAt: x.createdAt.toISOString() })),
        };
      }),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export async function updateCandidateTags(ctx: RequestContext, candidateId: string, tags: string[]) {
  requireRecruitmentManage(ctx);
  return ctx.db(async (tx) => {
    const [c] = await tx.select({ tags: candidates.tags }).from(candidates).where(eq(candidates.id, candidateId)).for("update");
    if (!c) throw notFound("Candidate");
    await tx.update(candidates).set({ tags }).where(eq(candidates.id, candidateId));
    await audit(tx, ctx, { action: "candidate.tags_updated", entityType: "candidate", entityId: candidateId, changes: diff({ tags: c.tags }, { tags }) });
  });
}

export async function createTalentPool(ctx: RequestContext, input: { name: string; description: string | null }) {
  requireRecruitmentManage(ctx);
  return ctx.db(async (tx) => {
    const [p] = await tx.insert(talentPools).values({ tenantId: ctx.tenantId, name: input.name, description: input.description }).returning({ id: talentPools.id });
    await audit(tx, ctx, { action: "talent_pool.created", entityType: "talent_pool", entityId: p.id, metadata: { name: input.name } });
    return p;
  });
}

export async function setPoolMembership(ctx: RequestContext, input: { poolId: string; candidateId: string; remove?: boolean }) {
  requireRecruitmentManage(ctx);
  return ctx.db(async (tx) => {
    const [pool] = await tx.select({ id: talentPools.id }).from(talentPools).where(eq(talentPools.id, input.poolId));
    const [c] = await tx.select({ id: candidates.id }).from(candidates).where(eq(candidates.id, input.candidateId));
    if (!pool) throw notFound("Talent pool");
    if (!c) throw notFound("Candidate");
    if (input.remove) {
      await tx.delete(talentPoolMembers).where(and(eq(talentPoolMembers.poolId, input.poolId), eq(talentPoolMembers.candidateId, input.candidateId)));
    } else {
      await tx.insert(talentPoolMembers).values({ tenantId: ctx.tenantId, poolId: input.poolId, candidateId: input.candidateId, addedBy: ctx.userId }).onConflictDoNothing();
    }
    await audit(tx, ctx, { action: input.remove ? "talent_pool.member_removed" : "talent_pool.member_added", entityType: "talent_pool", entityId: input.poolId, metadata: { candidateId: input.candidateId } });
  });
}

/**
 * Add a candidate sourced by a recruiter (agency, job board, direct). The
 * recruiter confirms the candidate agreed to be considered (DPDP consent).
 * Optionally applies them to an opening at the first stage.
 */
export async function createManualCandidate(ctx: RequestContext, input: ManualCandidateInput) {
  requireRecruitmentManage(ctx);
  return ctx.db(async (tx) => {
    const [existing] = await tx.select({ id: candidates.id }).from(candidates).where(sql`lower(${candidates.email}) = ${input.email}`);
    if (existing) throw conflict("A candidate with this email already exists. Open their profile to add them to a job.");
    const retainUntil = retainUntilFrom(todayIn(), CANDIDATE_RETENTION_MONTHS);
    const [c] = await tx
      .insert(candidates)
      .values({
        tenantId: ctx.tenantId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        currentCompany: input.currentCompany,
        currentTitle: input.currentTitle,
        totalExperienceMonths: input.experienceYears == null ? null : input.experienceYears * 12,
        linkedinUrl: input.linkedinUrl,
        source: input.source,
        sourceDetail: input.sourceDetail,
        consentAt: new Date(),
        retainUntil,
        createdBy: ctx.userId,
      })
      .returning({ id: candidates.id });
    await audit(tx, ctx, { action: "candidate.created", entityType: "candidate", entityId: c.id, metadata: { source: input.source, consentConfirmedBy: ctx.userId } });
    let applicationId: string | null = null;
    if (input.openingId) applicationId = (await applyInTx(tx, ctx, c.id, input.openingId, input.source)).id;
    return { id: c.id, applicationId };
  });
}

async function applyInTx(tx: Parameters<Parameters<RequestContext["db"]>[0]>[0], ctx: RequestContext, candidateId: string, openingId: string, source: string) {
  const [o] = await tx.select({ id: jobOpenings.id, status: jobOpenings.status, title: jobOpenings.title }).from(jobOpenings).where(eq(jobOpenings.id, openingId));
  if (!o) throw notFound("Job opening");
  if (o.status === "closed") throw conflict("This job is closed.");
  const [dup] = await tx.select({ id: applications.id }).from(applications).where(and(eq(applications.openingId, openingId), eq(applications.candidateId, candidateId)));
  if (dup) throw conflict("This candidate already has an application for this job.");
  const stage = await firstStage(tx, ctx.tenantId);
  const [a] = await tx
    .insert(applications)
    .values({ tenantId: ctx.tenantId, candidateId, openingId, stageId: stage.id, source })
    .returning({ id: applications.id });
  await logEvent(tx, { tenantId: ctx.tenantId, applicationId: a.id, type: "applied", actorUserId: ctx.userId, toStageId: stage.id, body: `Added to ${o.title} by a recruiter.`, metadata: { source } });
  await audit(tx, ctx, { action: "application.created", entityType: "application", entityId: a.id, metadata: { openingId, candidateId, source } });
  return a;
}

export async function applyCandidateToOpening(ctx: RequestContext, candidateId: string, openingId: string) {
  requireRecruitmentManage(ctx);
  return ctx.db(async (tx) => {
    const [c] = await tx.select({ id: candidates.id, source: candidates.source }).from(candidates).where(eq(candidates.id, candidateId));
    if (!c) throw notFound("Candidate");
    return applyInTx(tx, ctx, candidateId, openingId, c.source === "career_page" ? "sourced" : c.source);
  });
}
