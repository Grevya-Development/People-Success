import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { can } from "../../auth/context";
import type { Tx } from "../../db/client";
import { approvalPolicies, memberships, roles } from "../../db/schema";
import type { ApprovalStepDefinition } from "../../db/schema/platform";
import { diff } from "../../lib/audit";
import { forbidden, notFound, validation } from "../../lib/errors";
import { DEFAULT_APPROVAL_POLICIES } from "../tenancy/provision";
import { approvalPolicySchema, conditionsToJson, type ApprovalPolicyInput, type ApprovalPolicyValues } from "@/lib/validation/settings";
import { titleCase } from "@/lib/format";
import { auditAs, type SettingsCtx } from "./shared";
import { memberOptions, roleOptions } from "./lookups";

/** Policies may be edited by workflow admins or company-settings admins. */
export function authorizePolicies(ctx: SettingsCtx) {
  if (!can(ctx, "workflows.manage", "all") && !can(ctx, "settings.manage", "all")) throw forbidden();
}

export const canManagePolicies = (ctx: Pick<SettingsCtx, "grants">) =>
  can(ctx, "workflows.manage", "all") || can(ctx, "settings.manage", "all");

const SUBJECT_LABELS: Record<string, string> = {
  leave_request: "Leave requests",
  attendance_regularization: "Attendance regularizations",
  timesheet: "Timesheets",
  job_requisition: "Job requisitions",
  offer: "Offers",
  expense_claim: "Expense claims",
  payroll_run: "Payroll runs",
  resignation: "Resignations",
  data_change_request: "Profile corrections",
};

export const SUBJECT_TYPES = DEFAULT_APPROVAL_POLICIES.map((p) => p.subjectType);
export const subjectLabel = (subjectType: string) => SUBJECT_LABELS[subjectType] ?? titleCase(subjectType);

export async function listApprovalPolicies(ctx: SettingsCtx) {
  authorizePolicies(ctx);
  const rows = await ctx.db((tx) =>
    tx
      .select()
      .from(approvalPolicies)
      .orderBy(asc(approvalPolicies.subjectType), desc(approvalPolicies.isActive), desc(approvalPolicies.priority), asc(approvalPolicies.createdAt)),
  );
  const types = [...new Set([...SUBJECT_TYPES, ...rows.map((r) => r.subjectType)])];
  return types.map((subjectType) => ({
    subjectType,
    label: subjectLabel(subjectType),
    policies: rows.filter((r) => r.subjectType === subjectType),
  }));
}

export async function getApprovalPolicyEditor(ctx: SettingsCtx, id: string | null) {
  authorizePolicies(ctx);
  return ctx.db(async (tx) => {
    const policy = id ? (await tx.select().from(approvalPolicies).where(eq(approvalPolicies.id, id)))[0] : null;
    if (id && !policy) throw notFound("Approval policy");
    const [roleList, members] = await Promise.all([roleOptions(tx, { builtInOnly: true }), memberOptions(tx, ctx.tenantId)]);
    return {
      policy,
      roles: roleList.map((r) => ({ value: r.key!, label: r.name })),
      members,
    };
  });
}

async function toSteps(tx: Tx, tenantId: string, input: ApprovalPolicyValues): Promise<ApprovalStepDefinition[]> {
  const roleKeys = input.steps.filter((s) => s.kind === "role").map((s) => s.roleKey!);
  const userIds = input.steps.filter((s) => s.kind === "user").map((s) => s.userId!);
  if (roleKeys.length) {
    const found = await tx.select({ key: roles.key }).from(roles).where(inArray(roles.key, roleKeys));
    const have = new Set(found.map((r) => r.key));
    const i = input.steps.findIndex((s) => s.kind === "role" && !have.has(s.roleKey!));
    if (i >= 0) throw validation("Choose a valid role.", { [`steps.${i}.roleKey`]: ["Role not found"] });
  }
  if (userIds.length) {
    const found = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "active"), inArray(memberships.userId, userIds)));
    const have = new Set(found.map((r) => r.userId));
    const i = input.steps.findIndex((s) => s.kind === "user" && !have.has(s.userId!));
    if (i >= 0) throw validation("Choose an active member.", { [`steps.${i}.userId`]: ["Not an active member"] });
  }
  return input.steps.map((s) => {
    const approver: ApprovalStepDefinition["approver"] =
      s.kind === "role"
        ? { kind: "role", roleKey: s.roleKey! }
        : s.kind === "user"
          ? { kind: "user", userId: s.userId! }
          : { kind: s.kind };
    return { name: s.name, approver, ...(s.escalateAfterHours ? { escalateAfterHours: s.escalateAfterHours } : {}) };
  });
}

/**
 * Create or update a policy. Every saved change increments `version`;
 * in-flight requests keep the policyVersion they started with.
 */
export async function saveApprovalPolicy(ctx: SettingsCtx, raw: ApprovalPolicyInput) {
  authorizePolicies(ctx);
  const input = approvalPolicySchema.parse(raw);
  return ctx.db(async (tx) => {
    const before = input.id ? (await tx.select().from(approvalPolicies).where(eq(approvalPolicies.id, input.id)).for("update"))[0] : null;
    if (input.id && !before) throw notFound("Approval policy");
    if (before && before.subjectType !== input.subjectType) throw validation("The subject type of a policy cannot be changed.");
    const steps = await toSteps(tx, ctx.tenantId, input);
    const values = {
      subjectType: input.subjectType,
      name: input.name,
      priority: input.priority,
      isActive: input.isActive,
      conditions: conditionsToJson(input.conditions),
      steps,
    };
    const [row] = before
      ? await tx
          .update(approvalPolicies)
          .set({ ...values, version: before.version + 1 })
          .where(eq(approvalPolicies.id, before.id))
          .returning()
      : await tx.insert(approvalPolicies).values({ tenantId: ctx.tenantId, ...values }).returning();
    await auditAs(tx, ctx, {
      action: before ? "approval_policy.updated" : "approval_policy.created",
      entityType: "approval_policy",
      entityId: row.id,
      changes: diff(
        before ? { name: before.name, priority: before.priority, isActive: before.isActive, conditions: before.conditions, steps: before.steps } : null,
        { name: row.name, priority: row.priority, isActive: row.isActive, conditions: row.conditions, steps: row.steps },
      ),
      metadata: { version: row.version, subjectType: row.subjectType },
    });
    return { id: row.id, version: row.version };
  });
}

export async function setApprovalPolicyActive(ctx: SettingsCtx, id: string, isActive: boolean) {
  authorizePolicies(ctx);
  return ctx.db(async (tx) => {
    const [before] = await tx.select().from(approvalPolicies).where(eq(approvalPolicies.id, id)).for("update");
    if (!before) throw notFound("Approval policy");
    if (before.isActive === isActive) return { id, version: before.version };
    const [row] = await tx
      .update(approvalPolicies)
      .set({ isActive, version: before.version + 1 })
      .where(eq(approvalPolicies.id, id))
      .returning();
    await auditAs(tx, ctx, {
      action: isActive ? "approval_policy.activated" : "approval_policy.deactivated",
      entityType: "approval_policy",
      entityId: id,
      changes: diff({ isActive: before.isActive }, { isActive }),
      metadata: { version: row.version },
    });
    return { id, version: row.version };
  });
}
