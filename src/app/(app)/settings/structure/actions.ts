"use server";

import { refresh } from "next/cache";
import { defineAction } from "@/server/lib/action";
import {
  removeStructureItem,
  saveBusinessUnit,
  saveCostCenter,
  saveDepartment,
  saveDesignation,
  saveGrade,
  saveJobFamily,
  saveTeam,
} from "@/server/services/settings/structure";
import {
  businessUnitSchema,
  costCenterSchema,
  departmentSchema,
  designationSchema,
  gradeSchema,
  jobFamilySchema,
  structureRefSchema,
  teamSchema,
} from "@/lib/validation/settings";

const opts = { permission: "org.manage", scope: "all" } as const;

export const saveDepartmentAction = defineAction({ input: departmentSchema, ...opts }, async (ctx, input) => {
  const res = await saveDepartment(ctx, input);
  refresh();
  return res;
});

export const saveDesignationAction = defineAction({ input: designationSchema, ...opts }, async (ctx, input) => {
  const res = await saveDesignation(ctx, input);
  refresh();
  return res;
});

export const saveGradeAction = defineAction({ input: gradeSchema, ...opts }, async (ctx, input) => {
  const res = await saveGrade(ctx, input);
  refresh();
  return res;
});

export const saveJobFamilyAction = defineAction({ input: jobFamilySchema, ...opts }, async (ctx, input) => {
  const res = await saveJobFamily(ctx, input);
  refresh();
  return res;
});

export const saveCostCenterAction = defineAction({ input: costCenterSchema, ...opts }, async (ctx, input) => {
  const res = await saveCostCenter(ctx, input);
  refresh();
  return res;
});

export const saveBusinessUnitAction = defineAction({ input: businessUnitSchema, ...opts }, async (ctx, input) => {
  const res = await saveBusinessUnit(ctx, input);
  refresh();
  return res;
});

export const saveTeamAction = defineAction({ input: teamSchema, ...opts }, async (ctx, input) => {
  const res = await saveTeam(ctx, input);
  refresh();
  return res;
});

export const removeStructureItemAction = defineAction({ input: structureRefSchema, ...opts }, async (ctx, { kind, id }) => {
  const res = await removeStructureItem(ctx, kind, id);
  refresh();
  return res;
});
