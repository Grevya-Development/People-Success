import "server-only";
import { isIP } from "node:net";
import { addDays, format, parseISO } from "date-fns";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { withSystem } from "../../db/tx";
import {
  applications,
  candidates,
  departments,
  designations,
  documentAccessLogs,
  documents,
  employees,
  jobOpenings,
  jobRequisitions,
  legalEntities,
  locations,
  offers,
  positions,
  referralRewardPolicies,
  referrals,
  tenants,
} from "../../db/schema";
import type { OfferComponent } from "../../db/schema/recruitment";
import { audit } from "../../lib/audit";
import { sha256 } from "../../lib/crypto";
import { AppError, invalidState, notFound } from "../../lib/errors";
import { rateLimit } from "../../lib/rate-limit";
import { signedDownloadUrl } from "../documents/storage";
import { insertEmployeeRecord } from "../employees/mutations";
import { emitDomainEvent } from "../events";
import { notify } from "../notifications";
import { userIdForEmployee } from "../directory";
import { todayIn } from "@/lib/format";
import { syncReferralStatus } from "./applications";
import { isDefaultSplit } from "./compensation";
import { notifyRecruiters, queueCandidateEmail } from "./messaging";
import { fullName, logEvent, stageOfKind } from "./shared";

/**
 * Candidate-facing offer flows, reached through the emailed link
 * /offers/respond/<token>. Only the SHA-256 of the token is stored; lookups
 * run in system context and are scoped to the single offer the token
 * identifies. Acceptance is a click-through record (time, IP, note) — no
 * electronic signature is claimed.
 */

const TOKEN = /^[A-Za-z0-9_-]{20,200}$/;
const hashOf = (token: string) => sha256(token);
const cleanIp = (ip: string | null | undefined) => (ip && isIP(ip) ? ip : null);

export type PublicOfferState = "invalid" | "open" | "expired" | "rescinded" | "accepted" | "declined";

export type PublicOffer = {
  state: PublicOfferState;
  companyName: string | null;
  offer: null | {
    candidateFirstName: string;
    designation: string;
    department: string | null;
    location: string | null;
    legalEntity: string;
    joiningDate: string;
    annualCtc: number;
    currency: string;
    components: OfferComponent[];
    defaultSplit: boolean;
    probationMonths: number;
    noticePeriodDays: number;
    employmentType: string;
    expiresOn: string;
    version: number;
    respondedAt: string | null;
    hasLetter: boolean;
  };
};

function stateOf(o: typeof offers.$inferSelect, today: string): PublicOfferState {
  if (o.status === "accepted") return "accepted";
  if (o.status === "declined") return "declined";
  if (o.status === "rescinded") return "rescinded";
  if (o.status === "expired" || (o.status === "sent" && o.expiresOn < today)) return "expired";
  if (o.status === "sent") return "open";
  return "invalid";
}

export async function getOfferByToken(token: string): Promise<PublicOffer> {
  if (!TOKEN.test(token)) return { state: "invalid", companyName: null, offer: null };
  return withSystem(async (tx) => {
    const [row] = await tx
      .select({ o: offers, first: candidates.firstName, company: tenants.name, des: designations.title, dep: departments.name, loc: locations.name, le: legalEntities.legalName, title: jobOpenings.title })
      .from(offers)
      .innerJoin(candidates, eq(candidates.id, offers.candidateId))
      .innerJoin(tenants, eq(tenants.id, offers.tenantId))
      .innerJoin(jobOpenings, eq(jobOpenings.id, offers.openingId))
      .leftJoin(designations, eq(designations.id, offers.designationId))
      .leftJoin(departments, eq(departments.id, offers.departmentId))
      .leftJoin(locations, eq(locations.id, offers.locationId))
      .leftJoin(legalEntities, eq(legalEntities.id, offers.legalEntityId))
      .where(eq(offers.responseTokenHash, hashOf(token)));
    if (!row) return { state: "invalid", companyName: null, offer: null };
    const o = row.o;
    const state = stateOf(o, todayIn());
    if (state === "invalid") return { state, companyName: row.company, offer: null };
    if (state === "rescinded") return { state, companyName: row.company, offer: null };
    return {
      state,
      companyName: row.company,
      offer: {
        candidateFirstName: row.first,
        designation: row.des ?? row.title,
        department: row.dep,
        location: row.loc,
        legalEntity: row.le ?? row.company,
        joiningDate: o.joiningDate,
        annualCtc: o.annualCtc,
        currency: o.currency,
        components: o.components,
        defaultSplit: isDefaultSplit(o.components),
        probationMonths: o.probationMonths,
        noticePeriodDays: o.noticePeriodDays,
        employmentType: o.employmentType,
        expiresOn: o.expiresOn,
        version: o.version,
        respondedAt: o.respondedAt?.toISOString() ?? null,
        hasLetter: !!o.documentId,
      },
    };
  });
}

/** Signed URL for the offer letter, authorized by the token alone. Logged. */
export async function offerLetterLinkByToken(token: string, ip: string | null) {
  if (!TOKEN.test(token)) throw notFound("Offer");
  await rateLimit(`offer-letter:${hashOf(token).slice(0, 24)}`, 30, 3600);
  const doc = await withSystem(async (tx) => {
    const [o] = await tx.select().from(offers).where(eq(offers.responseTokenHash, hashOf(token)));
    if (!o || !o.documentId || !["sent", "accepted"].includes(o.status)) return null;
    if (o.status === "sent" && o.expiresOn < todayIn()) return null;
    const [d] = await tx.select().from(documents).where(and(eq(documents.id, o.documentId), eq(documents.tenantId, o.tenantId), isNull(documents.deletedAt)));
    if (!d) return null;
    await tx.insert(documentAccessLogs).values({ tenantId: o.tenantId, documentId: d.id, userId: null, action: "candidate_download", ip: ip?.slice(0, 64) ?? null });
    return d;
  });
  if (!doc) throw notFound("Offer letter");
  return { url: await signedDownloadUrl(doc.bucket, doc.storagePath, doc.fileName, 60), fileName: doc.fileName };
}

export type OfferResponseResult = { state: PublicOfferState; employeeId: string | null; alreadyResponded: boolean; outboxIds: string[] };

/**
 * Accept or decline. The offer row is locked FOR UPDATE and its status
 * checked inside the same transaction as the employee conversion, so a
 * double-click (or two tabs) can never create two employees.
 */
export async function respondToOffer(
  token: string,
  decision: "accept" | "decline",
  note: string | null,
  meta: { ip: string | null; userAgent?: string | null },
): Promise<OfferResponseResult> {
  if (!TOKEN.test(token)) throw notFound("Offer");
  await rateLimit(`offer-respond:${hashOf(token).slice(0, 24)}`, 20, 3600);
  if (meta.ip) await rateLimit(`offer-respond-ip:${meta.ip}`, 60, 3600);

  const EXPIRED = { state: "expired" as const, employeeId: null, alreadyResponded: false, outboxIds: [] };
  const result = await withSystem(async (tx): Promise<OfferResponseResult> => {
    const [o] = await tx.select().from(offers).where(eq(offers.responseTokenHash, hashOf(token))).for("update");
    if (!o) throw notFound("Offer");
    await tx.execute(sql`select set_config('app.tenant_id', ${o.tenantId}, true)`);
    const today = todayIn();
    if (o.status === "accepted" || o.status === "declined") {
      if ((o.status === "accepted") === (decision === "accept")) return { state: o.status, employeeId: o.employeeId, alreadyResponded: true, outboxIds: [] };
      throw invalidState(`You already ${o.status} this offer. Contact the recruiter if something has changed.`);
    }
    if (o.status === "rescinded") throw invalidState("This offer has been withdrawn.");
    if (o.status === "expired" || (o.status === "sent" && o.expiresOn < today)) {
      // Record the expiry (committed), then report it to the candidate.
      if (o.status === "sent") {
        await tx.update(offers).set({ status: "expired" }).where(eq(offers.id, o.id));
        await logEvent(tx, { tenantId: o.tenantId, applicationId: o.applicationId, type: "offer_expired", actorUserId: null, body: `Offer v${o.version} expired without a response`, metadata: { offerId: o.id } });
      }
      return EXPIRED;
    }
    if (o.status !== "sent") throw invalidState("This offer is not open for a response.");

    const respondedAt = new Date();
    const ip = cleanIp(meta.ip);
    const cleanNote = note?.trim() ? note.trim().slice(0, 1000) : null;

    if (decision === "decline") {
      await tx.update(offers).set({ status: "declined", respondedAt, responseIp: ip, responseNote: cleanNote }).where(eq(offers.id, o.id));
      await logEvent(tx, { tenantId: o.tenantId, applicationId: o.applicationId, type: "offer_declined", actorUserId: null, body: cleanNote ?? "Declined by the candidate", metadata: { offerId: o.id, ip } });
      await audit(tx, { tenantId: o.tenantId, userId: null }, { action: "offer.declined", entityType: "offer", entityId: o.id, ip, userAgent: meta.userAgent });
      await emitDomainEvent(tx, o.tenantId, "offer.declined", { offerId: o.id, applicationId: o.applicationId });
      const [op] = await tx.select({ recruiter: jobOpenings.recruiterUserId, title: jobOpenings.title }).from(jobOpenings).where(eq(jobOpenings.id, o.openingId));
      await notifyRecruiters(tx, o.tenantId, {
        recruiterUserId: op?.recruiter,
        extraUserIds: [o.createdBy],
        title: `Offer declined: ${op?.title ?? "role"}`,
        body: "The candidate declined the offer.",
        href: `/recruitment/offers/${o.id}`,
        dedupeKey: `offer:${o.id}:declined`,
      });
      return { state: "declined", employeeId: null, alreadyResponded: false, outboxIds: [] };
    }

    const { employeeId, outboxIds } = await convertToEmployee(tx, o, { respondedAt, ip, note: cleanNote, userAgent: meta.userAgent ?? null });
    return { state: "accepted", employeeId, alreadyResponded: false, outboxIds };
  });
  if (result === EXPIRED) throw invalidState("This offer has expired. Please contact the recruiter.");
  return result;
}

/**
 * Candidate → employee, inside the acceptance transaction (system context,
 * every query filtered by the offer's tenant).
 */
async function convertToEmployee(
  tx: Tx,
  o: typeof offers.$inferSelect,
  r: { respondedAt: Date; ip: string | null; note: string | null; userAgent: string | null },
) {
  const tenantId = o.tenantId;
  const [c] = await tx.select().from(candidates).where(and(eq(candidates.id, o.candidateId), eq(candidates.tenantId, tenantId))).for("update");
  const [app] = await tx.select().from(applications).where(and(eq(applications.id, o.applicationId), eq(applications.tenantId, tenantId))).for("update");
  const [opening] = await tx.select().from(jobOpenings).where(and(eq(jobOpenings.id, o.openingId), eq(jobOpenings.tenantId, tenantId))).for("update");
  const [company] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
  if (!c || !app || !opening) throw new AppError("INTERNAL", "Offer data is incomplete.");

  // Optional references that became invalid since the offer was made are dropped, never guessed.
  const valid = async <T,>(id: string | null, q: (id: string) => Promise<T[]>) => (id && (await q(id)).length ? id : null);
  const departmentId = await valid(o.departmentId, (id) => tx.select({ id: departments.id }).from(departments).where(and(eq(departments.id, id), eq(departments.tenantId, tenantId))));
  const designationId = await valid(o.designationId, (id) => tx.select({ id: designations.id }).from(designations).where(and(eq(designations.id, id), eq(designations.tenantId, tenantId))));
  const locationId = await valid(o.locationId, (id) => tx.select({ id: locations.id }).from(locations).where(and(eq(locations.id, id), eq(locations.tenantId, tenantId))));
  const managerId = await valid(o.reportingManagerId, (id) =>
    tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.id, id), eq(employees.tenantId, tenantId), isNull(employees.deletedAt), inArray(employees.status, ["active", "on_notice", "pending"]))),
  );

  const employee = await insertEmployeeRecord(tx, tenantId, null, {
    firstName: c.firstName,
    middleName: null,
    lastName: c.lastName,
    workEmail: null,
    personalEmail: c.email,
    phone: c.phone,
    dateOfBirth: null,
    gender: null,
    employeeCode: null,
    legalEntityId: o.legalEntityId,
    departmentId,
    designationId,
    locationId,
    managerId,
    gradeId: null,
    costCenterId: null,
    employmentType: o.employmentType,
    workerType: "employee",
    workMode: opening.workMode,
    joiningDate: o.joiningDate,
    probationMonths: o.probationMonths,
    noticePeriodDays: o.noticePeriodDays,
    annualCtcPaise: o.annualCtc,
    components: o.components,
    source: "offer",
    sourceId: o.id,
  });

  await tx
    .update(offers)
    .set({ status: "accepted", respondedAt: r.respondedAt, responseIp: r.ip, responseNote: r.note, employeeId: employee.id, esignProvider: null, esignEnvelopeId: null, esignStatus: null })
    .where(eq(offers.id, o.id));
  await tx.update(candidates).set({ employeeId: employee.id, retainUntil: null }).where(eq(candidates.id, c.id));

  const hired = await stageOfKind(tx, tenantId, "hired");
  await tx
    .update(applications)
    .set({ status: "hired", stageId: hired?.id ?? app.stageId, stageEnteredAt: r.respondedAt, decidedAt: r.respondedAt })
    .where(eq(applications.id, app.id));
  await logEvent(tx, { tenantId, applicationId: app.id, type: "offer_accepted", actorUserId: null, body: "Accepted electronically by click-through", metadata: { offerId: o.id, ip: r.ip, note: r.note } });
  await logEvent(tx, { tenantId, applicationId: app.id, type: "hired", actorUserId: null, fromStageId: app.stageId, toStageId: hired?.id ?? null, metadata: { employeeId: employee.id } });
  await syncReferralStatus(tx, { ...app, status: "hired" }, hired);

  // Referral reward: eligible once the hire has completed the policy's period after joining.
  if (app.referralId) {
    const [policy] = await tx
      .select()
      .from(referralRewardPolicies)
      .where(and(eq(referralRewardPolicies.tenantId, tenantId), eq(referralRewardPolicies.isActive, true)))
      .orderBy(desc(referralRewardPolicies.createdAt))
      .limit(1);
    if (policy) {
      await tx
        .update(referrals)
        .set({
          rewardPolicyId: policy.id,
          rewardAmount: policy.amount,
          rewardStatus: "pending",
          rewardEligibleOn: format(addDays(parseISO(o.joiningDate), policy.eligibleAfterDays), "yyyy-MM-dd"),
        })
        .where(and(eq(referrals.id, app.referralId), eq(referrals.tenantId, tenantId), eq(referrals.rewardStatus, "not_applicable")));
    }
  }

  // Close the opening once all its seats are filled; mark the requisition filled at headcount.
  const [{ hiredCount }] = await tx
    .select({ hiredCount: sql<number>`count(*)::int` })
    .from(applications)
    .where(and(eq(applications.openingId, opening.id), eq(applications.status, "hired")));
  if (hiredCount >= opening.openings && opening.status !== "closed") {
    await tx.update(jobOpenings).set({ status: "closed" }).where(eq(jobOpenings.id, opening.id));
  }
  let hiringManagerUser: string | null = null;
  if (opening.requisitionId) {
    const [req] = await tx.select().from(jobRequisitions).where(and(eq(jobRequisitions.id, opening.requisitionId), eq(jobRequisitions.tenantId, tenantId))).for("update");
    if (req) {
      const [{ reqHired }] = await tx
        .select({ reqHired: sql<number>`count(*)::int` })
        .from(applications)
        .innerJoin(jobOpenings, eq(jobOpenings.id, applications.openingId))
        .where(and(eq(jobOpenings.requisitionId, req.id), eq(applications.status, "hired")));
      if (reqHired >= req.headcount && req.status === "approved") {
        await tx.update(jobRequisitions).set({ status: "filled" }).where(eq(jobRequisitions.id, req.id));
      }
      if (req.positionId) {
        const [pos] = await tx.select().from(positions).where(and(eq(positions.id, req.positionId), eq(positions.tenantId, tenantId))).for("update");
        if (pos && !pos.employeeId) {
          await tx.update(positions).set({ employeeId: employee.id, status: "filled" }).where(eq(positions.id, pos.id));
          await tx.update(employees).set({ positionId: pos.id }).where(eq(employees.id, employee.id));
        }
      }
    }
  }
  hiringManagerUser = await userIdForEmployee(tx, opening.hiringManagerEmployeeId);

  const candidateName = fullName(c);
  await audit(tx, { tenantId, userId: null }, {
    action: "offer.accepted",
    entityType: "offer",
    entityId: o.id,
    metadata: { employeeId: employee.id, method: "click_through", note: r.note ? "provided" : null },
    ip: r.ip,
    userAgent: r.userAgent,
  });
  await emitDomainEvent(tx, tenantId, "offer.accepted", { offerId: o.id, employeeId: employee.id, candidateName, joiningDate: o.joiningDate }, { dedupeKey: `offer-accepted:${o.id}` });
  await notifyRecruiters(tx, tenantId, {
    recruiterUserId: opening.recruiterUserId,
    extraUserIds: [o.createdBy, hiringManagerUser],
    title: `Offer accepted: ${candidateName}`,
    body: `${opening.title} · joining ${o.joiningDate}`,
    href: `/employees/${employee.id}`,
    dedupeKey: `offer:${o.id}:accepted`,
  });
  if (hiringManagerUser) {
    await notify(tx, { tenantId, userIds: [hiringManagerUser], category: "recruitment", title: `${candidateName} accepted the offer`, body: `${opening.title} · joining ${o.joiningDate}`, href: `/employees/${employee.id}`, dedupeKey: `offer:${o.id}:accepted:hm` });
  }
  const outboxId = await queueCandidateEmail(tx, {
    tenantId,
    applicationId: app.id,
    to: c.email,
    companyName: company?.name ?? "",
    subject: `Welcome to ${company?.name ?? "the team"}`,
    paragraphs: [
      `Dear ${c.firstName},`,
      `Thank you for accepting our offer. We have recorded your acceptance (accepted electronically by click-through on ${r.respondedAt.toUTCString().slice(0, 16)}).`,
      `Your joining date is ${o.joiningDate}. Our people team will be in touch about onboarding.`,
    ],
    template: "candidate.offer_accepted",
    actorUserId: null,
    dedupeKey: `offer-accepted:${o.id}`,
  });
  return { employeeId: employee.id, outboxIds: outboxId ? [outboxId] : [] };
}
