import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Tx } from "../../db/client";
import { authorize, can, canAccessEmployee, getTeamEmployeeIds, scopeOf, type RequestContext } from "../../auth/context";
import {
  approvalPolicies,
  approvalRequests,
  approvalSteps,
  assetAssignments,
  assets,
  departments,
  designations,
  documents,
  employees,
  employmentRecords,
  exitCases,
  leaveBalances,
  leaveTypes,
  lifecyclePlans,
  lifecycleTemplateTasks,
  lifecycleTemplates,
  memberships,
  positions,
  tasks,
  users,
} from "../../db/schema";
import type { ExitInterview } from "../../db/schema/lifecycle";
import { audit, diff } from "../../lib/audit";
import { AppError, conflict, forbidden, invalidState, notFound, validation } from "../../lib/errors";
import { cancelApprovalForSubject, startApproval, type ApprovalActor } from "../approvals/engine";
import { emitDomainEvent } from "../events";
import { notify } from "../notifications";
import { userIdsWithPermission } from "../directory";
import { returnAsset } from "../employees/sections";
import { setMembershipStatus } from "../users/members";
import { storeGeneratedPdf } from "../../pdf/store";
import { todayIn } from "@/lib/format";
import {
  EXIT_REASON_LABELS,
  type ExitReasonCategory,
  type exitInterviewSchema,
  type exitTermsSchema,
  type hrExitSchema,
  type resignationSchema,
  type settlementInputsSchema,
  type SettlementStatus,
} from "@/lib/validation/lifecycle";
import { closePlan, createPlan, loadPlanDetail, planTasks, type PlanDetail } from "./plans";
import { LETTER_TITLES, renderExitLetter, type LetterKind } from "./letters";
import { STANDARD_OFFBOARDING } from "./templates";
import {
  OPEN_TASK_STATUSES,
  PLAN_CONTAINER,
  cfg,
  completeTask,
  daysBetween,
  hrUserIds,
  isSettled,
  isRequired,
  missingEvidence,
  reconcilePlans,
  shiftDate,
  type LifecycleActor,
  type SettlementInputs,
  type TaskConfig,
} from "./shared";

type ExitRow = typeof exitCases.$inferSelect;
/** The exit interview as stored; `regretted` is an extension of the schema type (see report). */
export type StoredInterview = ExitInterview & { regretted?: boolean; conductedByName?: string | null };

const OPEN_EXIT_STATUSES = ["submitted", "under_review", "accepted", "in_progress"] as const;
const ACTIVE_EXIT_STATUSES = ["accepted", "in_progress"] as const;

const actorOf = (ctx: RequestContext): LifecycleActor => ({ tenantId: ctx.tenantId, userId: ctx.userId });
const canManageExits = (ctx: RequestContext) => can(ctx, "exits.manage", "all");
const canSettle = (ctx: RequestContext) => canManageExits(ctx) || can(ctx, "payroll.run", "all") || can(ctx, "payroll.approve", "all");
const lwdOf = (e: Pick<ExitRow, "approvedLastWorkingDate" | "requestedLastWorkingDate">) => e.approvedLastWorkingDate ?? e.requestedLastWorkingDate;

async function lockExit(tx: Tx, id: string) {
  const [row] = await tx.select().from(exitCases).where(eq(exitCases.id, id)).for("update");
  if (!row) throw notFound("Exit case");
  return row;
}

async function offboardingPlanFor(tx: Tx, exitCaseId: string) {
  const [plan] = await tx
    .select()
    .from(lifecyclePlans)
    .where(and(eq(lifecyclePlans.exitCaseId, exitCaseId), eq(lifecyclePlans.kind, "offboarding")))
    .orderBy(desc(lifecyclePlans.createdAt))
    .limit(1);
  return plan ?? null;
}

async function taskByCode(tx: Tx, planId: string, code: string) {
  const rows = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.containerType, PLAN_CONTAINER), eq(tasks.containerId, planId), sql`${tasks.config}->>'code' = ${code}`))
    .orderBy(asc(tasks.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Policies and templates this module relies on                        */
/* ------------------------------------------------------------------ */

/**
 * HR-initiated exits always go through an approval. The default policy is
 * created on first use if the tenant has none (provisioning predates it).
 */
export async function ensureExitCasePolicy(tx: Tx, tenantId: string) {
  const [existing] = await tx
    .select({ id: approvalPolicies.id })
    .from(approvalPolicies)
    .where(and(eq(approvalPolicies.tenantId, tenantId), eq(approvalPolicies.subjectType, "exit_case")))
    .limit(1);
  if (existing) return;
  await tx.insert(approvalPolicies).values({
    tenantId,
    subjectType: "exit_case",
    name: "HR-initiated exit: HR approval",
    steps: [{ name: "HR approval", approver: { kind: "role", roleKey: "hr_admin" } }],
  });
}

/** Make sure an offboarding checklist exists so every accepted exit gets one. */
async function ensureOffboardingTemplate(tx: Tx, tenantId: string) {
  const [any] = await tx
    .select({ id: lifecycleTemplates.id })
    .from(lifecycleTemplates)
    .where(and(eq(lifecycleTemplates.tenantId, tenantId), eq(lifecycleTemplates.kind, "offboarding"), eq(lifecycleTemplates.isActive, true)))
    .limit(1);
  if (any) return;
  const [row] = await tx
    .insert(lifecycleTemplates)
    .values({ tenantId, kind: "offboarding", name: STANDARD_OFFBOARDING.name, description: STANDARD_OFFBOARDING.description, conditions: {} })
    .onConflictDoUpdate({ target: [lifecycleTemplates.tenantId, lifecycleTemplates.kind, lifecycleTemplates.name], set: { isActive: true } })
    .returning({ id: lifecycleTemplates.id });
  const [{ n }] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(lifecycleTemplateTasks).where(eq(lifecycleTemplateTasks.templateId, row.id));
  if (!n) {
    await tx.insert(lifecycleTemplateTasks).values(STANDARD_OFFBOARDING.tasks.map((t, i) => ({ tenantId, templateId: row.id, ...t, sortOrder: (i + 1) * 10 })));
  }
}

/* ------------------------------------------------------------------ */
/* Resignation (employee)                                              */
/* ------------------------------------------------------------------ */

export async function submitResignation(ctx: RequestContext, input: z.output<typeof resignationSchema>) {
  authorize(ctx, "exits.view", "self");
  if (!ctx.employeeId) throw forbidden("Only employees can resign.");
  const employeeId = ctx.employeeId;
  const today = todayIn();
  if (input.requestedLastWorkingDate < today) {
    throw validation("The last working day cannot be in the past.", { requestedLastWorkingDate: ["Choose today or later"] });
  }
  return ctx.db(async (tx) => {
    const [emp] = await tx.select().from(employees).where(and(eq(employees.id, employeeId), isNull(employees.deletedAt))).for("update");
    if (!emp) throw notFound("Employee");
    if (emp.status !== "active") throw invalidState("Only active employees can submit a resignation.");
    const [open] = await tx.select({ id: exitCases.id }).from(exitCases).where(and(eq(exitCases.employeeId, employeeId), inArray(exitCases.status, [...OPEN_EXIT_STATUSES])));
    if (open) throw conflict("You already have an open exit request.");
    const [ec] = await tx
      .insert(exitCases)
      .values({
        tenantId: ctx.tenantId,
        employeeId,
        type: "resignation",
        status: "submitted",
        submittedOn: today,
        requestedLastWorkingDate: input.requestedLastWorkingDate,
        noticePeriodDays: emp.noticePeriodDays,
        reasonCategory: input.reasonCategory,
        reasonDetail: input.reasonDetail,
        initiatedBy: ctx.userId,
      })
      .returning();
    await startApproval(tx, ctx, {
      subjectType: "resignation",
      subjectId: ec.id,
      title: `Resignation: ${emp.displayName}`,
      requestedBy: ctx.userId,
      subjectEmployeeId: employeeId,
      context: { noticePeriodDays: emp.noticePeriodDays },
    });
    await audit(tx, ctx, {
      action: "exit.resignation_submitted",
      entityType: "exit_case",
      entityId: ec.id,
      metadata: { employeeId, requestedLastWorkingDate: input.requestedLastWorkingDate, reasonCategory: input.reasonCategory },
    });
    await emitDomainEvent(tx, ctx.tenantId, "resignation.submitted", { employeeId, exitCaseId: ec.id, requestedLastWorkingDate: input.requestedLastWorkingDate });
    return { id: ec.id };
  });
}

/** Withdraw a resignation that has not been accepted yet. Cancels the approval. */
export async function withdrawResignation(ctx: RequestContext, exitCaseId: string) {
  return ctx.db(async (tx) => {
    const ec = await lockExit(tx, exitCaseId);
    if (ec.employeeId !== ctx.employeeId) throw forbidden();
    if (ec.status !== "submitted") throw invalidState("Only a resignation that is still awaiting approval can be withdrawn. Talk to HR.");
    await cancelApprovalForSubject(tx, ctx, "resignation", ec.id);
    // The approval handler marks the case withdrawn; make sure even without a pending request.
    await tx.update(exitCases).set({ status: "withdrawn" }).where(and(eq(exitCases.id, ec.id), eq(exitCases.status, "submitted")));
    await audit(tx, ctx, { action: "exit.resignation_withdrawn", entityType: "exit_case", entityId: ec.id });
    return { id: ec.id };
  });
}

/* ------------------------------------------------------------------ */
/* HR-initiated exits                                                  */
/* ------------------------------------------------------------------ */

export async function initiateExit(ctx: RequestContext, input: z.output<typeof hrExitSchema>) {
  authorize(ctx, "exits.manage", "all");
  return ctx.db(async (tx) => {
    const [emp] = await tx.select().from(employees).where(and(eq(employees.id, input.employeeId), isNull(employees.deletedAt))).for("update");
    if (!emp) throw notFound("Employee");
    if (emp.status !== "active" && emp.status !== "on_notice") throw invalidState("Exits can be started for active employees only.");
    if (emp.id === ctx.employeeId) throw forbidden("You cannot start an exit for yourself. Use the resignation flow.");
    if (input.type === "termination") {
      const typed = (input.confirmation ?? "").trim().toUpperCase();
      if (typed !== emp.employeeCode.toUpperCase()) {
        throw validation("Type the employee code exactly to confirm the termination.", { confirmation: [`Type ${emp.employeeCode} to confirm`] });
      }
    }
    if (input.lastWorkingDate < emp.joiningDate) throw validation("The last working day cannot be before the joining date.", { lastWorkingDate: ["Before joining date"] });
    const [open] = await tx.select({ id: exitCases.id }).from(exitCases).where(and(eq(exitCases.employeeId, emp.id), inArray(exitCases.status, [...OPEN_EXIT_STATUSES])));
    if (open) throw conflict(`${emp.displayName} already has an open exit case.`);
    const [ec] = await tx
      .insert(exitCases)
      .values({
        tenantId: ctx.tenantId,
        employeeId: emp.id,
        type: input.type,
        status: "under_review",
        submittedOn: todayIn(),
        requestedLastWorkingDate: input.lastWorkingDate,
        noticePeriodDays: emp.noticePeriodDays,
        reasonCategory: input.reasonCategory,
        reasonDetail: input.reasonDetail,
        initiatedBy: ctx.userId,
      })
      .returning();
    await ensureExitCasePolicy(tx, ctx.tenantId);
    await startApproval(tx, ctx, {
      subjectType: "exit_case",
      subjectId: ec.id,
      title: `${EXIT_TYPE_TITLE[input.type]}: ${emp.displayName}`,
      requestedBy: ctx.userId,
      subjectEmployeeId: emp.id,
      context: { type: input.type },
    });
    await audit(tx, ctx, {
      action: "exit.initiated",
      entityType: "exit_case",
      entityId: ec.id,
      metadata: { employeeId: emp.id, type: input.type, lastWorkingDate: input.lastWorkingDate, reasonCategory: input.reasonCategory },
    });
    return { id: ec.id };
  });
}

const EXIT_TYPE_TITLE: Record<string, string> = {
  termination: "Termination",
  end_of_contract: "End of contract",
  retirement: "Retirement",
  absconding: "Absconding",
  mutual_separation: "Mutual separation",
  death: "Death in service",
  resignation: "Resignation",
};

/* ------------------------------------------------------------------ */
/* Approval outcomes (called by the approval handlers)                 */
/* ------------------------------------------------------------------ */

/** Accept an exit: on notice, LWD fixed, notice shortfall computed, offboarding plan created. */
export async function acceptExit(tx: Tx, actor: ApprovalActor, exitCaseId: string) {
  const ec = await lockExit(tx, exitCaseId);
  if (ec.status !== "submitted" && ec.status !== "under_review") return;
  const lwd = lwdOf(ec) ?? todayIn();
  const served = Math.max(0, daysBetween(ec.submittedOn, lwd));
  const shortfall = ec.type === "resignation" ? Math.max(0, ec.noticePeriodDays - served) : 0;
  await tx
    .update(exitCases)
    .set({
      status: "accepted",
      approvedLastWorkingDate: lwd,
      noticeShortfallDays: shortfall,
      shortfallTreatment: shortfall > 0 ? "recover" : "none",
      approvedBy: actor.userId,
    })
    .where(eq(exitCases.id, ec.id));
  const [emp] = await tx.select().from(employees).where(eq(employees.id, ec.employeeId)).for("update");
  const patch = {
    status: "on_notice" as const,
    lastWorkingDate: lwd,
    resignationDate: ec.type === "resignation" ? ec.submittedOn : emp.resignationDate,
  };
  await tx.update(employees).set(patch).where(eq(employees.id, emp.id));
  await audit(tx, actor, {
    action: "exit.accepted",
    entityType: "exit_case",
    entityId: ec.id,
    changes: diff({ status: emp.status, lastWorkingDate: emp.lastWorkingDate, resignationDate: emp.resignationDate }, patch),
    metadata: { employeeId: emp.id, type: ec.type, noticeShortfallDays: shortfall },
  });

  await ensureOffboardingTemplate(tx, actor.tenantId);
  await createPlan(tx, { tenantId: actor.tenantId, userId: actor.userId }, { employeeId: emp.id, kind: "offboarding", anchorDate: lwd, exitCaseId: ec.id, ifAbsent: true });

  await emitDomainEvent(tx, actor.tenantId, "exit.accepted", { employeeId: emp.id, exitCaseId: ec.id, type: ec.type, lastWorkingDate: lwd }, { dedupeKey: `exit-accepted:${ec.id}` });
  const managerUser = emp.managerId ? ((await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, emp.managerId)))[0]?.userId ?? null) : null;
  await notify(tx, {
    tenantId: actor.tenantId,
    userIds: [managerUser, ...(await hrUserIds(tx, actor.tenantId))].filter((u): u is string => !!u && u !== actor.userId),
    category: "exits",
    title: `Exit accepted: ${emp.displayName}`,
    body: `Last working day ${lwd}. The offboarding checklist has started.`,
    href: `/onboarding/exits/${ec.id}`,
    dedupeKey: `exit-accepted:${ec.id}`,
  });
}

export async function rejectExit(tx: Tx, actor: ApprovalActor, exitCaseId: string) {
  const ec = await lockExit(tx, exitCaseId);
  if (ec.status !== "submitted" && ec.status !== "under_review") return;
  await tx.update(exitCases).set({ status: "rejected", approvedBy: actor.userId }).where(eq(exitCases.id, ec.id));
  await audit(tx, actor, { action: "exit.rejected", entityType: "exit_case", entityId: ec.id });
}

export async function markExitWithdrawn(tx: Tx, actor: ApprovalActor, exitCaseId: string) {
  const ec = await lockExit(tx, exitCaseId);
  if (ec.status !== "submitted" && ec.status !== "under_review") return;
  await tx.update(exitCases).set({ status: "withdrawn" }).where(eq(exitCases.id, ec.id));
  await audit(tx, actor, { action: "exit.withdrawn", entityType: "exit_case", entityId: ec.id });
}

/* ------------------------------------------------------------------ */
/* Exit workspace (HR)                                                 */
/* ------------------------------------------------------------------ */

async function requireActive(tx: Tx, exitCaseId: string) {
  const ec = await lockExit(tx, exitCaseId);
  if (!(ACTIVE_EXIT_STATUSES as readonly string[]).includes(ec.status)) throw invalidState("This exit is not in progress.");
  return ec;
}

export async function updateExitTerms(ctx: RequestContext, input: z.output<typeof exitTermsSchema>) {
  authorize(ctx, "exits.manage", "all");
  return ctx.db(async (tx) => {
    const ec = await requireActive(tx, input.exitCaseId);
    if (input.approvedLastWorkingDate < ec.submittedOn) {
      throw validation("The last working day cannot be before the submission date.", { approvedLastWorkingDate: [`On or after ${ec.submittedOn}`] });
    }
    const served = Math.max(0, daysBetween(ec.submittedOn, input.approvedLastWorkingDate));
    const shortfall = ec.type === "resignation" ? Math.max(0, ec.noticePeriodDays - served) : 0;
    const treatment = shortfall === 0 ? "none" : input.shortfallTreatment === "none" ? "recover" : input.shortfallTreatment;
    const before = { approvedLastWorkingDate: ec.approvedLastWorkingDate, noticeShortfallDays: ec.noticeShortfallDays, shortfallTreatment: ec.shortfallTreatment };
    const patch = { approvedLastWorkingDate: input.approvedLastWorkingDate, noticeShortfallDays: shortfall, shortfallTreatment: treatment };
    await tx.update(exitCases).set(patch).where(eq(exitCases.id, ec.id));
    await tx.update(employees).set({ lastWorkingDate: input.approvedLastWorkingDate }).where(eq(employees.id, ec.employeeId));
    const oldLwd = lwdOf(ec);
    const plan = await offboardingPlanFor(tx, ec.id);
    if (plan && oldLwd && oldLwd !== input.approvedLastWorkingDate) {
      const delta = daysBetween(oldLwd, input.approvedLastWorkingDate);
      await tx.update(lifecyclePlans).set({ anchorDate: input.approvedLastWorkingDate }).where(eq(lifecyclePlans.id, plan.id));
      await tx
        .update(tasks)
        .set({ dueOn: sql`${tasks.dueOn} + ${delta}::int` })
        .where(and(eq(tasks.containerType, PLAN_CONTAINER), eq(tasks.containerId, plan.id), inArray(tasks.status, [...OPEN_TASK_STATUSES])));
    }
    await audit(tx, ctx, { action: "exit.terms_updated", entityType: "exit_case", entityId: ec.id, changes: diff(before, patch) });
    return { id: ec.id, noticeShortfallDays: shortfall, shortfallTreatment: treatment };
  });
}

export async function saveExitInterview(ctx: RequestContext, input: z.output<typeof exitInterviewSchema>) {
  authorize(ctx, "exits.manage", "all");
  return ctx.db(async (tx) => {
    const ec = await lockExit(tx, input.exitCaseId);
    if (!["accepted", "in_progress", "completed"].includes(ec.status)) throw invalidState("Record the interview once the exit is accepted.");
    const interview: StoredInterview = {
      conductedOn: input.conductedOn,
      conductedBy: ctx.userId,
      conductedByName: ctx.fullName ?? ctx.email,
      primaryReason: input.primaryReason,
      ratings: input.ratings,
      wouldRecommend: input.wouldRecommend,
      regretted: input.regretted,
      comments: input.comments ?? undefined,
    };
    await tx.update(exitCases).set({ exitInterview: interview }).where(eq(exitCases.id, ec.id));
    // Interview content is confidential; the audit records only that it was saved.
    await audit(tx, ctx, { action: "exit.interview_recorded", entityType: "exit_case", entityId: ec.id });
    await completeCodedTask(tx, ctx, ec.id, "exit_interview");
    return { id: ec.id };
  });
}

async function completeCodedTask(tx: Tx, ctx: RequestContext, exitCaseId: string, code: string, config?: TaskConfig) {
  const plan = await offboardingPlanFor(tx, exitCaseId);
  if (!plan) return;
  const task = await taskByCode(tx, plan.id, code);
  if (!task) return;
  if (config) await tx.update(tasks).set({ config }).where(eq(tasks.id, task.id));
  const fresh = config ? { ...task, config } : task;
  if ((OPEN_TASK_STATUSES as readonly string[]).includes(task.status) && !(await missingEvidence(tx, fresh, plan))) {
    await completeTask(tx, actorOf(ctx), fresh);
  }
}

export type LeaveSnapshotRow = SettlementInputs["leaveSnapshot"][number];

export async function leaveSnapshot(tx: Tx, employeeId: string): Promise<LeaveSnapshotRow[]> {
  const rows = await tx
    .select({ leaveTypeId: leaveBalances.leaveTypeId, code: leaveTypes.code, name: leaveTypes.name, balance: leaveBalances.balance, pending: leaveBalances.pending })
    .from(leaveBalances)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalances.leaveTypeId))
    .where(eq(leaveBalances.employeeId, employeeId))
    .orderBy(asc(leaveTypes.sortOrder), asc(leaveTypes.name));
  return rows;
}

const toPaise = (rupees: number) => Math.round(rupees * 100);

/**
 * Settlement inputs for payroll's full-and-final run. Stored on the
 * "Settlement inputs" task config (no dedicated column yet; see report).
 * Editable until the settlement is submitted for approval.
 */
export async function saveSettlementInputs(ctx: RequestContext, input: z.output<typeof settlementInputsSchema>) {
  if (!canSettle(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const ec = await lockExit(tx, input.exitCaseId);
    if (!["accepted", "in_progress"].includes(ec.status)) throw invalidState("Settlement inputs can be prepared while the exit is in progress.");
    if (ec.settlementStatus !== "not_started" && ec.settlementStatus !== "draft") throw invalidState("The settlement was submitted for approval; send it back to draft to edit the inputs.");
    const plan = await offboardingPlanFor(tx, ec.id);
    if (!plan) throw invalidState("This exit has no offboarding plan.");
    let task = await taskByCode(tx, plan.id, "settlement_inputs");
    if (!task) {
      [task] = await tx
        .insert(tasks)
        .values({
          tenantId: ctx.tenantId,
          title: "Prepare settlement inputs",
          ownerGroup: "finance",
          subjectEmployeeId: ec.employeeId,
          containerType: PLAN_CONTAINER,
          containerId: plan.id,
          dueOn: lwdOf(ec),
          kind: "form",
          config: { code: "settlement_inputs" },
          sortOrder: 900,
          createdBy: ctx.userId,
        })
        .returning();
    }
    const settlementInputs: SettlementInputs = {
      noticeRecoveryDays: input.noticeRecoveryDays,
      noticePayInLieuDays: input.noticePayInLieuDays,
      leaveEncashmentDays: input.leaveEncashmentDays,
      otherRecoveries: toPaise(input.otherRecoveries),
      otherRecoveriesNote: input.otherRecoveriesNote,
      otherPayments: toPaise(input.otherPayments),
      otherPaymentsNote: input.otherPaymentsNote,
      notes: input.notes,
      leaveSnapshot: await leaveSnapshot(tx, ec.employeeId),
      savedBy: ctx.userId,
      savedAt: new Date().toISOString(),
    };
    const config: TaskConfig = { ...cfg(task), settlementInputs };
    await tx.update(tasks).set({ config }).where(eq(tasks.id, task.id));
    // Amounts stay out of the audit log.
    await audit(tx, ctx, { action: "exit.settlement_inputs_saved", entityType: "exit_case", entityId: ec.id });
    await completeCodedTask(tx, ctx, ec.id, "settlement_inputs");
    return { id: ec.id };
  });
}

const SETTLEMENT_FLOW: Record<Exclude<SettlementStatus, "not_started">, { from: SettlementStatus[]; perm: "exits.manage" | "payroll.approve" | "either" }> = {
  draft: { from: ["not_started", "pending_approval"], perm: "either" },
  pending_approval: { from: ["draft"], perm: "exits.manage" },
  approved: { from: ["pending_approval"], perm: "payroll.approve" },
  paid: { from: ["approved"], perm: "payroll.approve" },
};

export async function setSettlementStatus(ctx: RequestContext, input: { exitCaseId: string; status: Exclude<SettlementStatus, "not_started"> }) {
  const rule = SETTLEMENT_FLOW[input.status];
  const allowed =
    rule.perm === "either" ? canManageExits(ctx) || can(ctx, "payroll.approve", "all") : rule.perm === "exits.manage" ? canManageExits(ctx) : can(ctx, "payroll.approve", "all");
  if (!allowed) throw forbidden(rule.perm === "payroll.approve" ? "Only payroll approvers can approve or pay settlements." : undefined);
  return ctx.db(async (tx) => {
    const ec = await lockExit(tx, input.exitCaseId);
    if (!["accepted", "in_progress", "completed"].includes(ec.status)) throw invalidState("The exit is not accepted.");
    if (!rule.from.includes(ec.settlementStatus)) {
      throw invalidState(`The settlement is ${ec.settlementStatus.replace(/_/g, " ")}; it cannot move to ${input.status.replace(/_/g, " ")}.`);
    }
    if (input.status === "draft" && ec.settlementStatus === "not_started") {
      const plan = await offboardingPlanFor(tx, ec.id);
      const task = plan ? await taskByCode(tx, plan.id, "settlement_inputs") : null;
      if (!task || !cfg(task).settlementInputs) throw invalidState("Save the settlement inputs first.");
    }
    await tx.update(exitCases).set({ settlementStatus: input.status }).where(eq(exitCases.id, ec.id));
    await audit(tx, ctx, {
      action: "exit.settlement_status",
      entityType: "exit_case",
      entityId: ec.id,
      changes: { settlementStatus: { from: ec.settlementStatus, to: input.status } },
    });
    const [emp] = await tx.select({ name: employees.displayName }).from(employees).where(eq(employees.id, ec.employeeId));
    if (input.status === "pending_approval") {
      const approvers = (await userIdsWithPermission(tx, ctx.tenantId, "payroll.approve")).filter((u) => u !== ctx.userId);
      await notify(tx, {
        tenantId: ctx.tenantId,
        userIds: approvers,
        category: "exits",
        title: `Settlement to approve: ${emp?.name ?? "employee"}`,
        body: "Full-and-final settlement inputs are ready for approval.",
        href: `/onboarding/exits/${ec.id}`,
        dedupeKey: `settlement-pending:${ec.id}:${Date.now()}`,
      });
    }
    return { id: ec.id, settlementStatus: input.status };
  });
}

/** Generate experience / relieving letters as PDFs; visible to the employee from the last working day. */
export async function generateExitLetters(ctx: RequestContext, input: { exitCaseId: string; kinds: LetterKind[] }) {
  authorize(ctx, "exits.manage", "all");
  return ctx.db(async (tx) => {
    const ec = await lockExit(tx, input.exitCaseId);
    if (!["accepted", "in_progress", "completed"].includes(ec.status)) throw invalidState("Letters can be generated once the exit is accepted.");
    const lwd = lwdOf(ec);
    if (!lwd) throw invalidState("Set the last working day first.");
    const plan = await offboardingPlanFor(tx, ec.id);
    const lettersTask = plan ? await taskByCode(tx, plan.id, "letters") : null;
    const previous = lettersTask ? (cfg(lettersTask).letters ?? {}) : await previousLetters(tx, ec.id);
    const visible = ec.status === "completed" || lwd <= todayIn();
    const out: Record<string, string> = { ...previous };
    for (const kind of [...new Set(input.kinds)]) {
      const letter = await renderExitLetter(tx, kind, {
        employeeId: ec.employeeId,
        lastWorkingDate: lwd,
        signatory: { name: ctx.fullName ?? "Authorised signatory", designation: "Human Resources" },
      });
      const supersedesId = previous[kind] ?? null;
      if (supersedesId) await tx.update(documents).set({ isCurrent: false }).where(eq(documents.id, supersedesId));
      const doc = await storeGeneratedPdf(tx, {
        tenantId: ctx.tenantId,
        bytes: letter.bytes,
        ownerType: "employee",
        ownerId: ec.employeeId,
        employeeId: ec.employeeId,
        category: "exit",
        title: `${LETTER_TITLES[kind]} – ${letter.employeeCode}`,
        fileName: `${kind}-letter-${letter.employeeCode}.pdf`,
        employeeVisible: visible,
        createdBy: ctx.userId,
        supersedesId,
      });
      await tx
        .update(documents)
        .set({ metadata: { generated: true, exitCaseId: ec.id, letterKind: kind, template: letter.source, missing: letter.missing } })
        .where(eq(documents.id, doc.id));
      out[kind] = doc.id;
      await audit(tx, ctx, { action: "exit.letter_generated", entityType: "exit_case", entityId: ec.id, metadata: { kind, documentId: doc.id, missing: letter.missing } });
    }
    if (lettersTask) await completeCodedTask(tx, ctx, ec.id, "letters", { ...cfg(lettersTask), letters: out });
    return { documents: out };
  });
}

async function previousLetters(tx: Tx, exitCaseId: string) {
  const rows = await tx
    .select({ id: documents.id, metadata: documents.metadata })
    .from(documents)
    .where(and(sql`${documents.metadata}->>'exitCaseId' = ${exitCaseId}`, eq(documents.isCurrent, true), isNull(documents.deletedAt)));
  const out: Record<string, string> = {};
  for (const r of rows) {
    const kind = (r.metadata as { letterKind?: string }).letterKind;
    if (kind) out[kind] = r.id;
  }
  return out;
}

/** Record an asset return from the exit workspace (requires assets.manage), then re-check the asset task. */
export async function recordExitAssetReturn(ctx: RequestContext, input: { exitCaseId: string; assignmentId: string; condition: string | null }) {
  const ec = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(exitCases).where(eq(exitCases.id, input.exitCaseId));
    if (!row) throw notFound("Exit case");
    const [a] = await tx.select({ employeeId: assetAssignments.employeeId }).from(assetAssignments).where(eq(assetAssignments.id, input.assignmentId));
    if (!a || a.employeeId !== row.employeeId) throw notFound("Asset assignment");
    return row;
  });
  if (!canManageExits(ctx) && !can(ctx, "assets.manage", "all")) throw forbidden();
  await returnAsset(ctx, input.assignmentId, input.condition);
  await ctx.db(async (tx) => {
    const plan = await offboardingPlanFor(tx, ec.id);
    if (plan) await reconcilePlans(tx, actorOf(ctx), [plan.id]);
  });
  return { id: ec.id };
}

/** IT / an administrator confirms access was revoked; only then is the task done. */
export async function confirmAccessRevocation(ctx: RequestContext, input: { taskId: string; note: string }) {
  if (!can(ctx, "users.manage", "all") && !can(ctx, "assets.manage", "all")) {
    throw forbidden("Only IT (asset managers) or user administrators can confirm access revocation.");
  }
  return ctx.db(async (tx) => {
    const [task] = await tx.select().from(tasks).where(and(eq(tasks.id, input.taskId), eq(tasks.containerType, PLAN_CONTAINER))).for("update");
    if (!task || cfg(task).code !== "access_revocation") throw notFound("Access revocation task");
    if (!(OPEN_TASK_STATUSES as readonly string[]).includes(task.status)) throw invalidState("This task is already closed.");
    const config: TaskConfig = { ...cfg(task), confirmation: { by: ctx.userId, at: new Date().toISOString(), note: input.note } };
    await tx.update(tasks).set({ config }).where(eq(tasks.id, task.id));
    await audit(tx, ctx, { action: "exit.access_revoked", entityType: "task", entityId: task.id, metadata: { note: input.note } });
    await completeTask(tx, actorOf(ctx), { ...task, config });
    return { id: task.id };
  });
}

/** Suspend the exiting employee's PeopleSuccess login (users.manage). Never automatic. */
export async function suspendExitLogin(ctx: RequestContext, exitCaseId: string) {
  authorize(ctx, "users.manage", "all");
  const membershipId = await ctx.db(async (tx) => {
    const [ec] = await tx.select().from(exitCases).where(eq(exitCases.id, exitCaseId));
    if (!ec) throw notFound("Exit case");
    const [emp] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, ec.employeeId));
    if (!emp?.userId) throw invalidState("This employee has no login.");
    const [m] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, emp.userId)));
    if (!m) throw invalidState("This employee is not a member of the organization.");
    return m.id;
  });
  const res = await setMembershipStatus(ctx, { membershipId, status: "suspended" });
  await ctx.db((tx) => audit(tx, ctx, { action: "exit.login_suspended", entityType: "exit_case", entityId: exitCaseId }));
  return res;
}

/**
 * Close the exit: employee exited, employment record closed (history kept),
 * letters made visible, case completed. Requires the last working day to have
 * passed and every required checklist task to be done or waived.
 */
export async function completeExit(ctx: RequestContext, input: { exitCaseId: string; eligibleForRehire: boolean; exitReason: string | null }) {
  authorize(ctx, "exits.manage", "all");
  const today = todayIn();
  return ctx.db(async (tx) => {
    const ec = await requireActive(tx, input.exitCaseId);
    const lwd = lwdOf(ec);
    if (!lwd) throw invalidState("Set the last working day first.");
    if (lwd > today) throw invalidState(`The exit can be completed on or after the last working day (${lwd}).`);
    const plan = await offboardingPlanFor(tx, ec.id);
    if (plan) {
      const rows = await planTasks(tx, plan.id);
      const blocking = rows.filter((t) => isRequired(t) && !isSettled(t));
      if (blocking.length) {
        throw new AppError("INVALID_STATE", `${blocking.length} required ${blocking.length === 1 ? "task is" : "tasks are"} still open. Complete or waive ${blocking.length === 1 ? "it" : "them"} first.`, {
          details: { tasks: blocking.map((t) => t.title) },
        });
      }
    }
    const [emp] = await tx.select().from(employees).where(eq(employees.id, ec.employeeId)).for("update");
    if (lwd < emp.joiningDate) throw invalidState("The last working day is before the joining date.");
    const exitDay = shiftDate(lwd, 1);
    const [open] = await tx
      .select()
      .from(employmentRecords)
      .where(and(eq(employmentRecords.employeeId, emp.id), isNull(employmentRecords.effectiveTo)))
      .for("update");
    if (open) {
      if (open.effectiveFrom >= exitDay) throw invalidState("A job change is scheduled after the last working day. Remove it before completing the exit.");
      await tx.update(employmentRecords).set({ effectiveTo: exitDay }).where(eq(employmentRecords.id, open.id));
    }
    const exitReason = input.exitReason ?? (ec.reasonCategory ? (EXIT_REASON_LABELS[ec.reasonCategory as ExitReasonCategory] ?? ec.reasonCategory) : EXIT_TYPE_TITLE[ec.type]);
    const patch = { status: "exited" as const, exitDate: lwd, lastWorkingDate: lwd, exitReason };
    await tx.update(employees).set(patch).where(eq(employees.id, emp.id));
    await tx.update(positions).set({ employeeId: null, status: "open" }).where(eq(positions.employeeId, emp.id));
    await tx.update(exitCases).set({ status: "completed", completedAt: new Date(), eligibleForRehire: input.eligibleForRehire }).where(eq(exitCases.id, ec.id));
    if (plan && plan.status !== "completed" && plan.status !== "cancelled") {
      await tx.update(lifecyclePlans).set({ status: "completed", completedAt: new Date(), progressPercent: 100 }).where(eq(lifecyclePlans.id, plan.id));
    }
    // Exit letters become visible to the employee now.
    await tx
      .update(documents)
      .set({ employeeVisible: true })
      .where(and(eq(documents.employeeId, emp.id), sql`${documents.metadata}->>'exitCaseId' = ${ec.id}`, isNull(documents.deletedAt)));
    await audit(tx, ctx, {
      action: "employee.exited",
      entityType: "employee",
      entityId: emp.id,
      changes: diff({ status: emp.status, exitDate: emp.exitDate, lastWorkingDate: emp.lastWorkingDate, exitReason: emp.exitReason }, patch),
      metadata: { exitCaseId: ec.id, type: ec.type, eligibleForRehire: input.eligibleForRehire, employmentRecordClosed: open?.id ?? null },
    });
    await emitDomainEvent(tx, ctx.tenantId, "employee.exited", { employeeId: emp.id, exitCaseId: ec.id, exitDate: lwd, type: ec.type }, { dedupeKey: `employee-exited:${ec.id}` });
    return { id: ec.id, employeeId: emp.id };
  });
}

/** HR cancels an exit (e.g. resignation retracted after acceptance). Restores the employee to active. */
export async function cancelExit(ctx: RequestContext, input: { exitCaseId: string; reason: string }) {
  authorize(ctx, "exits.manage", "all");
  return ctx.db(async (tx) => {
    const ec = await lockExit(tx, input.exitCaseId);
    if (!(OPEN_EXIT_STATUSES as readonly string[]).includes(ec.status)) throw invalidState("Only open exits can be cancelled.");
    if (ec.status === "submitted" || ec.status === "under_review") {
      await cancelApprovalForSubject(tx, ctx, ec.type === "resignation" ? "resignation" : "exit_case", ec.id);
    }
    await tx.update(exitCases).set({ status: "withdrawn" }).where(eq(exitCases.id, ec.id));
    const [emp] = await tx.select().from(employees).where(eq(employees.id, ec.employeeId)).for("update");
    if (emp.status === "on_notice") {
      await tx.update(employees).set({ status: "active", lastWorkingDate: null, resignationDate: null }).where(eq(employees.id, emp.id));
    }
    const plan = await offboardingPlanFor(tx, ec.id);
    if (plan && (plan.status === "not_started" || plan.status === "in_progress")) await closePlan(tx, ctx, plan.id);
    await audit(tx, ctx, { action: "exit.cancelled", entityType: "exit_case", entityId: ec.id, metadata: { reason: input.reason } });
    return { id: ec.id };
  });
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export type ExitListItem = {
  id: string;
  type: string;
  status: string;
  submittedOn: string;
  lastWorkingDate: string | null;
  settlementStatus: string;
  employee: { id: string; name: string; code: string; status: string; department: string | null; designation: string | null };
  progressPercent: number | null;
  openTasks: number;
};

export async function listExitCases(ctx: RequestContext, opts: { status?: "open" | "completed" | "all" } = {}): Promise<ExitListItem[]> {
  const scope = canManageExits(ctx) || canSettle(ctx) ? "all" : scopeOf(ctx, "exits.view");
  if (!scope || scope === "self") throw forbidden();
  const team = scope === "team" ? await getTeamEmployeeIds(ctx) : null;
  if (team && !team.length) return [];
  return ctx.db(async (tx) => {
    const statusFilter =
      opts.status === "completed"
        ? eq(exitCases.status, "completed")
        : opts.status === "all"
          ? undefined
          : inArray(exitCases.status, [...OPEN_EXIT_STATUSES]);
    const rows = await tx
      .select({
        ec: exitCases,
        name: employees.displayName,
        code: employees.employeeCode,
        empStatus: employees.status,
        department: departments.name,
        designation: designations.title,
        progress: sql<number | null>`(select p.progress_percent from lifecycle_plans p where p.exit_case_id = ${exitCases.id} order by p.created_at desc limit 1)`,
        openTasks: sql<number>`(select count(*) from tasks t join lifecycle_plans p on p.id = t.container_id where t.container_type = 'lifecycle_plan' and p.exit_case_id = ${exitCases.id} and t.status in ('open','in_progress','blocked'))`.mapWith(Number),
      })
      .from(exitCases)
      .innerJoin(employees, eq(employees.id, exitCases.employeeId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .where(and(statusFilter, team ? inArray(exitCases.employeeId, team) : undefined))
      .orderBy(sql`coalesce(${exitCases.approvedLastWorkingDate}, ${exitCases.requestedLastWorkingDate}) asc nulls last`, desc(exitCases.createdAt))
      .limit(500);
    return rows.map((r) => ({
      id: r.ec.id,
      type: r.ec.type,
      status: r.ec.status,
      submittedOn: r.ec.submittedOn,
      lastWorkingDate: lwdOf(r.ec),
      settlementStatus: r.ec.settlementStatus,
      employee: { id: r.ec.employeeId, name: r.name, code: r.code, status: r.empStatus, department: r.department, designation: r.designation },
      progressPercent: r.progress === null ? null : Number(r.progress),
      openTasks: r.openTasks,
    }));
  });
}

export type ExitAccess = "manage" | "settle" | "viewer" | "self";

export type ExitDetail = {
  id: string;
  type: string;
  status: string;
  submittedOn: string;
  requestedLastWorkingDate: string | null;
  approvedLastWorkingDate: string | null;
  lastWorkingDate: string | null;
  noticePeriodDays: number;
  noticeShortfallDays: number;
  shortfallTreatment: string;
  reasonCategory: string | null;
  reasonDetail: string | null;
  eligibleForRehire: boolean | null;
  settlementStatus: string;
  completedAt: string | null;
  initiatedByName: string | null;
  employee: {
    id: string;
    name: string;
    code: string;
    status: string;
    joiningDate: string;
    exitDate: string | null;
    designation: string | null;
    department: string | null;
    hasLogin: boolean;
    membershipStatus: string | null;
  };
  approval: { status: string; steps: { stepNo: number; name: string; status: string; decidedAt: string | null; comment: string | null }[] } | null;
  plan: PlanDetail | null;
  assets: { assignmentId: string; tag: string; name: string; category: string; assignedOn: string; returnedOn: string | null; conditionIn: string | null }[];
  leave: LeaveSnapshotRow[];
  settlementInputs: SettlementInputs | null;
  letters: { id: string; title: string; kind: string | null; createdAt: string; employeeVisible: boolean }[];
  interview: StoredInterview | null;
  access: ExitAccess;
  can: {
    manage: boolean;
    settle: boolean;
    approveSettlement: boolean;
    confirmAccess: boolean;
    suspendLogin: boolean;
    returnAssets: boolean;
    withdraw: boolean;
  };
  completionBlockers: string[];
};

async function exitAccess(ctx: RequestContext, ec: ExitRow): Promise<ExitAccess | null> {
  if (canManageExits(ctx)) return "manage";
  if (canSettle(ctx)) return "settle";
  if (ec.employeeId === ctx.employeeId) return scopeOf(ctx, "exits.view") ? "self" : null;
  if (await canAccessEmployee(ctx, "exits.view", ec.employeeId)) return "viewer";
  return null;
}

async function loadExitDetail(tx: Tx, ctx: RequestContext, ec: ExitRow, access: ExitAccess): Promise<ExitDetail> {
  const full = access === "manage";
  const settle = full || access === "settle";
  const [emp] = await tx
    .select({
      id: employees.id,
      name: employees.displayName,
      code: employees.employeeCode,
      status: employees.status,
      joiningDate: employees.joiningDate,
      exitDate: employees.exitDate,
      userId: employees.userId,
      designation: designations.title,
      department: departments.name,
    })
    .from(employees)
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(eq(employees.id, ec.employeeId));
  const [membership] = emp.userId
    ? await tx.select({ status: memberships.status }).from(memberships).where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, emp.userId)))
    : [];
  const [initiator] = await tx.select({ name: users.fullName, email: users.email }).from(users).where(eq(users.id, ec.initiatedBy));

  const [request] = await tx
    .select()
    .from(approvalRequests)
    .where(and(inArray(approvalRequests.subjectType, ["resignation", "exit_case"]), eq(approvalRequests.subjectId, ec.id)))
    .orderBy(desc(approvalRequests.createdAt))
    .limit(1);
  const steps = request
    ? await tx.select().from(approvalSteps).where(eq(approvalSteps.requestId, request.id)).orderBy(asc(approvalSteps.stepNo))
    : [];

  const planRow = await offboardingPlanFor(tx, ec.id);
  let plan = planRow ? await loadPlanDetail(tx, ctx, planRow) : null;
  if (plan && access === "self") plan = { ...plan, tasks: plan.tasks.filter((t) => t.ownerGroup === "employee") };

  const assetRows =
    access === "self" || full || settle
      ? await tx
          .select({ a: assetAssignments, tag: assets.tag, name: assets.name, category: assets.category })
          .from(assetAssignments)
          .innerJoin(assets, eq(assets.id, assetAssignments.assetId))
          .where(eq(assetAssignments.employeeId, ec.employeeId))
          .orderBy(sql`${assetAssignments.returnedOn} is not null`, desc(assetAssignments.assignedOn))
      : [];

  const settlementTask = planRow ? await taskByCode(tx, planRow.id, "settlement_inputs") : null;
  const letterRows = await tx
    .select({ id: documents.id, title: documents.title, metadata: documents.metadata, createdAt: documents.createdAt, employeeVisible: documents.employeeVisible })
    .from(documents)
    .where(and(eq(documents.employeeId, ec.employeeId), sql`${documents.metadata}->>'exitCaseId' = ${ec.id}`, eq(documents.isCurrent, true), isNull(documents.deletedAt)))
    .orderBy(desc(documents.createdAt));
  const letters = letterRows
    .filter((d) => access !== "self" || d.employeeVisible)
    .map((d) => ({ id: d.id, title: d.title, kind: (d.metadata as { letterKind?: string }).letterKind ?? null, createdAt: d.createdAt.toISOString(), employeeVisible: d.employeeVisible }));

  const lwd = lwdOf(ec);
  const blockers: string[] = [];
  if (full && (ACTIVE_EXIT_STATUSES as readonly string[]).includes(ec.status)) {
    if (!lwd) blockers.push("Set the last working day.");
    else if (lwd > todayIn()) blockers.push(`The last working day (${lwd}) has not passed yet.`);
    const open = plan?.tasks.filter((t) => t.required && (t.status === "open" || t.status === "in_progress" || t.status === "blocked")) ?? [];
    if (open.length) blockers.push(`${open.length} required ${open.length === 1 ? "task is" : "tasks are"} open: ${open.map((t) => t.title).join(", ")}.`);
  }

  return {
    id: ec.id,
    type: ec.type,
    status: ec.status,
    submittedOn: ec.submittedOn,
    requestedLastWorkingDate: ec.requestedLastWorkingDate,
    approvedLastWorkingDate: ec.approvedLastWorkingDate,
    lastWorkingDate: lwd,
    noticePeriodDays: ec.noticePeriodDays,
    noticeShortfallDays: ec.noticeShortfallDays,
    shortfallTreatment: ec.shortfallTreatment,
    reasonCategory: ec.reasonCategory,
    reasonDetail: access === "viewer" ? null : ec.reasonDetail,
    eligibleForRehire: full ? ec.eligibleForRehire : null,
    settlementStatus: ec.settlementStatus,
    completedAt: ec.completedAt?.toISOString() ?? null,
    initiatedByName: initiator ? (initiator.name ?? initiator.email) : null,
    employee: {
      id: emp.id,
      name: emp.name,
      code: emp.code,
      status: emp.status,
      joiningDate: emp.joiningDate,
      exitDate: emp.exitDate,
      designation: emp.designation,
      department: emp.department,
      hasLogin: !!emp.userId,
      membershipStatus: full ? (membership?.status ?? null) : null,
    },
    approval: request
      ? {
          status: request.status,
          steps: steps.map((s) => ({ stepNo: s.stepNo, name: s.name, status: s.status, decidedAt: s.decidedAt?.toISOString() ?? null, comment: s.comment })),
        }
      : null,
    plan,
    assets: assetRows.map((r) => ({
      assignmentId: r.a.id,
      tag: r.tag,
      name: r.name,
      category: r.category,
      assignedOn: r.a.assignedOn,
      returnedOn: r.a.returnedOn,
      conditionIn: r.a.conditionIn,
    })),
    leave: settle ? await leaveSnapshot(tx, ec.employeeId) : [],
    settlementInputs: settle && settlementTask ? (cfg(settlementTask).settlementInputs ?? null) : null,
    letters,
    interview: full ? ((ec.exitInterview as StoredInterview | null) ?? null) : null,
    access,
    can: {
      manage: full,
      settle,
      approveSettlement: can(ctx, "payroll.approve", "all"),
      confirmAccess: can(ctx, "users.manage", "all") || can(ctx, "assets.manage", "all"),
      suspendLogin: full && can(ctx, "users.manage", "all") && membership?.status === "active" && emp.userId !== ctx.userId,
      returnAssets: can(ctx, "assets.manage", "all"),
      withdraw: access === "self" && ec.status === "submitted",
    },
    completionBlockers: blockers,
  };
}

export async function getExitCase(ctx: RequestContext, id: string): Promise<ExitDetail> {
  return ctx.db(async (tx) => {
    const [ec] = await tx.select().from(exitCases).where(eq(exitCases.id, id));
    if (!ec) throw notFound("Exit case");
    const access = await exitAccess(ctx, ec);
    if (!access) throw forbidden();
    return loadExitDetail(tx, ctx, ec, access);
  });
}

export type MyExit = {
  current: ExitDetail | null;
  canResign: boolean;
  employeeStatus: string | null;
  noticePeriodDays: number;
  defaultLastWorkingDate: string;
  history: { id: string; type: string; status: string; submittedOn: string }[];
};

export async function myExit(ctx: RequestContext): Promise<MyExit | null> {
  if (!ctx.employeeId || !scopeOf(ctx, "exits.view")) return null;
  const me = ctx.employeeId;
  return ctx.db(async (tx) => {
    const [emp] = await tx.select({ status: employees.status, notice: employees.noticePeriodDays }).from(employees).where(eq(employees.id, me));
    const cases = await tx.select().from(exitCases).where(eq(exitCases.employeeId, me)).orderBy(desc(exitCases.createdAt)).limit(20);
    const open = cases.find((c) => !["rejected", "withdrawn"].includes(c.status)) ?? null;
    const current = open ? await loadExitDetail(tx, ctx, open, "self") : null;
    const notice = emp?.notice ?? 30;
    return {
      current,
      canResign: emp?.status === "active" && !cases.some((c) => (OPEN_EXIT_STATUSES as readonly string[]).includes(c.status)),
      employeeStatus: emp?.status ?? null,
      noticePeriodDays: notice,
      defaultLastWorkingDate: shiftDate(todayIn(), notice),
      history: cases.filter((c) => c.id !== open?.id).map((c) => ({ id: c.id, type: c.type, status: c.status, submittedOn: c.submittedOn })),
    };
  });
}

/** Employees HR can start an exit for (active or on notice, no open case). */
export async function exitCandidates(ctx: RequestContext) {
  authorize(ctx, "exits.manage", "all");
  return ctx.db((tx) =>
    tx
      .select({ value: employees.id, label: employees.displayName, hint: employees.employeeCode })
      .from(employees)
      .where(
        and(
          isNull(employees.deletedAt),
          inArray(employees.status, ["active", "on_notice"]),
          notInArray(
            employees.id,
            tx.select({ id: exitCases.employeeId }).from(exitCases).where(inArray(exitCases.status, [...OPEN_EXIT_STATUSES])),
          ),
        ),
      )
      .orderBy(asc(employees.displayName))
      .limit(5000),
  );
}
