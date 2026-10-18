"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/lib/action";
import {
  assignPeersSchema,
  calibrateSchema,
  competencySchema,
  goalCheckinSchema,
  goalSchema,
  idSchema,
  pipSchema,
  pipUpdateSchema,
  promotionDecisionSchema,
  promotionSchema,
  ratingScaleSchema,
  reviewCycleSchema,
  reviewTemplateSchema,
  saveReviewSchema,
} from "@/lib/validation/talent";
import { installPerformanceDefaults, saveCompetency, saveRatingScale, saveReviewTemplate } from "@/server/services/talent/performance/setup";
import { checkInGoal, goalCheckinHistory, saveGoal } from "@/server/services/talent/performance/goals";
import {
  assignPeers,
  calibrateReview,
  closeCycle,
  launchCycle,
  listPeerAssignments,
  saveCycle,
  shareManagerReviews,
  startCalibration,
} from "@/server/services/talent/performance/cycles";
import { acknowledgeReview, saveReview, suggestCoachingTopics, summarizeReviewFeedback } from "@/server/services/talent/performance/reviews";
import { createPip, decidePromotion, recommendPromotion, updateDevelopmentPlanFromReview, updatePip } from "@/server/services/talent/performance/development";

const done = <T>(v: T) => {
  refresh();
  return v;
};

/* Setup */
export const installPerformanceDefaultsAction = defineAction({ input: z.object({}), permission: "performance.manage", scope: "all" }, async (ctx) =>
  done(await installPerformanceDefaults(ctx)),
);
export const saveRatingScaleAction = defineAction({ input: ratingScaleSchema, permission: "performance.manage", scope: "all" }, async (ctx, i) => done(await saveRatingScale(ctx, i)));
export const saveCompetencyAction = defineAction({ input: competencySchema, permission: "performance.manage", scope: "all" }, async (ctx, i) => done(await saveCompetency(ctx, i)));
export const saveReviewTemplateAction = defineAction({ input: reviewTemplateSchema, permission: "performance.manage", scope: "all" }, async (ctx, i) => done(await saveReviewTemplate(ctx, i)));

/* Goals */
export const saveGoalAction = defineAction({ input: goalSchema }, async (ctx, i) => done(await saveGoal(ctx, i)));
export const checkInGoalAction = defineAction({ input: goalCheckinSchema }, async (ctx, i) => done(await checkInGoal(ctx, i)));
export const goalHistoryAction = defineAction({ input: idSchema }, async (ctx, { id }) =>
  (await goalCheckinHistory(ctx, id)).map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
);

/* Cycles */
export const saveCycleAction = defineAction({ input: reviewCycleSchema, permission: "performance.manage", scope: "all" }, async (ctx, i) => done(await saveCycle(ctx, i)));
export const launchCycleAction = defineAction({ input: idSchema, permission: "performance.manage", scope: "all" }, async (ctx, { id }) => done(await launchCycle(ctx, id)));
export const startCalibrationAction = defineAction({ input: idSchema, permission: "performance.manage", scope: "all" }, async (ctx, { id }) => done(await startCalibration(ctx, id)));
export const shareReviewsAction = defineAction({ input: idSchema, permission: "performance.manage", scope: "all" }, async (ctx, { id }) => done(await shareManagerReviews(ctx, id)));
export const closeCycleAction = defineAction({ input: idSchema, permission: "performance.manage", scope: "all" }, async (ctx, { id }) => done(await closeCycle(ctx, id)));
export const calibrateAction = defineAction({ input: calibrateSchema, permission: "performance.manage", scope: "all" }, async (ctx, i) => done(await calibrateReview(ctx, i)));
export const assignPeersAction = defineAction({ input: assignPeersSchema }, async (ctx, i) => done(await assignPeers(ctx, i)));
export const peerAssignmentsAction = defineAction({ input: z.object({ cycleId: z.uuid(), employeeId: z.uuid() }) }, async (ctx, i) => listPeerAssignments(ctx, i.cycleId, i.employeeId));

/* Reviews */
export const saveReviewAction = defineAction({ input: saveReviewSchema }, async (ctx, i) => done(await saveReview(ctx, i)));
export const acknowledgeReviewAction = defineAction({ input: idSchema }, async (ctx, { id }) => done(await acknowledgeReview(ctx, id)));
export const summarizeFeedbackAction = defineAction({ input: idSchema }, async (ctx, { id }) => summarizeReviewFeedback(ctx, id));
export const coachingTopicsAction = defineAction({ input: idSchema }, async (ctx, { id }) => suggestCoachingTopics(ctx, id));
export const updateDevelopmentPlanAction = defineAction({ input: idSchema }, async (ctx, { id }) => done(await updateDevelopmentPlanFromReview(ctx, id)));

/* Promotions and PIPs */
export const recommendPromotionAction = defineAction({ input: promotionSchema }, async (ctx, i) => done(await recommendPromotion(ctx, i)));
export const decidePromotionAction = defineAction({ input: promotionDecisionSchema, permission: "performance.manage", scope: "all" }, async (ctx, i) => done(await decidePromotion(ctx, i)));
export const createPipAction = defineAction({ input: pipSchema }, async (ctx, i) => done(await createPip(ctx, i)));
export const updatePipAction = defineAction({ input: pipUpdateSchema }, async (ctx, i) => done(await updatePip(ctx, i)));
