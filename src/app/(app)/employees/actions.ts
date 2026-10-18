"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/lib/action";
import {
  addressSchema,
  changeRequestSchema,
  compensationSchema,
  createEmployeeSchema,
  dependentSchema,
  emergencyContactSchema,
  jobChangeSchema,
  qualificationSchema,
  selfUpdateSchema,
  sensitiveSchema,
  skillSchema,
  updatePersonalSchema,
} from "@/lib/validation/employees";
import {
  addCompensation,
  changeJob,
  confirmProbation,
  createEmployee,
  deleteDraftEmployee,
  markJoined,
  rehire,
  selfUpdate,
  updatePersonal,
} from "@/server/services/employees/mutations";
import { updateSensitive } from "@/server/services/employees/sensitive";
import {
  assignAsset,
  deleteDependent,
  deleteEmergencyContact,
  deleteQualification,
  removeSkill,
  returnAsset,
  saveDependent,
  saveEmergencyContact,
  saveQualification,
  saveSkill,
  upsertAddress,
} from "@/server/services/employees/sections";
import { submitChangeRequest } from "@/server/services/employees/change-requests";
import { commitImport, previewImport } from "@/server/services/employees/import";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const done = () => {
  refresh();
  return null;
};

export const createEmployeeAction = defineAction({ input: createEmployeeSchema }, async (ctx, input) => {
  const e = await createEmployee(ctx, input);
  return { id: e.id, code: e.employeeCode };
});

export const updatePersonalAction = defineAction({ input: updatePersonalSchema }, async (ctx, input) => {
  await updatePersonal(ctx, input);
  return done();
});

export const selfUpdateAction = defineAction({ input: selfUpdateSchema }, async (ctx, input) => {
  await selfUpdate(ctx, input);
  return done();
});

export const changeJobAction = defineAction({ input: jobChangeSchema }, async (ctx, input) => {
  const r = await changeJob(ctx, input);
  refresh();
  return { effectiveFrom: r.effectiveFrom };
});

export const markJoinedAction = defineAction({ input: z.object({ employeeId: z.uuid(), joinedOn: isoDate }) }, async (ctx, i) => {
  await markJoined(ctx, i.employeeId, i.joinedOn);
  return done();
});

export const confirmProbationAction = defineAction({ input: z.object({ employeeId: z.uuid(), confirmedOn: isoDate }) }, async (ctx, i) => {
  await confirmProbation(ctx, i.employeeId, i.confirmedOn);
  return done();
});

export const rehireAction = defineAction(
  { input: z.object({ employeeId: z.uuid(), joiningDate: isoDate, reason: z.string().trim().min(3).max(300) }) },
  async (ctx, i) => {
    await rehire(ctx, i.employeeId, i.joiningDate, i.reason);
    return done();
  },
);

export const deleteDraftEmployeeAction = defineAction({ input: z.object({ employeeId: z.uuid() }) }, async (ctx, i) => {
  await deleteDraftEmployee(ctx, i.employeeId);
  return null;
});

export const addCompensationAction = defineAction({ input: compensationSchema }, async (ctx, input) => {
  await addCompensation(ctx, input);
  return done();
});

export const updateSensitiveAction = defineAction({ input: sensitiveSchema }, async (ctx, input) => {
  const r = await updateSensitive(ctx, input);
  refresh();
  return r;
});

export const upsertAddressAction = defineAction({ input: addressSchema }, async (ctx, i) => {
  await upsertAddress(ctx, i);
  return done();
});

export const saveEmergencyContactAction = defineAction({ input: emergencyContactSchema }, async (ctx, i) => {
  await saveEmergencyContact(ctx, i);
  return done();
});

export const deleteEmergencyContactAction = defineAction({ input: z.object({ employeeId: z.uuid(), id: z.uuid() }) }, async (ctx, i) => {
  await deleteEmergencyContact(ctx, i.employeeId, i.id);
  return done();
});

export const saveDependentAction = defineAction({ input: dependentSchema }, async (ctx, i) => {
  await saveDependent(ctx, i);
  return done();
});

export const deleteDependentAction = defineAction({ input: z.object({ employeeId: z.uuid(), id: z.uuid() }) }, async (ctx, i) => {
  await deleteDependent(ctx, i.employeeId, i.id);
  return done();
});

export const saveQualificationAction = defineAction({ input: qualificationSchema }, async (ctx, i) => {
  await saveQualification(ctx, i);
  return done();
});

export const deleteQualificationAction = defineAction({ input: z.object({ employeeId: z.uuid(), id: z.uuid() }) }, async (ctx, i) => {
  await deleteQualification(ctx, i.employeeId, i.id);
  return done();
});

export const saveSkillAction = defineAction({ input: skillSchema }, async (ctx, i) => {
  await saveSkill(ctx, i);
  return done();
});

export const removeSkillAction = defineAction({ input: z.object({ employeeId: z.uuid(), skillId: z.uuid() }) }, async (ctx, i) => {
  await removeSkill(ctx, i.employeeId, i.skillId);
  return done();
});

export const assignAssetAction = defineAction(
  {
    input: z.object({
      employeeId: z.uuid(),
      tag: z.string().trim().min(1, "Enter the asset tag").max(40),
      category: z.string().trim().min(1, "Enter a category").max(40),
      name: z.string().trim().min(1, "Enter a name").max(120),
      serialNumber: z.string().trim().max(80).nullish(),
      dueBackOn: isoDate.nullish().or(z.literal("").transform(() => null)),
      condition: z.string().trim().max(200).nullish(),
    }),
  },
  async (ctx, i) => {
    await assignAsset(ctx, i);
    return done();
  },
);

export const returnAssetAction = defineAction(
  { input: z.object({ assignmentId: z.uuid(), condition: z.string().trim().max(200).nullish() }) },
  async (ctx, i) => {
    await returnAsset(ctx, i.assignmentId, i.condition ?? null);
    return done();
  },
);

export const submitChangeRequestAction = defineAction({ input: changeRequestSchema }, async (ctx, input) => {
  await submitChangeRequest(ctx, input);
  return done();
});

const importInput = z.object({
  csv: z.string().min(1, "Choose a CSV file").max(2_000_000, "The file is larger than 2 MB"),
  createMissing: z.boolean(),
});

export const previewImportAction = defineAction({ input: importInput }, async (ctx, i) => previewImport(ctx, i.csv, i.createMissing));

export const commitImportAction = defineAction({ input: importInput }, async (ctx, i) => commitImport(ctx, i.csv, i.createMissing));
