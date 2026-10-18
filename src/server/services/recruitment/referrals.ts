import "server-only";
import { subMonths } from "date-fns";
import { and, asc, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { can, type RequestContext } from "../../auth/context";
import type { Tx } from "../../db/client";
import { withSystem } from "../../db/tx";
import {
  applications,
  candidates,
  departments,
  employees,
  jobOpenings,
  locations,
  payrollInputs,
  payrollPeriods,
  recruitmentStages,
  referralRewardPolicies,
  referrals,
} from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { forbidden, invalidState, notFound, validation } from "../../lib/errors";
import { notify } from "../notifications";
import { userIdForEmployee } from "../directory";
import { todayIn } from "@/lib/format";
import { CANDIDATE_RETENTION_MONTHS, type ReferralInput } from "@/lib/validation/recruitment";
import { notifyRecruiters } from "./messaging";
import { discardResume, insertResumeDocument, stageResume, type StagedResume } from "./resumes";
import { firstStage, fullName, logEvent, retainUntilFrom, toPaise, usersWithPermission } from "./shared";

export const canManageReferrals = (ctx: RequestContext) => can(ctx, "referrals.manage", "all");

/* ------------------------------------------------------------------ */
/* Portal (any employee)                                               */
/* ------------------------------------------------------------------ */

export type ReferralJob = { id: string; title: string; department: string | null; location: string | null; workMode: string; employmentType: string; skills: string[]; publishedAt: string | null };

/** Published jobs, with only the fields an employee needs to refer someone. */
export async function referralJobs(ctx: RequestContext): Promise<ReferralJob[]> {
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ o: jobOpenings, department: departments.name, location: locations.name })
      .from(jobOpenings)
      .leftJoin(departments, eq(departments.id, jobOpenings.departmentId))
      .leftJoin(locations, eq(locations.id, jobOpenings.locationId))
      .where(and(eq(jobOpenings.status, "published"), sql`(${jobOpenings.closesOn} is null or ${jobOpenings.closesOn} >= ${todayIn()}::date)`))
      .orderBy(desc(jobOpenings.publishedAt))
      .limit(200);
    return rows.map(({ o, department, location }) => ({ id: o.id, title: o.title, department, location, workMode: o.workMode, employmentType: o.employmentType, skills: o.skills, publishedAt: o.publishedAt?.toISOString() ?? null }));
  });
}

export type ReferralResult = { referralId: string; status: "submitted" | "duplicate"; message: string };

/**
 * Refer a candidate. A referral is a duplicate (recorded, but it does not
 * earn attribution) when the person already applied for that job, or was
 * referred by anyone in the last six months. The referrer is told politely
 * without learning anything about the existing record.
 */
export async function submitReferral(ctx: RequestContext, input: ReferralInput, resume: File | null): Promise<ReferralResult> {
  if (!ctx.employeeId) throw forbidden("Referrals are made from an employee profile. Ask HR to link your login to your employee record.");
  const staged: StagedResume | null = resume && resume.size > 0 ? await stageResume(ctx.tenantId, resume) : null;
  try {
    return await ctx.db(async (tx) => {
      const [opening] = await tx.select().from(jobOpenings).where(and(eq(jobOpenings.id, input.openingId), eq(jobOpenings.status, "published")));
      if (!opening) throw validation("This job is no longer open for referrals.", { openingId: ["Not open"] });
      const [me] = await tx.select({ email: employees.workEmail, personal: employees.personalEmail }).from(employees).where(eq(employees.id, ctx.employeeId!));
      if ([me?.email, me?.personal].filter(Boolean).some((e) => e!.toLowerCase() === input.email)) throw validation("You cannot refer yourself.", { email: ["That's your own email"] });

      let [candidate] = await tx.select().from(candidates).where(sql`lower(${candidates.email}) = ${input.email}`).for("update");
      const sixMonthsAgo = subMonths(new Date(), 6);
      let duplicate = false;
      if (candidate) {
        const [applied] = await tx.select({ id: applications.id }).from(applications).where(and(eq(applications.candidateId, candidate.id), eq(applications.openingId, opening.id)));
        const [recent] = await tx
          .select({ id: referrals.id })
          .from(referrals)
          .where(and(eq(referrals.candidateId, candidate.id), ne(referrals.status, "duplicate"), gte(referrals.createdAt, sixMonthsAgo)));
        duplicate = !!applied || !!recent;
      }

      const retainUntil = retainUntilFrom(todayIn(), CANDIDATE_RETENTION_MONTHS);
      if (!candidate) {
        [candidate] = await tx
          .insert(candidates)
          .values({
            tenantId: ctx.tenantId,
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email,
            phone: input.phone,
            linkedinUrl: input.linkedinUrl,
            source: "referral",
            sourceDetail: "Employee referral",
            consentAt: new Date(),
            retainUntil,
            createdBy: ctx.userId,
          })
          .returning();
      }

      if (duplicate) {
        const [ref] = await tx
          .insert(referrals)
          .values({ tenantId: ctx.tenantId, referrerEmployeeId: ctx.employeeId!, candidateId: candidate.id, openingId: opening.id, relationship: input.relationship, note: input.note, status: "duplicate" })
          .returning({ id: referrals.id });
        await audit(tx, ctx, { action: "referral.duplicate", entityType: "referral", entityId: ref.id, metadata: { openingId: opening.id } });
        if (staged) await discardResume(staged);
        return {
          referralId: ref.id,
          status: "duplicate" as const,
          message: "Thank you! This person is already being considered by our recruiting team, so this referral can't be counted towards a reward. We've recorded it.",
        };
      }

      if (staged) {
        const doc = await insertResumeDocument(tx, { tenantId: ctx.tenantId, candidateId: candidate.id, staged, uploadedBy: ctx.userId, title: `Resume – ${fullName(input)}`, retainUntil });
        await tx.update(candidates).set({ resumeDocumentId: doc.id }).where(eq(candidates.id, candidate.id));
      }
      const [ref] = await tx
        .insert(referrals)
        .values({ tenantId: ctx.tenantId, referrerEmployeeId: ctx.employeeId!, candidateId: candidate.id, openingId: opening.id, relationship: input.relationship, note: input.note, status: "submitted" })
        .returning({ id: referrals.id });
      const stage = await firstStage(tx, ctx.tenantId);
      const [app] = await tx
        .insert(applications)
        .values({ tenantId: ctx.tenantId, candidateId: candidate.id, openingId: opening.id, stageId: stage.id, source: "referral", referralId: ref.id, coverNote: input.note })
        .returning({ id: applications.id });
      await tx.update(referrals).set({ applicationId: app.id }).where(eq(referrals.id, ref.id));
      await logEvent(tx, { tenantId: ctx.tenantId, applicationId: app.id, type: "applied", actorUserId: ctx.userId, toStageId: stage.id, body: "Referred by an employee.", metadata: { source: "referral", referralId: ref.id, relationship: input.relationship } });
      await audit(tx, ctx, { action: "referral.submitted", entityType: "referral", entityId: ref.id, metadata: { openingId: opening.id, applicationId: app.id } });
      await notifyRecruiters(tx, ctx.tenantId, {
        recruiterUserId: opening.recruiterUserId,
        title: `New referral: ${opening.title}`,
        body: `${input.firstName} was referred by a colleague.`,
        href: `/recruitment/openings/${opening.id}`,
        dedupeKey: `referral:${ref.id}`,
      });
      return { referralId: ref.id, status: "submitted" as const, message: "Thank you! Your referral was submitted. You can follow its progress under My referrals." };
    });
  } catch (err) {
    await discardResume(staged);
    throw err;
  }
}

export type MyReferral = {
  id: string;
  candidateName: string;
  openingTitle: string | null;
  status: string;
  /** Coarse progress only; no interview notes or feedback. */
  stage: string | null;
  rewardStatus: string;
  rewardAmount: number | null;
  rewardEligibleOn: string | null;
  rewardPaidAt: string | null;
  createdAt: string;
};

export async function myReferrals(ctx: RequestContext): Promise<MyReferral[]> {
  const employeeId = ctx.employeeId;
  if (!employeeId) return [];
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ r: referrals, first: candidates.firstName, last: candidates.lastName, title: jobOpenings.title, stage: recruitmentStages.name })
      .from(referrals)
      .innerJoin(candidates, eq(candidates.id, referrals.candidateId))
      .leftJoin(jobOpenings, eq(jobOpenings.id, referrals.openingId))
      .leftJoin(applications, eq(applications.id, referrals.applicationId))
      .leftJoin(recruitmentStages, eq(recruitmentStages.id, applications.stageId))
      .where(eq(referrals.referrerEmployeeId, employeeId))
      .orderBy(desc(referrals.createdAt))
      .limit(200);
    return rows.map(({ r, first, last, title, stage }) => ({
      id: r.id,
      candidateName: fullName({ firstName: first, lastName: last }),
      openingTitle: title,
      status: r.status,
      stage: r.status === "duplicate" ? null : stage,
      rewardStatus: r.rewardStatus,
      rewardAmount: r.rewardAmount,
      rewardEligibleOn: r.rewardEligibleOn,
      rewardPaidAt: r.rewardPaidAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}

/* ------------------------------------------------------------------ */
/* Reward policies (referrals.manage)                                  */
/* ------------------------------------------------------------------ */

export async function listRewardPolicies(ctx: RequestContext) {
  if (!canManageReferrals(ctx)) throw forbidden();
  return ctx.db((tx) => tx.select().from(referralRewardPolicies).orderBy(desc(referralRewardPolicies.isActive), desc(referralRewardPolicies.createdAt)));
}

/** The program shown to employees: the active policy's amount and waiting period. */
export async function activeRewardPolicy(ctx: RequestContext) {
  const [p] = await ctx.db((tx) =>
    tx
      .select({ name: referralRewardPolicies.name, amount: referralRewardPolicies.amount, eligibleAfterDays: referralRewardPolicies.eligibleAfterDays })
      .from(referralRewardPolicies)
      .where(eq(referralRewardPolicies.isActive, true))
      .orderBy(desc(referralRewardPolicies.createdAt))
      .limit(1),
  );
  return p ?? null;
}

export async function saveRewardPolicy(ctx: RequestContext, input: { id: string | null; name: string; amount: number; eligibleAfterDays: number; isActive: boolean }) {
  if (!canManageReferrals(ctx)) throw forbidden();
  const values = { name: input.name, amount: toPaise(input.amount), eligibleAfterDays: input.eligibleAfterDays, isActive: input.isActive };
  return ctx.db(async (tx) => {
    if (input.id) {
      const [before] = await tx.select().from(referralRewardPolicies).where(eq(referralRewardPolicies.id, input.id)).for("update");
      if (!before) throw notFound("Reward policy");
      await tx.update(referralRewardPolicies).set(values).where(eq(referralRewardPolicies.id, input.id));
      await audit(tx, ctx, { action: "referral_policy.updated", entityType: "referral_reward_policy", entityId: input.id, changes: diff(before as Record<string, unknown>, values) });
      return { id: input.id };
    }
    const [p] = await tx.insert(referralRewardPolicies).values({ tenantId: ctx.tenantId, ...values }).returning({ id: referralRewardPolicies.id });
    await audit(tx, ctx, { action: "referral_policy.created", entityType: "referral_reward_policy", entityId: p.id, metadata: { name: input.name } });
    return p;
  });
}

/* ------------------------------------------------------------------ */
/* Reward lifecycle                                                    */
/* ------------------------------------------------------------------ */

/**
 * Daily: a pending reward becomes eligible once the hire has completed the
 * policy's waiting period and is still active; it is cancelled if they left.
 */
export async function evaluateReferralRewards(tx: Tx, tenantId: string, today = todayIn()) {
  const due = await tx
    .select({ r: referrals, empStatus: employees.status, empId: employees.id })
    .from(referrals)
    .innerJoin(candidates, eq(candidates.id, referrals.candidateId))
    .leftJoin(employees, eq(employees.id, candidates.employeeId))
    .where(and(eq(referrals.tenantId, tenantId), eq(referrals.rewardStatus, "pending"), lte(referrals.rewardEligibleOn, today)))
    .limit(500);
  let eligible = 0;
  let cancelled = 0;
  for (const { r, empStatus } of due) {
    if (empStatus === "active") {
      await tx.update(referrals).set({ rewardStatus: "eligible" }).where(eq(referrals.id, r.id));
      eligible++;
    } else if (empStatus === "exited" || empStatus === "on_notice" || !empStatus) {
      await tx.update(referrals).set({ rewardStatus: "cancelled" }).where(eq(referrals.id, r.id));
      cancelled++;
    }
    // "pending" employees (not yet joined) stay pending until they join.
  }
  if (eligible) {
    await notify(tx, {
      tenantId,
      userIds: await usersWithPermission(tx, tenantId, "referrals.manage"),
      category: "referrals",
      title: `${eligible} referral reward(s) ready for approval`,
      href: "/referrals?tab=rewards",
      dedupeKey: `referral-rewards:${today}`,
    });
  }
  return { eligible, cancelled };
}

async function openPeriodFor(tx: Tx, tenantId: string, legalEntityId: string) {
  const [p] = await tx
    .select()
    .from(payrollPeriods)
    .where(and(eq(payrollPeriods.tenantId, tenantId), eq(payrollPeriods.legalEntityId, legalEntityId), eq(payrollPeriods.status, "open")))
    .orderBy(asc(payrollPeriods.year), asc(payrollPeriods.month))
    .limit(1);
  return p ?? null;
}

/**
 * Post an approved reward to payroll as a one-off input for the referrer.
 * Payroll tables are payroll-only under RLS; referral managers are
 * authorized by the caller, then the insert runs in system context. The
 * unique (source_type, source_id) index makes this idempotent.
 */
export async function postRewardToPayroll(tx: Tx, tenantId: string, referralId: string, actorUserId: string | null) {
  const [r] = await tx.select().from(referrals).where(and(eq(referrals.id, referralId), eq(referrals.tenantId, tenantId))).for("update");
  if (!r) throw notFound("Referral");
  if (r.rewardStatus === "paid") return { posted: false, reason: "already_paid" as const, periodId: null };
  if (r.rewardStatus !== "approved") throw invalidState("Only approved rewards can be posted to payroll.");
  if (!r.rewardAmount) throw invalidState("This reward has no amount.");
  const [referrer] = await tx.select({ legalEntityId: employees.legalEntityId, status: employees.status }).from(employees).where(and(eq(employees.id, r.referrerEmployeeId), eq(employees.tenantId, tenantId)));
  if (!referrer) throw notFound("Referrer");
  const period = await openPeriodFor(tx, tenantId, referrer.legalEntityId);
  if (!period) return { posted: false, reason: "awaiting_period" as const, periodId: null };
  await tx
    .insert(payrollInputs)
    .values({
      tenantId,
      periodId: period.id,
      employeeId: r.referrerEmployeeId,
      kind: "referral_reward",
      componentCode: "REFERRAL_BONUS",
      amount: r.rewardAmount,
      isTaxable: true,
      note: "Employee referral reward",
      sourceType: "referral_reward",
      sourceId: r.id,
      createdBy: actorUserId,
    })
    .onConflictDoNothing();
  const [input] = await tx
    .select({ id: payrollInputs.id })
    .from(payrollInputs)
    .where(and(eq(payrollInputs.tenantId, tenantId), eq(payrollInputs.sourceType, "referral_reward"), eq(payrollInputs.sourceId, r.id)));
  await tx.update(referrals).set({ rewardStatus: "paid", rewardPaidAt: new Date(), payrollInputId: input.id }).where(eq(referrals.id, r.id));
  await audit(tx, { tenantId, userId: actorUserId }, { action: "referral.reward_posted", entityType: "referral", entityId: r.id, metadata: { payrollInputId: input.id, periodId: period.id } });
  const u = await userIdForEmployee(tx, r.referrerEmployeeId);
  if (u) await notify(tx, { tenantId, userIds: [u], category: "referrals", title: "Your referral reward is in payroll", body: `It will be paid with the ${period.month}/${period.year} payroll.`, href: "/referrals", dedupeKey: `referral-reward-paid:${r.id}` });
  return { posted: true, reason: null, periodId: period.id };
}

export async function decideReward(ctx: RequestContext, referralId: string, action: "approve" | "post_to_payroll" | "mark_paid" | "cancel") {
  if (!canManageReferrals(ctx)) throw forbidden();
  const r = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(referrals).where(eq(referrals.id, referralId)).for("update");
    if (!row) throw notFound("Referral");
    if (action === "approve") {
      if (row.rewardStatus !== "eligible") throw invalidState("Only eligible rewards can be approved.");
      await tx.update(referrals).set({ rewardStatus: "approved" }).where(eq(referrals.id, row.id));
      await audit(tx, ctx, { action: "referral.reward_approved", entityType: "referral", entityId: row.id });
    } else if (action === "mark_paid") {
      if (row.rewardStatus !== "approved") throw invalidState("Approve the reward before marking it paid.");
      await tx.update(referrals).set({ rewardStatus: "paid", rewardPaidAt: new Date() }).where(eq(referrals.id, row.id));
      await audit(tx, ctx, { action: "referral.reward_paid_manually", entityType: "referral", entityId: row.id });
    } else if (action === "cancel") {
      if (!["pending", "eligible", "approved"].includes(row.rewardStatus)) throw invalidState("This reward cannot be cancelled.");
      await tx.update(referrals).set({ rewardStatus: "cancelled" }).where(eq(referrals.id, row.id));
      await audit(tx, ctx, { action: "referral.reward_cancelled", entityType: "referral", entityId: row.id });
    } else if (row.rewardStatus !== "approved") {
      throw invalidState("Approve the reward before posting it to payroll.");
    }
    return row;
  });
  if (action === "approve" || action === "post_to_payroll") {
    const res = await withSystem((tx) => postRewardToPayroll(tx, ctx.tenantId, r.id, ctx.userId), ctx.tenantId);
    return { status: res.posted ? "paid" : "approved", awaitingPeriod: res.reason === "awaiting_period" };
  }
  return { status: action === "mark_paid" ? "paid" : "cancelled", awaitingPeriod: false };
}

/** Daily: post approved rewards whose referrer now has an open payroll period. */
export async function postApprovedRewards(tx: Tx, tenantId: string) {
  const approved = await tx.select({ id: referrals.id }).from(referrals).where(and(eq(referrals.tenantId, tenantId), eq(referrals.rewardStatus, "approved"))).limit(200);
  let posted = 0;
  for (const r of approved) if ((await postRewardToPayroll(tx, tenantId, r.id, null)).posted) posted++;
  return posted;
}

/* ------------------------------------------------------------------ */
/* Program view (referrals.manage)                                     */
/* ------------------------------------------------------------------ */

export type ReferralAdminRow = {
  id: string;
  candidateName: string;
  candidateId: string;
  referrerName: string;
  openingTitle: string | null;
  status: string;
  rewardStatus: string;
  rewardAmount: number | null;
  rewardEligibleOn: string | null;
  rewardPaidAt: string | null;
  payrollInputId: string | null;
  createdAt: string;
};

export async function allReferrals(ctx: RequestContext): Promise<ReferralAdminRow[]> {
  if (!canManageReferrals(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ r: referrals, first: candidates.firstName, last: candidates.lastName, referrer: employees.displayName, title: jobOpenings.title })
      .from(referrals)
      .innerJoin(candidates, eq(candidates.id, referrals.candidateId))
      .innerJoin(employees, eq(employees.id, referrals.referrerEmployeeId))
      .leftJoin(jobOpenings, eq(jobOpenings.id, referrals.openingId))
      .orderBy(sql`case ${referrals.rewardStatus} when 'eligible' then 0 when 'approved' then 1 when 'pending' then 2 else 3 end`, desc(referrals.createdAt))
      .limit(500);
    return rows.map(({ r, first, last, referrer, title }) => ({
      id: r.id,
      candidateName: fullName({ firstName: first, lastName: last }),
      candidateId: r.candidateId,
      referrerName: referrer,
      openingTitle: title,
      status: r.status,
      rewardStatus: r.rewardStatus,
      rewardAmount: r.rewardAmount,
      rewardEligibleOn: r.rewardEligibleOn,
      rewardPaidAt: r.rewardPaidAt?.toISOString() ?? null,
      payrollInputId: r.payrollInputId,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}

/**
 * Referral funnel. Definitions:
 *  - referred: referrals that were not duplicates;
 *  - interviewing: of those, referrals whose application reached a stage of
 *    kind interview / final / offer / hired (current stage or history);
 *  - hired: referral status hired;
 *  - rewards paid: count and total of rewards with status paid.
 */
export async function referralFunnel(ctx: RequestContext) {
  if (!canManageReferrals(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const [row] = await tx.execute<{ referred: number; interviewing: number; hired: number; duplicates: number; paid_count: number; paid_total: string | null }>(sql`
      select
        count(*) filter (where r.status <> 'duplicate')::int as referred,
        count(*) filter (where r.status <> 'duplicate' and exists (
          select 1 from applications a join recruitment_stages s on s.id = a.stage_id
          where a.id = r.application_id and s.kind in ('interview','final','offer','hired')
          union all
          select 1 from application_events e join recruitment_stages s2 on s2.id = e.to_stage_id
          where e.application_id = r.application_id and s2.kind in ('interview','final','offer','hired')
        ))::int as interviewing,
        count(*) filter (where r.status = 'hired')::int as hired,
        count(*) filter (where r.status = 'duplicate')::int as duplicates,
        count(*) filter (where r.reward_status = 'paid')::int as paid_count,
        sum(r.reward_amount) filter (where r.reward_status = 'paid')::text as paid_total
      from referrals r where r.tenant_id = ${ctx.tenantId}`);
    return {
      referred: row?.referred ?? 0,
      interviewing: row?.interviewing ?? 0,
      hired: row?.hired ?? 0,
      duplicates: row?.duplicates ?? 0,
      rewardsPaid: row?.paid_count ?? 0,
      rewardsPaidAmount: row?.paid_total ? Number(row.paid_total) : 0,
    };
  });
}

