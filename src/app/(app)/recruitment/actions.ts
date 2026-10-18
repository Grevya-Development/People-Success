"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { defineAction } from "@/server/lib/action";
import { sendNow } from "@/server/services/email";
import {
  applyToOpeningSchema,
  candidateEmailSchema,
  candidateTagsSchema,
  emailDraftSchema,
  feedbackSchema,
  idSchema,
  interviewStatusSchema,
  manualCandidateSchema,
  matchSchema,
  moveStageOrderSchema,
  moveStageSchema,
  noteSchema,
  offerSchema,
  openingSchema,
  openingTransitionSchema,
  parseResumeSchema,
  poolMemberSchema,
  questionsSchema,
  rejectApplicationSchema,
  renameStageSchema,
  requisitionSchema,
  requisitionTransitionSchema,
  rescindOfferSchema,
  scheduleInterviewSchema,
  scorecardSchema,
  stageActiveSchema,
  stageSchema,
  talentPoolSchema,
  updateOfferSchema,
  updateOpeningSchema,
  updateRequisitionSchema,
  withdrawApplicationSchema,
} from "@/lib/validation/recruitment";
import {
  createPositionForRequisition,
  createRequisition,
  submitRequisition,
  transitionRequisition,
  updateRequisition,
} from "@/server/services/recruitment/requisitions";
import { createOpening, transitionOpening, updateOpening } from "@/server/services/recruitment/openings";
import { addStage, installDefaultScorecard, moveStageOrder, renameStage, saveScorecard, setStageActive } from "@/server/services/recruitment/stages";
import { applyCandidateToOpening, createManualCandidate, createTalentPool, setPoolMembership, updateCandidateTags } from "@/server/services/recruitment/candidates";
import {
  addApplicationNote,
  emailCandidate,
  moveApplicationStage,
  rejectApplication,
  reopenApplication,
  withdrawApplication,
} from "@/server/services/recruitment/applications";
import { draftCandidateEmail, generateInterviewQuestions, parseCandidateResume, summarizeApplication } from "@/server/services/recruitment/ai";
import { scheduleInterview, setInterviewStatus, submitFeedback } from "@/server/services/recruitment/interviews";
import { createOffer, rescindOffer, resendOfferLink, reviseOffer, sendOffer, submitOffer } from "@/server/services/recruitment/offers";

const sendAfter = (ids: (string | null | undefined)[]) => {
  const list = ids.filter(Boolean) as string[];
  if (list.length) after(async () => {
    for (const id of list) await sendNow(id);
  });
};

/* Requisitions -------------------------------------------------------- */

export const createRequisitionAction = defineAction(
  { input: z.object({ data: requisitionSchema, submit: z.boolean() }), permission: "requisitions.create", scope: "all" },
  async (ctx, { data, submit }) => createRequisition(ctx, data, { submit }),
);

export const updateRequisitionAction = defineAction({ input: updateRequisitionSchema }, async (ctx, { id, data }) => {
  const r = await updateRequisition(ctx, id, data);
  refresh();
  return r;
});

export const submitRequisitionAction = defineAction({ input: idSchema }, async (ctx, { id }) => {
  const r = await submitRequisition(ctx, id);
  refresh();
  return r;
});

export const transitionRequisitionAction = defineAction({ input: requisitionTransitionSchema }, async (ctx, i) => {
  const r = await transitionRequisition(ctx, i.id, i.to, i.reason);
  refresh();
  return r;
});

export const createPositionForRequisitionAction = defineAction({ input: idSchema, permission: "org.manage", scope: "all" }, async (ctx, { id }) => {
  const r = await createPositionForRequisition(ctx, id);
  refresh();
  return r;
});

/* Openings ------------------------------------------------------------ */

export const createOpeningAction = defineAction({ input: openingSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, data) => createOpening(ctx, data));

export const updateOpeningAction = defineAction({ input: updateOpeningSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, { id, data }) => {
  const r = await updateOpening(ctx, id, data);
  refresh();
  return r;
});

export const transitionOpeningAction = defineAction({ input: openingTransitionSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, { id, to }) => {
  const r = await transitionOpening(ctx, id, to);
  refresh();
  return r;
});

/* Settings ------------------------------------------------------------ */

export const addStageAction = defineAction({ input: stageSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, i) => {
  const r = await addStage(ctx, i);
  refresh();
  return r;
});
export const renameStageAction = defineAction({ input: renameStageSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, i) => {
  await renameStage(ctx, i.id, i.name);
  refresh();
  return null;
});
export const moveStageOrderAction = defineAction({ input: moveStageOrderSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, i) => {
  await moveStageOrder(ctx, i.id, i.direction);
  refresh();
  return null;
});
export const setStageActiveAction = defineAction({ input: stageActiveSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, i) => {
  await setStageActive(ctx, i.id, i.isActive);
  refresh();
  return null;
});
export const saveScorecardAction = defineAction({ input: scorecardSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, i) => {
  const r = await saveScorecard(ctx, i);
  refresh();
  return r;
});
export const installDefaultScorecardAction = defineAction({ input: z.object({}), permission: "recruitment.manage", scope: "all" }, async (ctx) => {
  const r = await installDefaultScorecard(ctx);
  refresh();
  return r;
});

/* Candidates ---------------------------------------------------------- */

export const createCandidateAction = defineAction({ input: manualCandidateSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, i) => createManualCandidate(ctx, i));

export const updateTagsAction = defineAction({ input: candidateTagsSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, i) => {
  await updateCandidateTags(ctx, i.candidateId, i.tags);
  refresh();
  return null;
});
export const createPoolAction = defineAction({ input: talentPoolSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, i) => {
  const r = await createTalentPool(ctx, i);
  refresh();
  return r;
});
export const poolMemberAction = defineAction({ input: poolMemberSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, i) => {
  await setPoolMembership(ctx, i);
  refresh();
  return null;
});
export const applyToOpeningAction = defineAction({ input: applyToOpeningSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, i) => {
  const r = await applyCandidateToOpening(ctx, i.candidateId, i.openingId);
  refresh();
  return r;
});

/* Pipeline ------------------------------------------------------------ */

export const moveStageAction = defineAction({ input: moveStageSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, i) => {
  const r = await moveApplicationStage(ctx, i);
  refresh();
  return r;
});
export const rejectApplicationAction = defineAction({ input: rejectApplicationSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, i) => {
  const r = await rejectApplication(ctx, i);
  sendAfter([r.outboxId]);
  refresh();
  return { applicationId: r.applicationId };
});
export const withdrawApplicationAction = defineAction({ input: withdrawApplicationSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, i) => {
  const r = await withdrawApplication(ctx, i);
  refresh();
  return r;
});
export const reopenApplicationAction = defineAction({ input: z.object({ applicationId: z.uuid() }), permission: "recruitment.manage", scope: "all" }, async (ctx, i) => {
  const r = await reopenApplication(ctx, i.applicationId);
  refresh();
  return r;
});
export const addNoteAction = defineAction({ input: noteSchema, permission: "recruitment.view", scope: "all" }, async (ctx, i) => {
  const r = await addApplicationNote(ctx, i);
  refresh();
  return r;
});
export const emailCandidateAction = defineAction({ input: candidateEmailSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, i) => {
  const r = await emailCandidate(ctx, i);
  sendAfter([r.outboxId]);
  refresh();
  return null;
});

/* AI ------------------------------------------------------------------ */

export const parseResumeAction = defineAction({ input: parseResumeSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, i) => {
  const r = await parseCandidateResume(ctx, i.candidateId, i.pastedText);
  refresh();
  return r;
});
export const matchApplicationAction = defineAction({ input: matchSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, i) => {
  const r = await summarizeApplication(ctx, i.applicationId, i.pastedText);
  refresh();
  return { source: r.source, reason: r.reason };
});
export const interviewQuestionsAction = defineAction({ input: questionsSchema, permission: "recruitment.view", scope: "all" }, async (ctx, i) =>
  generateInterviewQuestions(ctx, i.openingId, i.roundName),
);
export const emailDraftAction = defineAction({ input: emailDraftSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, i) => draftCandidateEmail(ctx, i.applicationId, i.kind));

/* Interviews ---------------------------------------------------------- */

export const scheduleInterviewAction = defineAction({ input: scheduleInterviewSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, i) => {
  const r = await scheduleInterview(ctx, i);
  sendAfter(r.outboxIds);
  refresh();
  return { id: r.id, conflictsOverridden: r.conflicts.length };
});
export const interviewStatusAction = defineAction({ input: interviewStatusSchema, permission: "recruitment.manage", scope: "all" }, async (ctx, i) => {
  await setInterviewStatus(ctx, i);
  refresh();
  return null;
});
export const submitFeedbackAction = defineAction({ input: feedbackSchema, permission: "interviews.feedback", scope: "all" }, async (ctx, i) => {
  const r = await submitFeedback(ctx, i);
  refresh();
  return { feedbackId: r.feedbackId };
});

/* Offers -------------------------------------------------------------- */

export const createOfferAction = defineAction({ input: offerSchema, permission: "offers.manage", scope: "all" }, async (ctx, i) => createOffer(ctx, i));
export const reviseOfferAction = defineAction({ input: updateOfferSchema, permission: "offers.manage", scope: "all" }, async (ctx, i) => {
  const r = await reviseOffer(ctx, i.offerId, i.data);
  sendAfter([r.outboxId]);
  refresh();
  return { id: r.id, newVersion: r.newVersion };
});
export const submitOfferAction = defineAction({ input: z.object({ offerId: z.uuid() }), permission: "offers.manage", scope: "all" }, async (ctx, i) => {
  const r = await submitOffer(ctx, i.offerId);
  refresh();
  return r;
});
/** The response token is only emailed; it is never returned to the browser. */
export const sendOfferAction = defineAction({ input: z.object({ offerId: z.uuid() }), permission: "offers.manage", scope: "all" }, async (ctx, i) => {
  const r = await sendOffer(ctx, i.offerId);
  sendAfter([r.outboxId]);
  refresh();
  return { id: r.id };
});
export const resendOfferAction = defineAction({ input: z.object({ offerId: z.uuid() }), permission: "offers.manage", scope: "all" }, async (ctx, i) => {
  const r = await resendOfferLink(ctx, i.offerId);
  sendAfter([r.outboxId]);
  refresh();
  return { id: r.id };
});
export const rescindOfferAction = defineAction({ input: rescindOfferSchema, permission: "offers.manage", scope: "all" }, async (ctx, i) => {
  const r = await rescindOffer(ctx, i.offerId, i.reason);
  sendAfter([r.outboxId]);
  refresh();
  return { id: r.id };
});
