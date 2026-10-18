import "server-only";
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { can, type RequestContext } from "../../auth/context";
import type { Tx } from "../../db/client";
import {
  approvalRequests,
  approvalSteps,
  departments,
  designations,
  employees,
  jobOpenings,
  jobRequisitions,
  legalEntities,
  locations,
  positions,
} from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { AppError, forbidden, invalidState, notFound, validation } from "../../lib/errors";
import { cancelApprovalForSubject, startApproval, type ApprovalActor } from "../approvals/engine";
import { nextCounter } from "../employees/codes";
import { notify } from "../notifications";
import { emitDomainEvent } from "../events";
import { userIdForEmployee } from "../directory";
import type { RequisitionInput, RequisitionStatus } from "@/lib/validation/recruitment";
import { canSeeBudget, canManageRecruitment, canViewRecruitment, toPaise, userNames } from "./shared";

type Row = typeof jobRequisitions.$inferSelect;

export const formatRequisitionCode = (n: number) => `REQ-${String(n).padStart(4, "0")}`;

/** Who may see requisitions: recruiters/approvers see all; raisers see their own and their hiring-manager ones. */
function visibilityFilter(ctx: RequestContext): SQL | undefined {
  if (canViewRecruitment(ctx) || can(ctx, "requisitions.approve", "all")) return undefined;
  if (!can(ctx, "requisitions.create", "all")) return sql`false`;
  return or(eq(jobRequisitions.createdBy, ctx.userId), ctx.employeeId ? eq(jobRequisitions.hiringManagerEmployeeId, ctx.employeeId) : undefined);
}

function canEdit(ctx: RequestContext, r: Row) {
  return r.createdBy === ctx.userId || canManageRecruitment(ctx);
}

export type RequisitionListItem = {
  id: string;
  code: string;
  title: string;
  status: RequisitionStatus;
  headcount: number;
  department: string | null;
  location: string | null;
  hiringManager: string | null;
  openings: number;
  createdAt: string;
  targetStartDate: string | null;
};

export async function listRequisitions(ctx: RequestContext, opts: { status?: string } = {}): Promise<RequisitionListItem[]> {
  const filter = visibilityFilter(ctx);
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        r: jobRequisitions,
        department: departments.name,
        location: locations.name,
        hiringManager: employees.displayName,
        openings: sql<number>`(select count(*)::int from job_openings o where o.requisition_id = ${jobRequisitions.id})`,
      })
      .from(jobRequisitions)
      .leftJoin(departments, eq(departments.id, jobRequisitions.departmentId))
      .leftJoin(locations, eq(locations.id, jobRequisitions.locationId))
      .leftJoin(employees, eq(employees.id, jobRequisitions.hiringManagerEmployeeId))
      .where(and(filter, opts.status ? eq(jobRequisitions.status, opts.status as RequisitionStatus) : undefined))
      .orderBy(desc(jobRequisitions.createdAt))
      .limit(500);
    return rows.map(({ r, ...x }) => ({
      id: r.id,
      code: r.code,
      title: r.title,
      status: r.status,
      headcount: r.headcount,
      department: x.department,
      location: x.location,
      hiringManager: x.hiringManager,
      openings: x.openings,
      createdAt: r.createdAt.toISOString(),
      targetStartDate: r.targetStartDate,
    }));
  });
}

export type RequisitionDetail = {
  id: string;
  code: string;
  title: string;
  status: RequisitionStatus;
  headcount: number;
  employmentType: string;
  reason: string;
  justification: string | null;
  targetStartDate: string | null;
  approvedAt: string | null;
  createdAt: string;
  createdByName: string | null;
  department: { id: string; name: string } | null;
  designation: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  legalEntity: { id: string; name: string } | null;
  position: { id: string; code: string; title: string; status: string } | null;
  backfillFor: { id: string; name: string } | null;
  hiringManager: { id: string; name: string } | null;
  recruiter: { id: string; name: string } | null;
  /** Paise; null when hidden from the caller or not set. */
  budget: { min: number | null; max: number | null; currency: string } | null;
  openings: { id: string; title: string; status: string; hired: number; openings: number }[];
  hiredCount: number;
  approval: {
    requestId: string;
    status: string;
    steps: { stepNo: number; name: string; status: string; decidedAt: string | null; comment: string | null }[];
  } | null;
  raw: RequisitionInput;
  canEdit: boolean;
  canSubmit: boolean;
  canWithdraw: boolean;
  canManageStatus: boolean;
  canCreateOpening: boolean;
  canCreatePosition: boolean;
  canSeeBudget: boolean;
};

export async function getRequisition(ctx: RequestContext, id: string): Promise<RequisitionDetail> {
  const filter = visibilityFilter(ctx);
  return ctx.db(async (tx) => {
    const [r] = await tx.select().from(jobRequisitions).where(and(eq(jobRequisitions.id, id), filter));
    if (!r) throw notFound("Requisition");
    const [dep, des, loc, le, pos, back, mgr] = await Promise.all([
      r.departmentId ? tx.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.id, r.departmentId)) : [],
      r.designationId ? tx.select({ id: designations.id, name: designations.title }).from(designations).where(eq(designations.id, r.designationId)) : [],
      r.locationId ? tx.select({ id: locations.id, name: locations.name }).from(locations).where(eq(locations.id, r.locationId)) : [],
      r.legalEntityId ? tx.select({ id: legalEntities.id, name: legalEntities.name }).from(legalEntities).where(eq(legalEntities.id, r.legalEntityId)) : [],
      r.positionId ? tx.select({ id: positions.id, code: positions.code, title: positions.title, status: positions.status }).from(positions).where(eq(positions.id, r.positionId)) : [],
      r.backfillForEmployeeId ? tx.select({ id: employees.id, name: employees.displayName }).from(employees).where(eq(employees.id, r.backfillForEmployeeId)) : [],
      r.hiringManagerEmployeeId ? tx.select({ id: employees.id, name: employees.displayName }).from(employees).where(eq(employees.id, r.hiringManagerEmployeeId)) : [],
    ]);
    const names = await userNames(tx, [r.createdBy, r.recruiterUserId]);
    const openings = await tx
      .select({
        id: jobOpenings.id,
        title: jobOpenings.title,
        status: jobOpenings.status,
        openings: jobOpenings.openings,
        hired: sql<number>`(select count(*)::int from applications a where a.opening_id = "job_openings"."id" and a.status = 'hired')`,
      })
      .from(jobOpenings)
      .where(eq(jobOpenings.requisitionId, r.id));
    const [request] = await tx
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.subjectType, "job_requisition"), eq(approvalRequests.subjectId, r.id)))
      .orderBy(desc(approvalRequests.createdAt))
      .limit(1);
    const steps = request
      ? await tx.select().from(approvalSteps).where(eq(approvalSteps.requestId, request.id)).orderBy(approvalSteps.stepNo)
      : [];
    const showBudget = canSeeBudget(ctx);
    const editable = canEdit(ctx, r);
    return {
      id: r.id,
      code: r.code,
      title: r.title,
      status: r.status,
      headcount: r.headcount,
      employmentType: r.employmentType,
      reason: r.reason,
      justification: r.justification,
      targetStartDate: r.targetStartDate,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      createdByName: names.get(r.createdBy) ?? null,
      department: dep[0] ?? null,
      designation: des[0] ?? null,
      location: loc[0] ?? null,
      legalEntity: le[0] ?? null,
      position: pos[0] ?? null,
      backfillFor: back[0] ?? null,
      hiringManager: mgr[0] ?? null,
      recruiter: r.recruiterUserId ? { id: r.recruiterUserId, name: names.get(r.recruiterUserId) ?? "Recruiter" } : null,
      budget: showBudget ? { min: r.budgetMinAnnual, max: r.budgetMaxAnnual, currency: r.currency } : null,
      openings,
      hiredCount: openings.reduce((a, o) => a + o.hired, 0),
      approval: request
        ? {
            requestId: request.id,
            status: request.status,
            steps: steps.map((s) => ({ stepNo: s.stepNo, name: s.name, status: s.status, decidedAt: s.decidedAt?.toISOString() ?? null, comment: s.comment })),
          }
        : null,
      raw: {
        title: r.title,
        departmentId: r.departmentId,
        designationId: r.designationId,
        locationId: r.locationId,
        legalEntityId: r.legalEntityId,
        positionId: r.positionId,
        headcount: r.headcount,
        employmentType: r.employmentType,
        reason: r.reason === "backfill" ? "backfill" : "new",
        backfillForEmployeeId: r.backfillForEmployeeId,
        budgetMinAnnual: showBudget && r.budgetMinAnnual != null ? r.budgetMinAnnual / 100 : null,
        budgetMaxAnnual: showBudget && r.budgetMaxAnnual != null ? r.budgetMaxAnnual / 100 : null,
        justification: r.justification ?? "",
        hiringManagerEmployeeId: r.hiringManagerEmployeeId,
        recruiterUserId: r.recruiterUserId,
        targetStartDate: r.targetStartDate,
      },
      canEdit: editable && (r.status === "draft" || r.status === "rejected"),
      canSubmit: editable && (r.status === "draft" || r.status === "rejected"),
      canWithdraw: editable && r.status === "pending_approval",
      canManageStatus: canManageRecruitment(ctx) || r.createdBy === ctx.userId,
      canCreateOpening: canManageRecruitment(ctx) && r.status === "approved",
      canCreatePosition: can(ctx, "org.manage", "all") && r.status === "approved" && !r.positionId,
      canSeeBudget: showBudget,
    };
  });
}

async function assertRefs(tx: Tx, input: RequisitionInput) {
  const checks: [keyof RequisitionInput, string | null, () => Promise<unknown[]>][] = [
    ["departmentId", input.departmentId, () => tx.select({ id: departments.id }).from(departments).where(eq(departments.id, input.departmentId!))],
    ["designationId", input.designationId, () => tx.select({ id: designations.id }).from(designations).where(eq(designations.id, input.designationId!))],
    ["locationId", input.locationId, () => tx.select({ id: locations.id }).from(locations).where(eq(locations.id, input.locationId!))],
    ["legalEntityId", input.legalEntityId, () => tx.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.id, input.legalEntityId!))],
    ["positionId", input.positionId, () => tx.select({ id: positions.id }).from(positions).where(and(eq(positions.id, input.positionId!), inArray(positions.status, ["planned", "open"])))],
    [
      "backfillForEmployeeId",
      input.reason === "backfill" ? input.backfillForEmployeeId : null,
      () => tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, input.backfillForEmployeeId!), isNull(employees.deletedAt))),
    ],
    [
      "hiringManagerEmployeeId",
      input.hiringManagerEmployeeId,
      () => tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, input.hiringManagerEmployeeId!), isNull(employees.deletedAt))),
    ],
  ];
  const bad: string[] = [];
  for (const [field, value, q] of checks) if (value && !(await q()).length) bad.push(field);
  if (bad.length) throw new AppError("VALIDATION", "Some selections are no longer valid. Refresh and try again.", { fieldErrors: Object.fromEntries(bad.map((f) => [f, ["Not found"]])) });
}

function budgetValues(ctx: RequestContext, input: RequisitionInput, before?: Row) {
  // Only roles that may see compensation set budgets; others keep what is stored.
  if (!canSeeBudget(ctx)) {
    return { budgetMinAnnual: before?.budgetMinAnnual ?? null, budgetMaxAnnual: before?.budgetMaxAnnual ?? null };
  }
  return {
    budgetMinAnnual: input.budgetMinAnnual == null ? null : toPaise(input.budgetMinAnnual),
    budgetMaxAnnual: input.budgetMaxAnnual == null ? null : toPaise(input.budgetMaxAnnual),
  };
}

function rowValues(input: RequisitionInput) {
  return {
    title: input.title,
    departmentId: input.departmentId,
    designationId: input.designationId,
    locationId: input.locationId,
    legalEntityId: input.legalEntityId,
    positionId: input.positionId,
    headcount: input.headcount,
    employmentType: input.employmentType,
    reason: input.reason,
    backfillForEmployeeId: input.reason === "backfill" ? input.backfillForEmployeeId : null,
    justification: input.justification,
    hiringManagerEmployeeId: input.hiringManagerEmployeeId,
    recruiterUserId: input.recruiterUserId,
    targetStartDate: input.targetStartDate,
  };
}

export async function createRequisition(ctx: RequestContext, input: RequisitionInput, opts: { submit?: boolean } = {}) {
  if (!can(ctx, "requisitions.create", "all")) throw forbidden();
  return ctx.db(async (tx) => {
    await assertRefs(tx, input);
    const code = formatRequisitionCode(await nextCounter(tx, ctx.tenantId, "requisition_code"));
    const values = { ...rowValues(input), ...budgetValues(ctx, input) };
    const [r] = await tx
      .insert(jobRequisitions)
      .values({ tenantId: ctx.tenantId, code, ...values, status: "draft", createdBy: ctx.userId })
      .returning();
    await audit(tx, ctx, { action: "requisition.created", entityType: "job_requisition", entityId: r.id, changes: diff(null, values), metadata: { code } });
    if (opts.submit) await submitInTx(tx, ctx, r);
    return { id: r.id, code };
  });
}

export async function updateRequisition(ctx: RequestContext, id: string, input: RequisitionInput) {
  return ctx.db(async (tx) => {
    const [before] = await tx.select().from(jobRequisitions).where(eq(jobRequisitions.id, id)).for("update");
    if (!before) throw notFound("Requisition");
    if (!canEdit(ctx, before)) throw forbidden();
    if (before.status !== "draft" && before.status !== "rejected") throw invalidState("Only draft or rejected requisitions can be edited. Withdraw it from approval first.");
    await assertRefs(tx, input);
    const values = { ...rowValues(input), ...budgetValues(ctx, input, before) };
    await tx.update(jobRequisitions).set(values).where(eq(jobRequisitions.id, id));
    await audit(tx, ctx, { action: "requisition.updated", entityType: "job_requisition", entityId: id, changes: diff(before as Record<string, unknown>, values) });
    return { id };
  });
}

async function submitInTx(tx: Tx, ctx: RequestContext, r: Row) {
  if (r.status !== "draft" && r.status !== "rejected") throw invalidState("This requisition has already been submitted.");
  if (!r.justification?.trim()) throw validation("Add a justification before submitting.", { justification: ["Required"] });
  await tx.update(jobRequisitions).set({ status: "pending_approval" }).where(eq(jobRequisitions.id, r.id));
  await startApproval(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, {
    subjectType: "job_requisition",
    subjectId: r.id,
    title: `Requisition ${r.code}: ${r.title} (${r.headcount})`,
    requestedBy: ctx.userId,
    // Department head resolution starts from the hiring manager (or the requester).
    subjectEmployeeId: r.hiringManagerEmployeeId ?? ctx.employeeId,
    context: { departmentId: r.departmentId, headcount: r.headcount, reason: r.reason, budgetMaxAnnual: r.budgetMaxAnnual },
  });
  await audit(tx, ctx, { action: "requisition.submitted", entityType: "job_requisition", entityId: r.id, metadata: { code: r.code } });
}

export async function submitRequisition(ctx: RequestContext, id: string) {
  return ctx.db(async (tx) => {
    const [r] = await tx.select().from(jobRequisitions).where(eq(jobRequisitions.id, id)).for("update");
    if (!r) throw notFound("Requisition");
    if (!canEdit(ctx, r)) throw forbidden();
    await submitInTx(tx, ctx, r);
    return { id };
  });
}

/**
 * Manual status changes: withdraw from approval (→ draft), hold / resume,
 * cancel. Approval outcomes and "filled" are set by the system.
 */
export async function transitionRequisition(ctx: RequestContext, id: string, to: "on_hold" | "approved" | "cancelled" | "draft", reason: string | null) {
  return ctx.db(async (tx) => {
    const [r] = await tx.select().from(jobRequisitions).where(eq(jobRequisitions.id, id)).for("update");
    if (!r) throw notFound("Requisition");
    if (!canEdit(ctx, r)) throw forbidden();
    const allowed: Record<string, RequisitionStatus[]> = {
      draft: ["pending_approval"],
      on_hold: ["approved"],
      approved: ["on_hold"],
      cancelled: ["draft", "pending_approval", "approved", "on_hold", "rejected"],
    };
    if (!allowed[to].includes(r.status)) throw invalidState(`A ${r.status.replace(/_/g, " ")} requisition cannot be moved to ${to.replace(/_/g, " ")}.`);
    if (r.status === "pending_approval") await cancelApprovalForSubject(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, "job_requisition", id);
    await tx.update(jobRequisitions).set({ status: to }).where(eq(jobRequisitions.id, id));
    if (to === "cancelled" || to === "on_hold") {
      // Pause published openings so the careers page does not keep collecting applications.
      await tx
        .update(jobOpenings)
        .set({ status: to === "cancelled" ? "closed" : "paused" })
        .where(and(eq(jobOpenings.requisitionId, id), inArray(jobOpenings.status, to === "cancelled" ? ["draft", "published", "paused"] : ["published"])));
    }
    await audit(tx, ctx, { action: `requisition.${to}`, entityType: "job_requisition", entityId: id, changes: diff({ status: r.status }, { status: to }), metadata: { reason } });
    return { id, status: to };
  });
}

/** Create a position for an approved requisition and link it (org.manage). */
export async function createPositionForRequisition(ctx: RequestContext, id: string) {
  if (!can(ctx, "org.manage", "all")) throw forbidden();
  return ctx.db(async (tx) => {
    const [r] = await tx.select().from(jobRequisitions).where(eq(jobRequisitions.id, id)).for("update");
    if (!r) throw notFound("Requisition");
    if (r.status !== "approved") throw invalidState("Positions are created for approved requisitions.");
    if (r.positionId) throw invalidState("This requisition already has a position.");
    let code = `POS-${r.code.replace(/^REQ-/, "")}`;
    const [taken] = await tx.select({ id: positions.id }).from(positions).where(eq(positions.code, code));
    if (taken) code = `${code}-${String(await nextCounter(tx, ctx.tenantId, "position_code")).padStart(3, "0")}`;
    const [p] = await tx
      .insert(positions)
      .values({
        tenantId: ctx.tenantId,
        code,
        title: r.title,
        designationId: r.designationId,
        departmentId: r.departmentId,
        locationId: r.locationId,
        legalEntityId: r.legalEntityId,
        status: "open",
        budgetedAnnualCtc: r.budgetMaxAnnual,
      })
      .returning({ id: positions.id });
    await tx.update(jobRequisitions).set({ positionId: p.id }).where(eq(jobRequisitions.id, id));
    await audit(tx, ctx, { action: "position.created", entityType: "position", entityId: p.id, metadata: { code, requisitionId: id } });
    return { id: p.id, code };
  });
}

/* ------------------------------------------------------------------ */
/* Approval outcomes (called by the approvals engine in its transaction) */
/* ------------------------------------------------------------------ */

async function notifyOwners(tx: Tx, tenantId: string, r: Row, title: string, body: string | null) {
  const hm = await userIdForEmployee(tx, r.hiringManagerEmployeeId);
  await notify(tx, {
    tenantId,
    userIds: [r.createdBy, r.recruiterUserId ?? "", hm ?? ""],
    category: "recruitment",
    title,
    body,
    href: `/recruitment/requisitions/${r.id}`,
    dedupeKey: `requisition:${r.id}:${title}`,
  });
}

export async function onRequisitionApproved(tx: Tx, requisitionId: string, actor: ApprovalActor) {
  const [r] = await tx.select().from(jobRequisitions).where(and(eq(jobRequisitions.id, requisitionId), eq(jobRequisitions.tenantId, actor.tenantId))).for("update");
  if (!r || r.status !== "pending_approval") return;
  await tx.update(jobRequisitions).set({ status: "approved", approvedAt: new Date() }).where(eq(jobRequisitions.id, r.id));
  if (r.positionId) {
    await tx.update(positions).set({ status: "open" }).where(and(eq(positions.id, r.positionId), eq(positions.status, "planned")));
  }
  await audit(tx, actor, { action: "requisition.approved", entityType: "job_requisition", entityId: r.id, metadata: { code: r.code } });
  await emitDomainEvent(tx, actor.tenantId, "requisition.approved", { requisitionId: r.id, code: r.code, headcount: r.headcount });
  await notifyOwners(tx, actor.tenantId, r, `Requisition ${r.code} approved`, `${r.title}: you can now open the job.`);
}

export async function onRequisitionRejected(tx: Tx, requisitionId: string, actor: ApprovalActor, comment: string | null) {
  const [r] = await tx.select().from(jobRequisitions).where(and(eq(jobRequisitions.id, requisitionId), eq(jobRequisitions.tenantId, actor.tenantId))).for("update");
  if (!r || r.status !== "pending_approval") return;
  await tx.update(jobRequisitions).set({ status: "rejected" }).where(eq(jobRequisitions.id, r.id));
  await audit(tx, actor, { action: "requisition.rejected", entityType: "job_requisition", entityId: r.id, metadata: { comment } });
  await notifyOwners(tx, actor.tenantId, r, `Requisition ${r.code} was not approved`, comment ? `Comment: ${comment.slice(0, 140)}` : null);
}

export async function onRequisitionCancelled(tx: Tx, requisitionId: string, actor: ApprovalActor) {
  await tx
    .update(jobRequisitions)
    .set({ status: "draft" })
    .where(and(eq(jobRequisitions.id, requisitionId), eq(jobRequisitions.tenantId, actor.tenantId), eq(jobRequisitions.status, "pending_approval")));
}

/** Approved requisitions that can still take openings (for the opening form). */
export async function approvedRequisitionOptions(ctx: RequestContext) {
  if (!canManageRecruitment(ctx)) return [];
  const rows = await ctx.db((tx) =>
    tx
      .select({ id: jobRequisitions.id, code: jobRequisitions.code, title: jobRequisitions.title })
      .from(jobRequisitions)
      .where(eq(jobRequisitions.status, "approved"))
      .orderBy(desc(jobRequisitions.createdAt))
      .limit(300),
  );
  return rows.map((r) => ({ value: r.id, label: `${r.code} · ${r.title}` }));
}
