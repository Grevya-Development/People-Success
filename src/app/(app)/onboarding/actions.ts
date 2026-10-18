"use server";

import { refresh, updateTag } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/lib/action";
import { AppError } from "@/server/lib/errors";
import { requestMeta } from "@/server/auth/context";
import { accessTag } from "@/server/auth/access";
import {
  deleteTemplate,
  deleteTemplateTask,
  installStandardTemplates,
  saveTemplate,
  saveTemplateTask,
} from "@/server/services/lifecycle/templates";
import {
  acknowledgeForTask,
  cancelPlan,
  markJoinedFromPlan,
  reassignTask,
  recordCheckin,
  refreshPlan,
  reopenTask,
  sendTaskReminder,
  setBuddy,
  setPlanTaskStatus,
  startOnboarding,
  uploadForTask,
  waiveTask,
} from "@/server/services/lifecycle/plans";
import {
  cancelExit,
  completeExit,
  confirmAccessRevocation,
  generateExitLetters,
  initiateExit,
  recordExitAssetReturn,
  saveExitInterview,
  saveSettlementInputs,
  setSettlementStatus,
  submitResignation,
  suspendExitLogin,
  updateExitTerms,
  withdrawResignation,
} from "@/server/services/lifecycle/exits";
import {
  accessRevocationSchema,
  acknowledgeForTaskSchema,
  cancelExitSchema,
  checkinSchema,
  completeExitSchema,
  exitAssetReturnSchema,
  exitCaseIdSchema,
  exitInterviewSchema,
  exitTermsSchema,
  generateLettersSchema,
  hrExitSchema,
  idSchema,
  markJoinedSchema,
  planTaskStatusSchema,
  reassignTaskSchema,
  resignationSchema,
  setBuddySchema,
  settlementInputsSchema,
  settlementStatusSchema,
  startPlanSchema,
  suspendAccessSchema,
  taskIdSchema,
  templateSchema,
  templateTaskSchema,
  waiveTaskSchema,
} from "@/lib/validation/lifecycle";

const manageOnboarding = { permission: "onboarding.manage", scope: "all" } as const;
const manageExits = { permission: "exits.manage", scope: "all" } as const;

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export const installStandardLifecycleTemplatesAction = defineAction({ input: z.object({}), ...manageOnboarding }, async (ctx) => {
  const r = await installStandardTemplates(ctx);
  refresh();
  return r;
});

export const saveTemplateAction = defineAction({ input: templateSchema, ...manageOnboarding }, async (ctx, input) => {
  const r = await saveTemplate(ctx, input);
  refresh();
  return r;
});

export const deleteTemplateAction = defineAction({ input: idSchema, ...manageOnboarding }, async (ctx, { id }) => {
  const r = await deleteTemplate(ctx, id);
  refresh();
  return r;
});

export const saveTemplateTaskAction = defineAction({ input: templateTaskSchema, ...manageOnboarding }, async (ctx, input) => {
  const r = await saveTemplateTask(ctx, input);
  refresh();
  return r;
});

export const deleteTemplateTaskAction = defineAction({ input: idSchema, ...manageOnboarding }, async (ctx, { id }) => {
  const r = await deleteTemplateTask(ctx, id);
  refresh();
  return r;
});

/* ------------------------------------------------------------------ */
/* Plans and tasks                                                     */
/* ------------------------------------------------------------------ */

export const startOnboardingAction = defineAction({ input: startPlanSchema, ...manageOnboarding }, async (ctx, input) => {
  const r = await startOnboarding(ctx, input);
  refresh();
  return r;
});

export const setTaskStatusAction = defineAction({ input: planTaskStatusSchema }, async (ctx, input) => {
  const r = await setPlanTaskStatus(ctx, input);
  refresh();
  return r;
});

export const waiveTaskAction = defineAction({ input: waiveTaskSchema }, async (ctx, input) => {
  const r = await waiveTask(ctx, input);
  refresh();
  return r;
});

export const reopenTaskAction = defineAction({ input: taskIdSchema }, async (ctx, { taskId }) => {
  const r = await reopenTask(ctx, taskId);
  refresh();
  return r;
});

export const sendReminderAction = defineAction({ input: taskIdSchema }, async (ctx, { taskId }) => sendTaskReminder(ctx, taskId));

export const reassignTaskAction = defineAction({ input: reassignTaskSchema }, async (ctx, input) => {
  const r = await reassignTask(ctx, input);
  refresh();
  return r;
});

export const setBuddyAction = defineAction({ input: setBuddySchema, ...manageOnboarding }, async (ctx, input) => {
  const r = await setBuddy(ctx, input);
  refresh();
  return r;
});

export const cancelPlanAction = defineAction({ input: idSchema }, async (ctx, { id }) => {
  const r = await cancelPlan(ctx, id);
  refresh();
  return r;
});

export const refreshPlanAction = defineAction({ input: idSchema }, async (ctx, { id }) => {
  const r = await refreshPlan(ctx, id);
  refresh();
  return r;
});

export const uploadForTaskAction = defineAction({ input: z.instanceof(FormData, { message: "Invalid upload" }) }, async (ctx, form) => {
  const parsed = z
    .object({ taskId: z.uuid(), title: z.string().trim().min(1, "Enter a title").max(160) })
    .safeParse({ taskId: form.get("taskId"), title: form.get("title") });
  if (!parsed.success) throw new AppError("VALIDATION", "Please correct the highlighted fields.", { fieldErrors: { title: ["Enter a title"] } });
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION", "Choose a file to upload.", { fieldErrors: { file: ["Choose a file"] } });
  const meta = await requestMeta();
  const r = await uploadForTask(ctx, { ...parsed.data, file }, meta);
  refresh();
  return r;
});

export const acknowledgeForTaskAction = defineAction({ input: acknowledgeForTaskSchema }, async (ctx, input) => {
  const r = await acknowledgeForTask(ctx, input, { ip: (await requestMeta()).ip });
  refresh();
  return r;
});

export const recordCheckinAction = defineAction({ input: checkinSchema }, async (ctx, input) => {
  const r = await recordCheckin(ctx, input);
  refresh();
  return r;
});

export const markJoinedAction = defineAction({ input: markJoinedSchema, ...manageOnboarding }, async (ctx, input) => {
  const r = await markJoinedFromPlan(ctx, input);
  refresh();
  return r;
});

/* ------------------------------------------------------------------ */
/* Exits                                                               */
/* ------------------------------------------------------------------ */

export const submitResignationAction = defineAction({ input: resignationSchema, permission: "exits.view", scope: "self" }, async (ctx, input) => {
  const r = await submitResignation(ctx, input);
  refresh();
  return r;
});

export const withdrawResignationAction = defineAction({ input: exitCaseIdSchema }, async (ctx, { exitCaseId }) => {
  const r = await withdrawResignation(ctx, exitCaseId);
  refresh();
  return r;
});

export const initiateExitAction = defineAction({ input: hrExitSchema, ...manageExits }, async (ctx, input) => {
  const r = await initiateExit(ctx, input);
  refresh();
  return r;
});

export const updateExitTermsAction = defineAction({ input: exitTermsSchema, ...manageExits }, async (ctx, input) => {
  const r = await updateExitTerms(ctx, input);
  refresh();
  return r;
});

export const saveExitInterviewAction = defineAction({ input: exitInterviewSchema, ...manageExits }, async (ctx, input) => {
  const r = await saveExitInterview(ctx, input);
  refresh();
  return r;
});

export const saveSettlementInputsAction = defineAction({ input: settlementInputsSchema }, async (ctx, input) => {
  const r = await saveSettlementInputs(ctx, input);
  refresh();
  return r;
});

export const setSettlementStatusAction = defineAction({ input: settlementStatusSchema }, async (ctx, input) => {
  const r = await setSettlementStatus(ctx, input);
  refresh();
  return r;
});

export const generateLettersAction = defineAction({ input: generateLettersSchema, ...manageExits }, async (ctx, input) => {
  const r = await generateExitLetters(ctx, input);
  refresh();
  return { count: Object.keys(r.documents).length };
});

export const returnExitAssetAction = defineAction({ input: exitAssetReturnSchema }, async (ctx, input) => {
  const r = await recordExitAssetReturn(ctx, input);
  refresh();
  return r;
});

export const confirmAccessRevocationAction = defineAction({ input: accessRevocationSchema }, async (ctx, input) => {
  const r = await confirmAccessRevocation(ctx, input);
  refresh();
  return r;
});

export const suspendLoginAction = defineAction({ input: suspendAccessSchema, permission: "users.manage", scope: "all" }, async (ctx, { exitCaseId }) => {
  const r = await suspendExitLogin(ctx, exitCaseId);
  for (const userId of r.affectedUserIds) updateTag(accessTag(userId));
  refresh();
  return null;
});

export const completeExitAction = defineAction({ input: completeExitSchema, ...manageExits }, async (ctx, input) => {
  const r = await completeExit(ctx, input);
  refresh();
  return r;
});

export const cancelExitAction = defineAction({ input: cancelExitSchema, ...manageExits }, async (ctx, input) => {
  const r = await cancelExit(ctx, input);
  refresh();
  return r;
});
