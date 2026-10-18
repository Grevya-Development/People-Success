"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/lib/action";
import {
  actionPlanSchema,
  careerManagerNotesSchema,
  careerPlanSchema,
  idSchema,
  oneOnOneSchema,
  recognitionSchema,
  successionPlanSchema,
  surveyResponseSchema,
  surveySchema,
} from "@/lib/validation/talent";
import { closeSurvey, launchSurvey, saveSurvey, submitSurveyResponse } from "@/server/services/talent/engagement/surveys";
import { textThemeSummary } from "@/server/services/talent/engagement/results";
import { giveRecognition } from "@/server/services/talent/engagement/recognition";
import { saveOneOnOne } from "@/server/services/talent/engagement/one-on-ones";
import { saveActionPlan, saveCareerManagerNotes, saveCareerPlan, saveSuccessionPlan } from "@/server/services/talent/engagement/career";

const done = <T>(v: T) => {
  refresh();
  return v;
};

export const saveSurveyAction = defineAction({ input: surveySchema, permission: "engagement.manage", scope: "all" }, async (ctx, i) => done(await saveSurvey(ctx, i)));
export const launchSurveyAction = defineAction({ input: idSchema, permission: "engagement.manage", scope: "all" }, async (ctx, { id }) => done(await launchSurvey(ctx, id)));
export const closeSurveyAction = defineAction({ input: idSchema, permission: "engagement.manage", scope: "all" }, async (ctx, { id }) => done(await closeSurvey(ctx, id)));
export const submitSurveyResponseAction = defineAction({ input: surveyResponseSchema }, async (ctx, i) => done(await submitSurveyResponse(ctx, i)));
export const textThemesAction = defineAction({ input: z.object({ surveyId: z.uuid(), questionId: z.string().max(40) }), permission: "engagement.results", scope: "all" }, async (ctx, i) =>
  textThemeSummary(ctx, i.surveyId, i.questionId),
);
export const saveActionPlanAction = defineAction({ input: actionPlanSchema }, async (ctx, i) => done(await saveActionPlan(ctx, i)));
export const giveRecognitionAction = defineAction({ input: recognitionSchema, permission: "engagement.view" }, async (ctx, i) => done(await giveRecognition(ctx, i)));
export const saveOneOnOneAction = defineAction({ input: oneOnOneSchema }, async (ctx, i) => done(await saveOneOnOne(ctx, i)));
export const saveCareerPlanAction = defineAction({ input: careerPlanSchema }, async (ctx, i) => done(await saveCareerPlan(ctx, i)));
export const saveCareerNotesAction = defineAction({ input: careerManagerNotesSchema }, async (ctx, i) => done(await saveCareerManagerNotes(ctx, i)));
export const saveSuccessionPlanAction = defineAction({ input: successionPlanSchema, permission: "succession.manage", scope: "all" }, async (ctx, i) => done(await saveSuccessionPlan(ctx, i)));
