import "server-only";
import { and, asc, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import type { RequestContext } from "../../auth/context";
import type { Tx } from "../../db/client";
import {
  applicationEvents,
  applications,
  approvalRequests,
  approvalSteps,
  candidates,
  departments,
  designations,
  documents,
  employees,
  jobOpenings,
  jobRequisitions,
  legalEntities,
  locations,
  offers,
  recruitmentStages,
  tenants,
} from "../../db/schema";
import type { OfferComponent } from "../../db/schema/recruitment";
import { audit, diff } from "../../lib/audit";
import { randomToken, sha256 } from "../../lib/crypto";
import { forbidden, invalidState, notFound, validation } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { cancelApprovalForSubject, startApproval, type ApprovalActor } from "../approvals/engine";
import { notify } from "../notifications";
import { todayIn } from "@/lib/format";
import type { OfferInput, OfferStatus } from "@/lib/validation/recruitment";
import { isDefaultSplit, offerBreakdown } from "./compensation";
import { esignStatus } from "./esign";
import { queueCandidateEmail } from "./messaging";
import { generateOfferLetter, offerLetterData } from "./offer-letter";
import { appUrl, canManageOffers, canSeeOffers, fullName, logEvent, toPaise, userNames } from "./shared";

type Offer = typeof offers.$inferSelect;

function requireManage(ctx: RequestContext) {
  if (!canManageOffers(ctx)) throw forbidden();
}

async function lockOffer(tx: Tx, id: string) {
  const [o] = await tx.select().from(offers).where(eq(offers.id, id)).for("update");
  if (!o) throw notFound("Offer");
  return o;
}

async function assertOfferRefs(tx: Tx, input: Omit<OfferInput, "applicationId">) {
  const bad: Record<string, string[]> = {};
  const [le] = await tx.select({ id: legalEntities.id }).from(legalEntities).where(and(eq(legalEntities.id, input.legalEntityId), eq(legalEntities.isActive, true)));
  if (!le) bad.legalEntityId = ["Not found"];
  if (input.designationId && !(await tx.select({ id: designations.id }).from(designations).where(eq(designations.id, input.designationId))).length) bad.designationId = ["Not found"];
  if (input.departmentId && !(await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, input.departmentId))).length) bad.departmentId = ["Not found"];
  if (input.locationId && !(await tx.select({ id: locations.id }).from(locations).where(eq(locations.id, input.locationId))).length) bad.locationId = ["Not found"];
  if (input.reportingManagerId) {
    const [m] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.id, input.reportingManagerId), isNull(employees.deletedAt), inArray(employees.status, ["active", "on_notice", "pending"])));
    if (!m) bad.reportingManagerId = ["Not found"];
  }
  if (Object.keys(bad).length) throw validation("Some selections are no longer valid. Refresh and try again.", bad);
  const today = todayIn();
  if (input.expiresOn < today) throw validation("The offer must expire in the future.", { expiresOn: ["Choose a future date"] });
  if (input.joiningDate < today) throw validation("The joining date cannot be in the past.", { joiningDate: ["Choose today or later"] });
}

async function offerValues(ctx: RequestContext, input: Omit<OfferInput, "applicationId">) {
  const annualCtc = toPaise(input.annualCtc);
  const breakdown = await offerBreakdown(ctx.tenantId, annualCtc);
  return {
    values: {
      designationId: input.designationId,
      departmentId: input.departmentId,
      locationId: input.locationId,
      legalEntityId: input.legalEntityId,
      reportingManagerId: input.reportingManagerId,
      employmentType: input.employmentType,
      joiningDate: input.joiningDate,
      annualCtc,
      components: breakdown.components,
      probationMonths: input.probationMonths,
      noticePeriodDays: input.noticePeriodDays,
      expiresOn: input.expiresOn,
    },
    breakdown,
  };
}

/* ------------------------------------------------------------------ */
/* Create / edit / submit                                              */
/* ------------------------------------------------------------------ */

export async function createOffer(ctx: RequestContext, input: OfferInput) {
  requireManage(ctx);
  const { values, breakdown } = await offerValues(ctx, input);
  return ctx.db(async (tx) => {
    const [a] = await tx
      .select({ a: applications, kind: recruitmentStages.kind })
      .from(applications)
      .innerJoin(recruitmentStages, eq(recruitmentStages.id, applications.stageId))
      .where(eq(applications.id, input.applicationId))
      .for("update", { of: applications });
    if (!a) throw notFound("Application");
    if (a.a.status !== "active") throw invalidState(`This application is ${a.a.status}.`);
    if (a.kind !== "offer") throw invalidState("Move the candidate to the Offer stage before creating an offer.");
    const [live] = await tx
      .select({ id: offers.id })
      .from(offers)
      .where(and(eq(offers.applicationId, a.a.id), inArray(offers.status, ["draft", "pending_approval", "approved", "sent", "accepted"])));
    if (live) throw invalidState("This candidate already has an offer in progress. Open it to make changes.");
    await assertOfferRefs(tx, input);
    const [last] = await tx.select({ version: offers.version }).from(offers).where(eq(offers.applicationId, a.a.id)).orderBy(desc(offers.version)).limit(1);
    const [o] = await tx
      .insert(offers)
      .values({ tenantId: ctx.tenantId, applicationId: a.a.id, candidateId: a.a.candidateId, openingId: a.a.openingId, version: (last?.version ?? 0) + 1, status: "draft", ...values, createdBy: ctx.userId })
      .returning({ id: offers.id, version: offers.version });
    await logEvent(tx, { tenantId: ctx.tenantId, applicationId: a.a.id, type: "offer_created", actorUserId: ctx.userId, body: `Offer v${o.version} drafted`, metadata: { offerId: o.id, breakdown: breakdown.basis } });
    // Amounts are deliberately not written to the audit log.
    await audit(tx, ctx, { action: "offer.created", entityType: "offer", entityId: o.id, metadata: { applicationId: a.a.id, version: o.version, breakdown: breakdown.basis } });
    return { id: o.id };
  });
}

/**
 * Edit an offer. Drafts (and offers awaiting approval, which go back to
 * draft) change in place. Approved or sent offers are never edited: a new
 * version is created and the old one is rescinded, which also invalidates
 * the candidate's response link.
 */
export async function reviseOffer(ctx: RequestContext, offerId: string, input: Omit<OfferInput, "applicationId">) {
  requireManage(ctx);
  const { values } = await offerValues(ctx, input);
  const result = await ctx.db(async (tx) => {
    const o = await lockOffer(tx, offerId);
    await assertOfferRefs(tx, input);
    if (o.status === "draft" || o.status === "pending_approval") {
      if (o.status === "pending_approval") await cancelApprovalForSubject(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, "offer", o.id);
      await tx.update(offers).set({ ...values, status: "draft" }).where(eq(offers.id, o.id));
      await logEvent(tx, { tenantId: ctx.tenantId, applicationId: o.applicationId, type: "offer_updated", actorUserId: ctx.userId, body: `Offer v${o.version} edited${o.status === "pending_approval" ? " (withdrawn from approval)" : ""}`, metadata: { offerId: o.id } });
      await audit(tx, ctx, { action: "offer.updated", entityType: "offer", entityId: o.id, changes: diff(o as Record<string, unknown>, values) });
      return { id: o.id, newVersion: false, outboxId: null as string | null };
    }
    if (o.status !== "approved" && o.status !== "sent") throw invalidState(`A ${o.status} offer cannot be changed.`);
    await tx.update(offers).set({ status: "rescinded", responseNote: `Superseded by version ${o.version + 1}` }).where(eq(offers.id, o.id));
    const [n] = await tx
      .insert(offers)
      .values({ tenantId: ctx.tenantId, applicationId: o.applicationId, candidateId: o.candidateId, openingId: o.openingId, version: o.version + 1, status: "draft", ...values, createdBy: ctx.userId })
      .returning({ id: offers.id, version: offers.version });
    await logEvent(tx, {
      tenantId: ctx.tenantId,
      applicationId: o.applicationId,
      type: "offer_revised",
      actorUserId: ctx.userId,
      body: `Offer v${o.version} replaced by v${n.version}${o.status === "sent" ? "; the previous link no longer works" : ""}`,
      metadata: { previousOfferId: o.id, offerId: n.id },
    });
    await audit(tx, ctx, { action: "offer.revised", entityType: "offer", entityId: n.id, metadata: { previousOfferId: o.id, version: n.version } });
    let outboxId: string | null = null;
    if (o.status === "sent") {
      const [c] = await tx.select({ email: candidates.email, first: candidates.firstName, company: tenants.name }).from(candidates).innerJoin(tenants, eq(tenants.id, candidates.tenantId)).where(eq(candidates.id, o.candidateId));
      outboxId = await queueCandidateEmail(tx, {
        tenantId: ctx.tenantId,
        applicationId: o.applicationId,
        to: c.email,
        companyName: c.company,
        subject: `Your offer from ${c.company} is being updated`,
        paragraphs: [`Hi ${c.first},`, "We are updating the offer we sent you. The earlier link no longer works; you will receive the revised offer shortly."],
        template: "candidate.offer_revised",
        actorUserId: ctx.userId,
        dedupeKey: `offer-revised:${o.id}`,
      });
    }
    return { id: n.id, newVersion: true, outboxId };
  });
  return result;
}

export async function submitOffer(ctx: RequestContext, offerId: string) {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const o = await lockOffer(tx, offerId);
    if (o.status !== "draft") throw invalidState("Only draft offers can be submitted for approval.");
    if (o.expiresOn < todayIn()) throw invalidState("The offer expiry date has passed. Edit the offer first.");
    const [c] = await tx.select({ first: candidates.firstName, last: candidates.lastName }).from(candidates).where(eq(candidates.id, o.candidateId));
    const [op] = await tx.select({ title: jobOpenings.title }).from(jobOpenings).where(eq(jobOpenings.id, o.openingId));
    await tx.update(offers).set({ status: "pending_approval" }).where(eq(offers.id, o.id));
    await startApproval(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, {
      subjectType: "offer",
      subjectId: o.id,
      // No compensation in titles or notifications.
      title: `Offer for ${fullName({ firstName: c.first, lastName: c.last })} – ${op?.title ?? "role"} (v${o.version})`,
      requestedBy: ctx.userId,
      subjectEmployeeId: null,
      context: { annualCtc: o.annualCtc, legalEntityId: o.legalEntityId, departmentId: o.departmentId, employmentType: o.employmentType },
    });
    await logEvent(tx, { tenantId: ctx.tenantId, applicationId: o.applicationId, type: "offer_submitted", actorUserId: ctx.userId, body: `Offer v${o.version} sent for approval`, metadata: { offerId: o.id } });
    await audit(tx, ctx, { action: "offer.submitted", entityType: "offer", entityId: o.id });
    return { id: o.id };
  });
}

/* ------------------------------------------------------------------ */
/* Approval outcomes                                                   */
/* ------------------------------------------------------------------ */

export async function onOfferApproved(tx: Tx, offerId: string, actor: ApprovalActor) {
  const [o] = await tx.select().from(offers).where(and(eq(offers.id, offerId), eq(offers.tenantId, actor.tenantId))).for("update");
  if (!o || o.status !== "pending_approval") return;
  await tx.update(offers).set({ status: "approved" }).where(eq(offers.id, o.id));
  let letter: string | null = null;
  try {
    letter = (await generateOfferLetter(tx, { ...o, status: "approved" }, actor.userId)).documentId;
  } catch (err) {
    // Approval stands; the letter is generated again when the offer is sent.
    logger.error("offer.letter_failed", { offerId: o.id, err });
  }
  await logEvent(tx, { tenantId: actor.tenantId, applicationId: o.applicationId, type: "offer_approved", actorUserId: actor.userId, body: `Offer v${o.version} approved`, metadata: { offerId: o.id, documentId: letter } });
  await audit(tx, actor, { action: "offer.approved", entityType: "offer", entityId: o.id, metadata: { documentId: letter } });
  await notify(tx, {
    tenantId: actor.tenantId,
    userIds: [o.createdBy],
    category: "recruitment",
    title: "Offer approved – ready to send",
    body: "The offer letter has been generated. Review it and send it to the candidate.",
    href: `/recruitment/offers/${o.id}`,
    dedupeKey: `offer:${o.id}:approved`,
  });
}

export async function onOfferRejected(tx: Tx, offerId: string, actor: ApprovalActor, comment: string | null) {
  const [o] = await tx.select().from(offers).where(and(eq(offers.id, offerId), eq(offers.tenantId, actor.tenantId))).for("update");
  if (!o || o.status !== "pending_approval") return;
  // There is no "rejected" offer status: the offer returns to draft for rework.
  await tx.update(offers).set({ status: "draft" }).where(eq(offers.id, o.id));
  await logEvent(tx, { tenantId: actor.tenantId, applicationId: o.applicationId, type: "offer_approval_rejected", actorUserId: actor.userId, body: comment ?? "Not approved", metadata: { offerId: o.id } });
  await audit(tx, actor, { action: "offer.approval_rejected", entityType: "offer", entityId: o.id, metadata: { comment } });
}

export async function onOfferApprovalCancelled(tx: Tx, offerId: string, actor: ApprovalActor) {
  await tx.update(offers).set({ status: "draft" }).where(and(eq(offers.id, offerId), eq(offers.tenantId, actor.tenantId), eq(offers.status, "pending_approval")));
}

/* ------------------------------------------------------------------ */
/* Send / resend / rescind                                             */
/* ------------------------------------------------------------------ */

export const offerResponseUrl = (token: string) => appUrl(`/offers/respond/${token}`);

async function issueLink(tx: Tx, ctx: RequestContext, o: Offer, kind: "sent" | "resent") {
  const token = randomToken(32);
  await tx.update(offers).set({ status: "sent", responseTokenHash: sha256(token), sentAt: new Date() }).where(eq(offers.id, o.id));
  const d = await offerLetterData(tx, o);
  const [c] = await tx.select({ email: candidates.email }).from(candidates).where(eq(candidates.id, o.candidateId));
  const outboxId = await queueCandidateEmail(tx, {
    tenantId: ctx.tenantId,
    applicationId: o.applicationId,
    to: c.email,
    companyName: d.companyName,
    subject: `Your offer from ${d.companyName}`,
    paragraphs: [
      `Dear ${d.candidateFirstName},`,
      `We are delighted to offer you the position of ${d.designation} at ${d.legalName}. Your offer letter and the full terms are on the secure page below, where you can download the letter and accept or decline.`,
      `The offer is valid until ${o.expiresOn}. The link is personal to you; please do not forward it.`,
    ],
    cta: { label: "View your offer", href: offerResponseUrl(token) },
    template: kind === "sent" ? "candidate.offer" : "candidate.offer_resent",
    actorUserId: ctx.userId,
    dedupeKey: `offer-link:${o.id}:${sha256(token).slice(0, 16)}`,
  });
  return { token, outboxId };
}

/** Send an approved offer: (re)generates the letter if missing and emails a secure response link. */
export async function sendOffer(ctx: RequestContext, offerId: string) {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const o = await lockOffer(tx, offerId);
    if (o.status !== "approved") throw invalidState(o.status === "sent" ? "This offer was already sent. Use “Resend link” instead." : "Only approved offers can be sent.");
    if (o.expiresOn < todayIn()) throw invalidState("The offer expiry date has passed. Revise the offer to set a new date.");
    if (!o.documentId) await generateOfferLetter(tx, o, ctx.userId);
    const { token, outboxId } = await issueLink(tx, ctx, o, "sent");
    await logEvent(tx, { tenantId: ctx.tenantId, applicationId: o.applicationId, type: "offer_sent", actorUserId: ctx.userId, body: `Offer v${o.version} sent to the candidate`, metadata: { offerId: o.id } });
    await audit(tx, ctx, { action: "offer.sent", entityType: "offer", entityId: o.id });
    return { id: o.id, outboxId, token };
  });
}

/** Issue a fresh link (the previous one stops working), e.g. when the email was lost. */
export async function resendOfferLink(ctx: RequestContext, offerId: string) {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const o = await lockOffer(tx, offerId);
    if (o.status !== "sent") throw invalidState("Only sent offers can be re-sent.");
    if (o.expiresOn < todayIn()) throw invalidState("This offer has expired. Revise it to set a new date.");
    const { token, outboxId } = await issueLink(tx, ctx, o, "resent");
    await logEvent(tx, { tenantId: ctx.tenantId, applicationId: o.applicationId, type: "offer_resent", actorUserId: ctx.userId, body: "A new offer link was sent; the previous link no longer works.", metadata: { offerId: o.id } });
    await audit(tx, ctx, { action: "offer.link_reissued", entityType: "offer", entityId: o.id });
    return { id: o.id, outboxId, token };
  });
}

export async function rescindOffer(ctx: RequestContext, offerId: string, reason: string) {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const o = await lockOffer(tx, offerId);
    if (!["draft", "pending_approval", "approved", "sent"].includes(o.status)) throw invalidState(`A ${o.status} offer cannot be rescinded.`);
    if (o.status === "pending_approval") await cancelApprovalForSubject(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, "offer", o.id);
    await tx.update(offers).set({ status: "rescinded", responseNote: reason }).where(eq(offers.id, o.id));
    await logEvent(tx, { tenantId: ctx.tenantId, applicationId: o.applicationId, type: "offer_rescinded", actorUserId: ctx.userId, body: reason, metadata: { offerId: o.id } });
    await audit(tx, ctx, { action: "offer.rescinded", entityType: "offer", entityId: o.id, metadata: { reason } });
    let outboxId: string | null = null;
    if (o.status === "sent") {
      const [c] = await tx.select({ email: candidates.email, first: candidates.firstName, company: tenants.name }).from(candidates).innerJoin(tenants, eq(tenants.id, candidates.tenantId)).where(eq(candidates.id, o.candidateId));
      outboxId = await queueCandidateEmail(tx, {
        tenantId: ctx.tenantId,
        applicationId: o.applicationId,
        to: c.email,
        companyName: c.company,
        subject: `Update on your offer from ${c.company}`,
        paragraphs: [`Dear ${c.first},`, "We regret to inform you that the offer we sent has been withdrawn. The offer link no longer works. Please reply to this email if you have any questions."],
        template: "candidate.offer_rescinded",
        actorUserId: ctx.userId,
        dedupeKey: `offer-rescinded:${o.id}`,
      });
    }
    return { id: o.id, outboxId };
  });
}

/* ------------------------------------------------------------------ */
/* Expiry (daily job)                                                  */
/* ------------------------------------------------------------------ */

export async function expireOffers(tx: Tx, tenantId: string, today = todayIn()) {
  const due = await tx
    .update(offers)
    .set({ status: "expired" })
    .where(and(eq(offers.tenantId, tenantId), eq(offers.status, "sent"), lt(offers.expiresOn, today)))
    .returning({ id: offers.id, applicationId: offers.applicationId, createdBy: offers.createdBy, version: offers.version });
  for (const o of due) {
    await logEvent(tx, { tenantId, applicationId: o.applicationId, type: "offer_expired", actorUserId: null, body: `Offer v${o.version} expired without a response`, metadata: { offerId: o.id } });
    await audit(tx, { tenantId, userId: null }, { action: "offer.expired", entityType: "offer", entityId: o.id });
    await notify(tx, { tenantId, userIds: [o.createdBy], category: "recruitment", title: "An offer expired", body: "The candidate did not respond before the expiry date.", href: `/recruitment/offers/${o.id}`, dedupeKey: `offer:${o.id}:expired` });
  }
  return due.length;
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export type OfferListItem = {
  id: string;
  version: number;
  status: OfferStatus;
  candidateName: string;
  candidateId: string;
  openingTitle: string;
  joiningDate: string;
  expiresOn: string;
  annualCtc: number;
  sentAt: string | null;
  respondedAt: string | null;
};

export async function listOffers(ctx: RequestContext, opts: { status?: OfferStatus } = {}): Promise<OfferListItem[]> {
  if (!canSeeOffers(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ o: offers, first: candidates.firstName, last: candidates.lastName, title: jobOpenings.title })
      .from(offers)
      .innerJoin(candidates, eq(candidates.id, offers.candidateId))
      .innerJoin(jobOpenings, eq(jobOpenings.id, offers.openingId))
      .where(opts.status ? eq(offers.status, opts.status) : undefined)
      .orderBy(desc(offers.updatedAt))
      .limit(300);
    return rows.map(({ o, first, last, title }) => ({
      id: o.id,
      version: o.version,
      status: o.status,
      candidateName: fullName({ firstName: first, lastName: last }),
      candidateId: o.candidateId,
      openingTitle: title,
      joiningDate: o.joiningDate,
      expiresOn: o.expiresOn,
      annualCtc: o.annualCtc,
      sentAt: o.sentAt?.toISOString() ?? null,
      respondedAt: o.respondedAt?.toISOString() ?? null,
    }));
  });
}

export type OfferDetail = OfferListItem & {
  applicationId: string;
  openingId: string;
  candidateEmail: string;
  designation: { id: string | null; name: string | null };
  department: { id: string | null; name: string | null };
  location: { id: string | null; name: string | null };
  legalEntity: { id: string; name: string | null };
  reportingManager: { id: string | null; name: string | null };
  employmentType: string;
  probationMonths: number;
  noticePeriodDays: number;
  components: OfferComponent[];
  defaultSplit: boolean;
  responseNote: string | null;
  responseIp: string | null;
  employeeId: string | null;
  document: { id: string; fileName: string; createdAt: string } | null;
  templateUsed: boolean;
  esign: { configured: boolean; label: string; provider: string | null; status: string | null };
  approval: { requestId: string; status: string; steps: { stepNo: number; name: string; status: string; decidedAt: string | null; comment: string | null; decidedBy: string | null }[] } | null;
  versions: { id: string; version: number; status: string; createdAt: string }[];
  events: { id: string; type: string; body: string | null; createdAt: string; actorName: string | null }[];
  createdByName: string | null;
  canManage: boolean;
};

export async function getOffer(ctx: RequestContext, offerId: string): Promise<OfferDetail> {
  if (!canSeeOffers(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select({ o: offers, c: candidates, title: jobOpenings.title, des: designations.title, dep: departments.name, loc: locations.name, le: legalEntities.name, mgr: employees.displayName })
      .from(offers)
      .innerJoin(candidates, eq(candidates.id, offers.candidateId))
      .innerJoin(jobOpenings, eq(jobOpenings.id, offers.openingId))
      .leftJoin(designations, eq(designations.id, offers.designationId))
      .leftJoin(departments, eq(departments.id, offers.departmentId))
      .leftJoin(locations, eq(locations.id, offers.locationId))
      .leftJoin(legalEntities, eq(legalEntities.id, offers.legalEntityId))
      .leftJoin(employees, eq(employees.id, offers.reportingManagerId))
      .where(eq(offers.id, offerId));
    if (!row) throw notFound("Offer");
    const o = row.o;
    const [doc] = o.documentId ? await tx.select({ id: documents.id, fileName: documents.fileName, createdAt: documents.createdAt }).from(documents).where(eq(documents.id, o.documentId)) : [];
    const [request] = await tx
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.subjectType, "offer"), eq(approvalRequests.subjectId, o.id)))
      .orderBy(desc(approvalRequests.createdAt))
      .limit(1);
    const steps = request ? await tx.select().from(approvalSteps).where(eq(approvalSteps.requestId, request.id)).orderBy(asc(approvalSteps.stepNo)) : [];
    const versions = await tx.select({ id: offers.id, version: offers.version, status: offers.status, createdAt: offers.createdAt }).from(offers).where(eq(offers.applicationId, o.applicationId)).orderBy(desc(offers.version));
    const events = await tx
      .select()
      .from(applicationEvents)
      .where(and(eq(applicationEvents.applicationId, o.applicationId), inArray(applicationEvents.type, ["offer_created", "offer_updated", "offer_submitted", "offer_approved", "offer_approval_rejected", "offer_sent", "offer_resent", "offer_revised", "offer_rescinded", "offer_expired", "offer_accepted", "offer_declined", "offer_viewed", "hired"])))
      .orderBy(desc(applicationEvents.createdAt))
      .limit(100);
    const names = await userNames(tx, [o.createdBy, ...steps.map((s) => s.decidedBy), ...events.map((e) => e.actorUserId)]);
    const es = esignStatus();
    return {
      id: o.id,
      version: o.version,
      status: o.status,
      candidateName: fullName(row.c),
      candidateId: o.candidateId,
      candidateEmail: row.c.email,
      openingTitle: row.title,
      openingId: o.openingId,
      applicationId: o.applicationId,
      joiningDate: o.joiningDate,
      expiresOn: o.expiresOn,
      annualCtc: o.annualCtc,
      sentAt: o.sentAt?.toISOString() ?? null,
      respondedAt: o.respondedAt?.toISOString() ?? null,
      designation: { id: o.designationId, name: row.des },
      department: { id: o.departmentId, name: row.dep },
      location: { id: o.locationId, name: row.loc },
      legalEntity: { id: o.legalEntityId, name: row.le },
      reportingManager: { id: o.reportingManagerId, name: row.mgr },
      employmentType: o.employmentType,
      probationMonths: o.probationMonths,
      noticePeriodDays: o.noticePeriodDays,
      components: o.components,
      defaultSplit: isDefaultSplit(o.components),
      responseNote: o.responseNote,
      responseIp: o.responseIp,
      employeeId: o.employeeId,
      document: doc ? { id: doc.id, fileName: doc.fileName, createdAt: doc.createdAt.toISOString() } : null,
      templateUsed: !!o.templateVersionId,
      esign: { ...es, provider: o.esignProvider, status: o.esignStatus },
      approval: request
        ? {
            requestId: request.id,
            status: request.status,
            steps: steps.map((s) => ({ stepNo: s.stepNo, name: s.name, status: s.status, decidedAt: s.decidedAt?.toISOString() ?? null, comment: s.comment, decidedBy: s.decidedBy ? (names.get(s.decidedBy) ?? null) : null })),
          }
        : null,
      versions: versions.map((v) => ({ id: v.id, version: v.version, status: v.status, createdAt: v.createdAt.toISOString() })),
      events: events.map((e) => ({ id: e.id, type: e.type, body: e.body, createdAt: e.createdAt.toISOString(), actorName: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null })),
      createdByName: names.get(o.createdBy) ?? null,
      canManage: canManageOffers(ctx),
    };
  });
}

/** Defaults for a new offer from the application's opening. */
export async function offerDefaults(ctx: RequestContext, applicationId: string) {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select({ a: applications, o: jobOpenings, first: candidates.firstName, last: candidates.lastName, kind: recruitmentStages.kind })
      .from(applications)
      .innerJoin(jobOpenings, eq(jobOpenings.id, applications.openingId))
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .innerJoin(recruitmentStages, eq(recruitmentStages.id, applications.stageId))
      .where(eq(applications.id, applicationId));
    if (!row) throw notFound("Application");
    const [req] = row.o.requisitionId ? await tx.select().from(jobRequisitions).where(eq(jobRequisitions.id, row.o.requisitionId)) : [];
    return {
      candidateName: fullName({ firstName: row.first, lastName: row.last }),
      openingTitle: row.o.title,
      atOfferStage: row.kind === "offer" && row.a.status === "active",
      departmentId: row.o.departmentId,
      locationId: row.o.locationId,
      designationId: req?.designationId ?? null,
      legalEntityId: req?.legalEntityId ?? null,
      reportingManagerId: row.o.hiringManagerEmployeeId,
      employmentType: row.o.employmentType,
    };
  });
}

