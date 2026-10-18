"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/lib/action";
import { leaveAdjustSchema, leaveApplySchema, leaveCancelSchema, leavePolicySchema, leavePreviewSchema, leaveTypeSchema } from "@/lib/validation/time";
import { applyLeave, attachableDocuments, cancelLeave, previewLeave } from "@/server/services/time/leave-requests";
import { adjustLeaveBalance } from "@/server/services/time/leave-ledger";
import { addStandardLeaveTypes, saveLeavePolicy, saveLeaveType, setLeavePolicyActive } from "@/server/services/time/leave-types";

export const previewLeaveAction = defineAction({ input: leavePreviewSchema, permission: "leave.view", scope: "self" }, async (ctx, input) => {
  const p = await previewLeave(ctx, input);
  const employeeId = input.employeeId ?? ctx.employeeId;
  const documents = p.documentRequired && employeeId ? await attachableDocuments(ctx, employeeId) : [];
  return {
    documents: documents.map((d) => ({ id: d.id, title: d.title })),
    days: p.days,
    tracksBalance: p.tracksBalance,
    balance: p.balance,
    pending: p.pending,
    available: p.available,
    after: p.after,
    documentRequired: p.documentRequired,
    holidays: p.holidays,
    breakdown: p.breakdown.map((d) => ({ date: d.date, kind: d.kind, days: d.days })),
    policy: p.policy,
    errors: p.errors,
  };
});

export const applyLeaveAction = defineAction({ input: leaveApplySchema, permission: "leave.view", scope: "self" }, async (ctx, input) => {
  const r = await applyLeave(ctx, input);
  refresh();
  return r;
});

export const cancelLeaveAction = defineAction({ input: leaveCancelSchema }, async (ctx, input) => {
  const r = await cancelLeave(ctx, input.requestId, input.reason);
  refresh();
  return r;
});

export const adjustLeaveBalanceAction = defineAction({ input: leaveAdjustSchema, permission: "leave.manage", scope: "all" }, async (ctx, input) => {
  const r = await adjustLeaveBalance(ctx, input);
  refresh();
  return r;
});

export const saveLeaveTypeAction = defineAction({ input: leaveTypeSchema, permission: "leave.manage", scope: "all" }, async (ctx, input) => {
  const r = await saveLeaveType(ctx, input);
  refresh();
  return { id: r.id };
});

export const addStandardLeaveTypesAction = defineAction({ input: z.object({}), permission: "leave.manage", scope: "all" }, async (ctx) => {
  const r = await addStandardLeaveTypes(ctx);
  refresh();
  return r;
});

export const saveLeavePolicyAction = defineAction({ input: leavePolicySchema, permission: "leave.manage", scope: "all" }, async (ctx, input) => {
  const r = await saveLeavePolicy(ctx, input);
  refresh();
  return { id: r.id, version: r.version };
});

export const setLeavePolicyActiveAction = defineAction(
  { input: z.object({ id: z.uuid(), isActive: z.boolean() }), permission: "leave.manage", scope: "all" },
  async (ctx, input) => {
    await setLeavePolicyActive(ctx, input.id, input.isActive);
    refresh();
    return null;
  },
);
