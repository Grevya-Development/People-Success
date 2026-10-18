"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/lib/action";
import {
  adjustmentRunSchema,
  assignStructureSchema,
  bankResponseSchema,
  calculateRunSchema,
  componentSchema,
  disbursementSchema,
  fnfRunSchema,
  importInputsSchema,
  loanSchema,
  lockRunSchema,
  markVerifiedSchema,
  openPeriodSchema,
  payrollInputSchema,
  periodIdSchema,
  ruleSetVersionSchema,
  runIdSchema,
  structurePreviewSchema,
  structureSchema,
  taxDeclarationSchema,
} from "@/lib/validation/payroll";
import { openPeriod } from "@/server/services/payroll/periods";
import { createInput, deleteInput, importInputsCsv } from "@/server/services/payroll/inputs";
import { calculateRun } from "@/server/services/payroll/calculate";
import {
  cancelRun,
  createAdjustmentRun,
  createFnfRun,
  createRegularRun,
  getRunEmployeeDetail,
  lockPayrollRun,
  submitRun,
  withdrawRun,
} from "@/server/services/payroll/runs";
import { applyBankResponse, generateDisbursementFile } from "@/server/services/payroll/disbursement";
import { publishPayslips } from "@/server/services/payroll/payslips";
import { explainRun } from "@/server/services/payroll/explain";
import { assignStructure, previewStructure, saveComponent, saveStructure, seedDefaultComponents } from "@/server/services/payroll/config";
import { createRuleSetVersion, markRuleSetVerified, seedDefaultRuleSets } from "@/server/services/payroll/rules";
import { createLoan } from "@/server/services/payroll/loans";
import { reviewDeclaration, saveMyDeclaration } from "@/server/services/payroll/declarations";

const done = <T,>(v: T) => {
  refresh();
  return v;
};
const idSchema = z.object({ id: z.uuid() });

/* Periods, inputs and runs */

export const openPeriodAction = defineAction({ input: openPeriodSchema, permission: "payroll.run", scope: "all" }, async (ctx, input) =>
  done({ id: (await openPeriod(ctx, input)).id }),
);

export const createInputAction = defineAction({ input: payrollInputSchema, permission: "payroll.run", scope: "all" }, async (ctx, input) =>
  done({ id: (await createInput(ctx, input)).id }),
);

export const deleteInputAction = defineAction({ input: idSchema, permission: "payroll.run", scope: "all" }, async (ctx, input) => done(await deleteInput(ctx, input.id)));

export const importInputsAction = defineAction({ input: importInputsSchema, permission: "payroll.run", scope: "all" }, async (ctx, input) => {
  const res = await importInputsCsv(ctx, input);
  if (res.committed) refresh();
  return res;
});

export const createRegularRunAction = defineAction({ input: periodIdSchema, permission: "payroll.run", scope: "all" }, async (ctx, input) =>
  done({ runId: (await createRegularRun(ctx, input.periodId)).run.id }),
);

export const createFnfRunAction = defineAction({ input: fnfRunSchema, permission: "payroll.run", scope: "all" }, async (ctx, input) =>
  done({ runId: (await createFnfRun(ctx, input)).id }),
);

export const createAdjustmentRunAction = defineAction({ input: adjustmentRunSchema, permission: "payroll.run", scope: "all" }, async (ctx, input) =>
  done({ runId: (await createAdjustmentRun(ctx, input)).id }),
);

export const calculateRunAction = defineAction({ input: calculateRunSchema, permission: "payroll.run", scope: "all" }, async (ctx, input) => {
  const r = await calculateRun(ctx, input);
  return done({ reused: r.reused, employees: r.totals?.employees ?? 0, errors: "errors" in r ? r.errors : 0 });
});

export const submitRunAction = defineAction({ input: runIdSchema, permission: "payroll.run", scope: "all" }, async (ctx, input) => {
  await submitRun(ctx, input.runId);
  return done(null);
});

export const withdrawRunAction = defineAction({ input: runIdSchema, permission: "payroll.run", scope: "all" }, async (ctx, input) => {
  await withdrawRun(ctx, input.runId);
  return done(null);
});

export const cancelRunAction = defineAction({ input: runIdSchema, permission: "payroll.run", scope: "all" }, async (ctx, input) => {
  await cancelRun(ctx, input.runId);
  return done(null);
});

export const lockRunAction = defineAction({ input: lockRunSchema, permission: "payroll.approve", scope: "all" }, async (ctx, input) => done(await lockPayrollRun(ctx, input)));

export const generateDisbursementAction = defineAction({ input: disbursementSchema, permission: "payroll.run", scope: "all" }, async (ctx, input) => {
  const r = await generateDisbursementFile(ctx, input);
  return done({ created: r.created, count: r.count, skippedNoBank: r.skippedNoBank, alreadyIncluded: r.alreadyIncluded, batchId: r.batchId });
});

export const bankResponseAction = defineAction({ input: bankResponseSchema, permission: "payroll.run", scope: "all" }, async (ctx, input) => done(await applyBankResponse(ctx, input)));

export const publishPayslipsAction = defineAction({ input: runIdSchema }, async (ctx, input) => done(await publishPayslips(ctx, input.runId)));

export const explainRunAction = defineAction({ input: runIdSchema, permission: "payroll.view", scope: "all" }, async (ctx, input) => explainRun(ctx, input.runId));

export const getRunEmployeeAction = defineAction({ input: z.object({ runEmployeeId: z.uuid() }) }, async (ctx, input) => {
  const d = await getRunEmployeeDetail(ctx, input.runEmployeeId);
  return { ...d, snapshot: JSON.parse(JSON.stringify(d.snapshot)) as Record<string, unknown> };
});

/* Configuration */

export const seedComponentsAction = defineAction({ input: z.object({}), permission: "payroll.config", scope: "all" }, async (ctx) => done(await seedDefaultComponents(ctx)));

export const saveComponentAction = defineAction({ input: componentSchema, permission: "payroll.config", scope: "all" }, async (ctx, input) =>
  done({ id: (await saveComponent(ctx, input)).id }),
);

export const saveStructureAction = defineAction({ input: structureSchema, permission: "payroll.config", scope: "all" }, async (ctx, input) =>
  done({ id: (await saveStructure(ctx, input)).id }),
);

export const previewStructureAction = defineAction({ input: structurePreviewSchema }, async (ctx, input) => previewStructure(ctx, input));

export const assignStructureAction = defineAction({ input: assignStructureSchema, permission: "payroll.config", scope: "all" }, async (ctx, input) => done(await assignStructure(ctx, input)));

export const seedRuleSetsAction = defineAction({ input: z.object({}), permission: "payroll.config", scope: "all" }, async (ctx) => done(await seedDefaultRuleSets(ctx)));

export const createRuleSetVersionAction = defineAction({ input: ruleSetVersionSchema, permission: "payroll.config", scope: "all" }, async (ctx, input) => {
  const r = await createRuleSetVersion(ctx, input);
  return done({ id: r.id, version: r.version });
});

export const markRuleSetVerifiedAction = defineAction({ input: markVerifiedSchema, permission: "payroll.config", scope: "all" }, async (ctx, input) => done(await markRuleSetVerified(ctx, input)));

export const createLoanAction = defineAction({ input: loanSchema, permission: "payroll.run", scope: "all" }, async (ctx, input) => done({ id: (await createLoan(ctx, input)).id }));

/* Self-service */

export const saveDeclarationAction = defineAction({ input: taxDeclarationSchema }, async (ctx, input) => done(await saveMyDeclaration(ctx, input)));

export const reviewDeclarationAction = defineAction(
  { input: z.object({ id: z.uuid(), decision: z.enum(["verify", "return"]) }), permission: "payroll.run", scope: "all" },
  async (ctx, input) => done(await reviewDeclaration(ctx, input.id, input.decision)),
);
