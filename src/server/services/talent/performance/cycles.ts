import { and, asc, count, desc, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { authorize, can, canAccessEmployee, type RequestContext } from "../../../auth/context";
import type { Tx } from "../../../db/client";
import { withSystem } from "../../../db/tx";
import { departments, employees, ratingScales, reviewCycles, reviewTemplates, reviews } from "../../../db/schema";
import { audit, diff } from "../../../lib/audit";
import { forbidden, invalidState, notFound, validation } from "../../../lib/errors";
import { userIdsWithPermission } from "../../directory";
import { emitDomainEvent } from "../../events";
import { notify } from "../../notifications";
import { addDaysIso } from "@/lib/talent/learning";
import { nearestLevel, type RatingLevelLite } from "@/lib/talent/ratings";
import { todayIn } from "@/lib/format";
import type { assignPeersSchema, calibrateSchema, reviewCycleSchema } from "@/lib/validation/talent";
import { CURRENT_STATUSES, employeeBasics } from "../shared";
import { ensureDefaultRatingScale } from "./setup";

type CycleRow = typeof reviewCycles.$inferSelect;

export type ParticipantConditions = { departmentIds?: string[]; locationIds?: string[]; joinedOnOrBefore?: string };

export const conditionsOf = (c: CycleRow) => c.participantConditions as ParticipantConditions;

/** Default eligibility: joined at least 30 days before the period ends. */
export const eligibilityCutoff = (c: Pick<CycleRow, "periodEnd" | "participantConditions">) =>
  (c.participantConditions as ParticipantConditions).joinedOnOrBefore || addDaysIso(c.periodEnd, -30);

async function lockCycle(tx: Tx, id: string) {
  const [c] = await tx.select().from(reviewCycles).where(eq(reviewCycles.id, id)).for("update");
  if (!c) throw notFound("Review cycle");
  return c;
}

export async function listCycles(ctx: RequestContext) {
  authorize(ctx, "performance.manage", "all");
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ c: reviewCycles, templateName: reviewTemplates.name })
      .from(reviewCycles)
      .leftJoin(reviewTemplates, eq(reviewTemplates.id, reviewCycles.templateId))
      .orderBy(desc(reviewCycles.periodEnd), desc(reviewCycles.createdAt));
    const stats = rows.length
      ? await tx
          .select({ cycleId: reviews.cycleId, total: count(), done: sql<number>`count(*) filter (where ${reviews.status} <> 'not_started' and ${reviews.status} <> 'in_progress')`.mapWith(Number) })
          .from(reviews)
          .where(inArray(reviews.cycleId, rows.map((r) => r.c.id)))
          .groupBy(reviews.cycleId)
      : [];
    const byCycle = new Map(stats.map((s) => [s.cycleId, s]));
    return rows.map((r) => ({ ...r.c, templateName: r.templateName, reviewsTotal: byCycle.get(r.c.id)?.total ?? 0, reviewsDone: byCycle.get(r.c.id)?.done ?? 0 }));
  });
}

/** Cycles shown in goal forms: anything not yet closed. Cycle names are not sensitive. */
export async function openCycleOptions(ctx: RequestContext) {
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ id: reviewCycles.id, name: reviewCycles.name, status: reviewCycles.status })
      .from(reviewCycles)
      .where(ne(reviewCycles.status, "closed"))
      .orderBy(desc(reviewCycles.periodEnd));
    return rows.map((r) => ({ value: r.id, label: r.name, hint: r.status }));
  });
}

export async function saveCycle(ctx: RequestContext, input: z.output<typeof reviewCycleSchema>) {
  authorize(ctx, "performance.manage", "all");
  return ctx.db(async (tx) => {
    const [tpl] = await tx.select({ id: reviewTemplates.id }).from(reviewTemplates).where(eq(reviewTemplates.id, input.templateId));
    if (!tpl) throw validation("Choose a valid template.", { templateId: ["Not found"] });
    const ratingScaleId = input.ratingScaleId ?? (await ensureDefaultRatingScale(tx, ctx.tenantId));
    const [scale] = await tx.select({ id: ratingScales.id }).from(ratingScales).where(eq(ratingScales.id, ratingScaleId));
    if (!scale) throw validation("Choose a valid rating scale.", { ratingScaleId: ["Not found"] });
    const conditions: ParticipantConditions = {};
    if (input.departmentIds.length) conditions.departmentIds = input.departmentIds;
    if (input.locationIds.length) conditions.locationIds = input.locationIds;
    if (input.joinedOnOrBefore) conditions.joinedOnOrBefore = input.joinedOnOrBefore;
    const values = {
      name: input.name,
      kind: input.kind,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      templateId: input.templateId,
      ratingScaleId,
      selfDueOn: input.selfDueOn,
      peerDueOn: input.peerDueOn,
      managerDueOn: input.managerDueOn,
      calibrationDueOn: input.calibrationDueOn,
      includePeers: input.includePeers,
      includeUpward: input.includeUpward,
      participantConditions: conditions as Record<string, string | string[]>,
    };
    if (input.id) {
      const before = await lockCycle(tx, input.id);
      if (before.status !== "draft") throw invalidState("Only draft cycles can be edited.");
      await tx.update(reviewCycles).set(values).where(eq(reviewCycles.id, input.id));
      await audit(tx, ctx, { action: "performance.cycle_updated", entityType: "review_cycle", entityId: input.id, changes: diff(before, values) });
      return { id: input.id };
    }
    const [row] = await tx.insert(reviewCycles).values({ tenantId: ctx.tenantId, ...values, createdBy: ctx.userId }).returning({ id: reviewCycles.id });
    await audit(tx, ctx, { action: "performance.cycle_created", entityType: "review_cycle", entityId: row.id, metadata: { name: input.name } });
    return row;
  });
}

/** Employees eligible for a cycle under its participant conditions. */
async function resolveParticipants(tx: Tx, cycle: CycleRow) {
  const cond = conditionsOf(cycle);
  return tx
    .select({ id: employees.id, managerId: employees.managerId, userId: employees.userId })
    .from(employees)
    .where(
      and(
        isNull(employees.deletedAt),
        inArray(employees.status, [...CURRENT_STATUSES]),
        lte(employees.joiningDate, eligibilityCutoff(cycle)),
        cond.departmentIds?.length ? inArray(employees.departmentId, cond.departmentIds) : undefined,
        cond.locationIds?.length ? inArray(employees.locationId, cond.locationIds) : undefined,
      ),
    );
}

export async function previewParticipants(ctx: RequestContext, cycleId: string) {
  authorize(ctx, "performance.manage", "all");
  return ctx.db(async (tx) => {
    const [cycle] = await tx.select().from(reviewCycles).where(eq(reviewCycles.id, cycleId));
    if (!cycle) throw notFound("Review cycle");
    const rows = await resolveParticipants(tx, cycle);
    return { count: rows.length, withoutManager: rows.filter((r) => !r.managerId).length, cutoff: eligibilityCutoff(cycle) };
  });
}

/**
 * Launch: resolve participants and create review rows. Self reviews for
 * everyone; manager reviews where a current manager exists (HR is notified
 * about the rest); upward feedback when enabled. Peers are assigned later by
 * the manager. Idempotent per (cycle, employee, reviewer, kind).
 */
export async function launchCycle(ctx: RequestContext, cycleId: string) {
  authorize(ctx, "performance.manage", "all");
  return ctx.db(async (tx) => {
    const cycle = await lockCycle(tx, cycleId);
    if (cycle.status !== "draft") throw invalidState("This cycle has already been launched.");
    const participants = await resolveParticipants(tx, cycle);
    if (!participants.length) throw invalidState("No employees match this cycle's participant conditions.");
    const ids = new Set(participants.map((p) => p.id));
    const managers = await employeeBasics(tx, participants.map((p) => p.managerId));
    const currentManager = (id: string | null) => {
      const m = id ? managers.get(id) : null;
      return m && (CURRENT_STATUSES as readonly string[]).includes(m.status) ? m : null;
    };

    const rows: (typeof reviews.$inferInsert)[] = [];
    const withoutManager: string[] = [];
    for (const p of participants) {
      rows.push({ tenantId: ctx.tenantId, cycleId, employeeId: p.id, reviewerEmployeeId: p.id, kind: "self" });
      const mgr = currentManager(p.managerId);
      if (!mgr) {
        withoutManager.push(p.id);
        continue;
      }
      rows.push({ tenantId: ctx.tenantId, cycleId, employeeId: p.id, reviewerEmployeeId: mgr.id, kind: "manager" });
      if (cycle.includeUpward) rows.push({ tenantId: ctx.tenantId, cycleId, employeeId: mgr.id, reviewerEmployeeId: p.id, kind: "upward" });
    }
    for (let i = 0; i < rows.length; i += 500) await tx.insert(reviews).values(rows.slice(i, i + 500)).onConflictDoNothing();

    await tx.update(reviewCycles).set({ status: "active", launchedAt: new Date() }).where(eq(reviewCycles.id, cycleId));
    await emitDomainEvent(tx, ctx.tenantId, "performance.cycle_started", { cycleId, name: cycle.name, participants: participants.length }, { dedupeKey: `cycle-started:${cycleId}` });

    const participantUsers = participants.map((p) => p.userId).filter((u): u is string => !!u);
    await notify(tx, {
      tenantId: ctx.tenantId,
      userIds: participantUsers,
      category: "performance",
      title: `${cycle.name}: your self review is open`,
      body: cycle.selfDueOn ? `Please complete it by ${cycle.selfDueOn}.` : "Please complete your self review.",
      href: "/performance?tab=reviews",
      dedupeKey: `cycle-start:${cycleId}`,
    });
    const managerUsers = [...new Set(participants.map((p) => currentManager(p.managerId)?.userId).filter((u): u is string => !!u))];
    await notify(tx, {
      tenantId: ctx.tenantId,
      userIds: managerUsers,
      category: "performance",
      title: `${cycle.name}: review your team`,
      body: cycle.managerDueOn ? `Manager reviews are due by ${cycle.managerDueOn}.` : "Manager reviews are open for your team.",
      href: "/performance?tab=team",
      dedupeKey: `cycle-start-mgr:${cycleId}`,
    });
    if (withoutManager.length) {
      await notify(tx, {
        tenantId: ctx.tenantId,
        userIds: await userIdsWithPermission(tx, ctx.tenantId, "performance.manage"),
        category: "performance",
        title: `${cycle.name}: ${withoutManager.length} participant${withoutManager.length === 1 ? " has" : "s have"} no manager`,
        body: "No manager review was created for them. Assign managers, or review them through HR.",
        href: `/performance/cycles/${cycleId}`,
        dedupeKey: `cycle-no-manager:${cycleId}`,
      });
    }
    await audit(tx, ctx, {
      action: "performance.cycle_launched",
      entityType: "review_cycle",
      entityId: cycleId,
      metadata: { participants: participants.length, reviews: rows.length, withoutManager: withoutManager.length, eligibleSet: ids.size },
    });
    return { participants: participants.length, reviews: rows.length, withoutManager: withoutManager.length };
  });
}

export async function startCalibration(ctx: RequestContext, cycleId: string) {
  authorize(ctx, "performance.manage", "all");
  return ctx.db(async (tx) => {
    const cycle = await lockCycle(tx, cycleId);
    if (cycle.status !== "active") throw invalidState("Calibration starts from an active cycle.");
    await tx.update(reviewCycles).set({ status: "calibration" }).where(eq(reviewCycles.id, cycleId));
    await audit(tx, ctx, { action: "performance.calibration_started", entityType: "review_cycle", entityId: cycleId });
    return { status: "calibration" as const };
  });
}

/** Share submitted manager reviews with employees (after calibration). */
export async function shareManagerReviews(ctx: RequestContext, cycleId: string) {
  authorize(ctx, "performance.manage", "all");
  return ctx.db(async (tx) => {
    const cycle = await lockCycle(tx, cycleId);
    if (cycle.status !== "calibration") throw invalidState("Reviews are shared during calibration, once ratings are final.");
    const shared = await tx
      .update(reviews)
      .set({ status: "shared", sharedAt: new Date() })
      .where(and(eq(reviews.cycleId, cycleId), eq(reviews.kind, "manager"), eq(reviews.status, "submitted")))
      .returning({ id: reviews.id, employeeId: reviews.employeeId });
    const basics = await employeeBasics(tx, shared.map((s) => s.employeeId));
    for (const s of shared) {
      const userId = basics.get(s.employeeId)?.userId;
      if (!userId) continue;
      await notify(tx, {
        tenantId: ctx.tenantId,
        userIds: [userId],
        category: "performance",
        title: `${cycle.name}: your review is ready`,
        body: "Your manager's review has been shared with you. Please read and acknowledge it.",
        href: `/performance/reviews/${s.id}`,
        dedupeKey: `review-shared:${s.id}`,
      });
    }
    const [{ pending }] = await tx
      .select({ pending: count() })
      .from(reviews)
      .where(and(eq(reviews.cycleId, cycleId), eq(reviews.kind, "manager"), inArray(reviews.status, ["not_started", "in_progress"])));
    await audit(tx, ctx, { action: "performance.reviews_shared", entityType: "review_cycle", entityId: cycleId, metadata: { shared: shared.length, pending } });
    return { shared: shared.length, pending };
  });
}

/** Close: lock every review in the cycle. The rows remain as history. */
export async function closeCycle(ctx: RequestContext, cycleId: string) {
  authorize(ctx, "performance.manage", "all");
  return ctx.db(async (tx) => {
    const cycle = await lockCycle(tx, cycleId);
    if (cycle.status !== "calibration") throw invalidState("Close the cycle after calibration and sharing.");
    const summary = await tx
      .select({ kind: reviews.kind, status: reviews.status, n: count() })
      .from(reviews)
      .where(eq(reviews.cycleId, cycleId))
      .groupBy(reviews.kind, reviews.status);
    await tx.update(reviewCycles).set({ status: "closed", closedAt: new Date() }).where(eq(reviewCycles.id, cycleId));
    await emitDomainEvent(tx, ctx.tenantId, "performance.cycle_closed", { cycleId, name: cycle.name }, { dedupeKey: `cycle-closed:${cycleId}` });
    await audit(tx, ctx, { action: "performance.cycle_closed", entityType: "review_cycle", entityId: cycleId, metadata: { summary } });
    return { status: "closed" as const };
  });
}

export async function assertCycleWritable(cycle: Pick<CycleRow, "status">, kind: string) {
  if (cycle.status === "closed") throw invalidState("This review cycle is closed; reviews are locked.");
  if (cycle.status === "draft") throw invalidState("This review cycle has not been launched yet.");
  if (cycle.status === "calibration" && kind !== "manager") throw invalidState("This cycle is in calibration; only manager reviews can still be completed.");
}

async function authorizePeerManagement(ctx: RequestContext, employeeId: string) {
  if (can(ctx, "performance.manage", "all")) return;
  if (employeeId === ctx.employeeId || !(await canAccessEmployee(ctx, "performance.review", employeeId))) throw forbidden();
}

/**
 * Peer review rows are invisible to managers under RLS (content is for the
 * peer and HR only). Assignment bookkeeping therefore runs in system context
 * AFTER authorization, filtered by tenant, and only ever returns reviewer ids
 * and statuses, never review content.
 */
async function peerRows(tx: Tx, tenantId: string, cycleId: string, employeeId: string) {
  return tx
    .select({ id: reviews.id, reviewer: reviews.reviewerEmployeeId, status: reviews.status })
    .from(reviews)
    .where(and(eq(reviews.tenantId, tenantId), eq(reviews.cycleId, cycleId), eq(reviews.employeeId, employeeId), eq(reviews.kind, "peer")));
}

export async function listPeerAssignments(ctx: RequestContext, cycleId: string, employeeId: string) {
  await authorizePeerManagement(ctx, employeeId);
  const rows = await withSystem((tx) => peerRows(tx, ctx.tenantId, cycleId, employeeId), ctx.tenantId);
  const names = await ctx.db((tx) => employeeBasics(tx, rows.map((r) => r.reviewer)));
  return rows.map((r) => ({ reviewerId: r.reviewer, name: names.get(r.reviewer)?.name ?? "Unknown", status: r.status }));
}

/**
 * Peers are assigned by the employee's manager (or HR), up to three. Peer
 * reviews that have not been started are replaced; started ones are kept.
 */
export async function assignPeers(ctx: RequestContext, input: z.output<typeof assignPeersSchema>) {
  await authorizePeerManagement(ctx, input.employeeId);
  const peerIds = [...new Set(input.peerIds)].filter((p) => p !== input.employeeId);
  const { cycle, peers, subjectName } = await ctx.db(async (tx) => {
    const [cycle] = await tx.select().from(reviewCycles).where(eq(reviewCycles.id, input.cycleId));
    if (!cycle) throw notFound("Review cycle");
    if (!cycle.includePeers) throw invalidState("Peer reviews are not enabled for this cycle.");
    if (cycle.status !== "active") throw invalidState("Peers can be assigned while the cycle is active.");
    const [self] = await tx
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.cycleId, cycle.id), eq(reviews.employeeId, input.employeeId), eq(reviews.kind, "self")));
    if (!self) throw validation("This employee is not a participant in the cycle.");
    const peers = await employeeBasics(tx, [...peerIds, input.employeeId]);
    for (const id of peerIds) {
      const p = peers.get(id);
      if (!p || !(CURRENT_STATUSES as readonly string[]).includes(p.status)) throw validation("Choose current employees as peers.", { peerIds: ["Not found"] });
    }
    return { cycle, peers, subjectName: peers.get(input.employeeId)?.name ?? "a colleague" };
  });

  return withSystem(async (tx) => {
    await tx.select({ id: reviewCycles.id }).from(reviewCycles).where(and(eq(reviewCycles.id, cycle.id), eq(reviewCycles.tenantId, ctx.tenantId))).for("update");
    const existing = await peerRows(tx, ctx.tenantId, cycle.id, input.employeeId);
    const keep = new Set(existing.filter((e) => e.status !== "not_started").map((e) => e.reviewer));
    if (new Set([...keep, ...peerIds]).size > 3) throw validation("An employee can have at most 3 peer reviewers.", { peerIds: ["Choose up to 3 peers"] });
    const removable = existing.filter((e) => e.status === "not_started" && !peerIds.includes(e.reviewer)).map((e) => e.id);
    if (removable.length) await tx.delete(reviews).where(and(eq(reviews.tenantId, ctx.tenantId), inArray(reviews.id, removable)));
    const toAdd = peerIds.filter((p) => !existing.some((e) => e.reviewer === p));
    if (toAdd.length) {
      await tx
        .insert(reviews)
        .values(toAdd.map((p) => ({ tenantId: ctx.tenantId, cycleId: cycle.id, employeeId: input.employeeId, reviewerEmployeeId: p, kind: "peer" as const })))
        .onConflictDoNothing();
      await notify(tx, {
        tenantId: ctx.tenantId,
        userIds: toAdd.map((p) => peers.get(p)?.userId).filter((u): u is string => !!u),
        category: "performance",
        title: `${cycle.name}: peer feedback requested`,
        body: `You were asked for peer feedback on ${subjectName}.`,
        href: "/performance?tab=reviews",
        dedupeKey: `peer-requested:${cycle.id}:${input.employeeId}:${toAdd.join(",")}`,
      });
    }
    await audit(tx, ctx, { action: "performance.peers_assigned", entityType: "review_cycle", entityId: cycle.id, metadata: { employeeId: input.employeeId, added: toAdd.length, removed: removable.length } });
    return { added: toAdd.length, removed: removable.length };
  }, ctx.tenantId);
}

export type CycleParticipant = {
  employeeId: string;
  name: string;
  code: string;
  department: string | null;
  selfStatus: string | null;
  managerStatus: string | null;
  managerReviewId: string | null;
  managerName: string | null;
  peerCount: number;
  finalRating: number | null;
};

export async function getCycleDetail(ctx: RequestContext, cycleId: string) {
  authorize(ctx, "performance.manage", "all");
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select({ c: reviewCycles, templateName: reviewTemplates.name, scaleName: ratingScales.name, levels: ratingScales.levels })
      .from(reviewCycles)
      .leftJoin(reviewTemplates, eq(reviewTemplates.id, reviewCycles.templateId))
      .leftJoin(ratingScales, eq(ratingScales.id, reviewCycles.ratingScaleId))
      .where(eq(reviewCycles.id, cycleId));
    if (!row) throw notFound("Review cycle");
    const all = await tx
      .select({ id: reviews.id, employeeId: reviews.employeeId, reviewer: reviews.reviewerEmployeeId, kind: reviews.kind, status: reviews.status, overall: reviews.overallRating, calibrated: reviews.calibratedRating })
      .from(reviews)
      .where(eq(reviews.cycleId, cycleId));
    const subjects = [...new Set(all.filter((r) => r.kind === "self").map((r) => r.employeeId))];
    const people = await employeeBasics(tx, [...subjects, ...all.map((r) => r.reviewer)]);
    const deps = await tx.select({ id: departments.id, name: departments.name }).from(departments);
    const depMap = new Map(deps.map((d) => [d.id, d.name]));
    const participants: CycleParticipant[] = subjects
      .map((id) => {
        const mine = all.filter((r) => r.employeeId === id);
        const self = mine.find((r) => r.kind === "self");
        const mgr = mine.find((r) => r.kind === "manager");
        const e = people.get(id);
        return {
          employeeId: id,
          name: e?.name ?? "Unknown",
          code: e?.code ?? "",
          department: e?.departmentId ? (depMap.get(e.departmentId) ?? null) : null,
          selfStatus: self?.status ?? null,
          managerStatus: mgr?.status ?? null,
          managerReviewId: mgr?.id ?? null,
          managerName: mgr ? (people.get(mgr.reviewer)?.name ?? null) : null,
          peerCount: mine.filter((r) => r.kind === "peer").length,
          finalRating: mgr ? (mgr.calibrated ?? mgr.overall ?? null) : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const byKind = (kind: string) => {
      const list = all.filter((r) => r.kind === kind);
      return { total: list.length, submitted: list.filter((r) => ["submitted", "shared", "acknowledged"].includes(r.status)).length };
    };
    const preview = row.c.status === "draft" ? await resolveParticipants(tx, row.c) : null;
    return {
      cycle: row.c,
      templateName: row.templateName,
      scaleName: row.scaleName,
      levels: (row.levels ?? []) as RatingLevelLite[],
      cutoff: eligibilityCutoff(row.c),
      preview: preview ? { count: preview.length, withoutManager: preview.filter((p) => !p.managerId).length } : null,
      progress: { self: byKind("self"), manager: byKind("manager"), peer: byKind("peer"), upward: byKind("upward") },
      acknowledged: all.filter((r) => r.kind === "manager" && r.status === "acknowledged").length,
      participants,
    };
  });
}

export type CalibrationRow = {
  reviewId: string;
  employeeId: string;
  name: string;
  department: string;
  managerName: string | null;
  status: string;
  overallRating: number | null;
  calibratedRating: number | null;
  calibrationNote: string | null;
  finalRating: number | null;
};

/** Distribution of final manager ratings by department and level. */
export async function calibrationView(ctx: RequestContext, cycleId: string) {
  authorize(ctx, "performance.manage", "all");
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select({ c: reviewCycles, levels: ratingScales.levels })
      .from(reviewCycles)
      .leftJoin(ratingScales, eq(ratingScales.id, reviewCycles.ratingScaleId))
      .where(eq(reviewCycles.id, cycleId));
    if (!row) throw notFound("Review cycle");
    const levels = (row.levels ?? []) as RatingLevelLite[];
    const mgrReviews = await tx
      .select()
      .from(reviews)
      .where(and(eq(reviews.cycleId, cycleId), eq(reviews.kind, "manager")))
      .orderBy(asc(reviews.employeeId));
    const people = await employeeBasics(tx, [...mgrReviews.map((r) => r.employeeId), ...mgrReviews.map((r) => r.reviewerEmployeeId)]);
    const deps = await tx.select({ id: departments.id, name: departments.name }).from(departments);
    const depMap = new Map(deps.map((d) => [d.id, d.name]));
    const rows: CalibrationRow[] = mgrReviews.map((r) => {
      const e = people.get(r.employeeId);
      return {
        reviewId: r.id,
        employeeId: r.employeeId,
        name: e?.name ?? "Unknown",
        department: (e?.departmentId && depMap.get(e.departmentId)) || "No department",
        managerName: people.get(r.reviewerEmployeeId)?.name ?? null,
        status: r.status,
        overallRating: r.overallRating,
        calibratedRating: r.calibratedRating,
        calibrationNote: r.calibrationNote,
        finalRating: r.calibratedRating ?? r.overallRating ?? null,
      };
    });
    const rated = rows.filter((r) => r.finalRating != null && r.status !== "not_started" && r.status !== "in_progress");
    const distribution = levels.map((l) => ({ value: l.value, label: l.label, count: rated.filter((r) => nearestLevel(r.finalRating!, levels) === l.value).length }));
    const departmentsList = [...new Set(rated.map((r) => r.department))].sort();
    const byDepartment = departmentsList.map((d) => {
      const list = rated.filter((r) => r.department === d);
      return {
        department: d,
        count: list.length,
        average: list.length ? Math.round((list.reduce((a, r) => a + r.finalRating!, 0) / list.length) * 100) / 100 : null,
        levels: Object.fromEntries(levels.map((l) => [String(l.value), list.filter((r) => nearestLevel(r.finalRating!, levels) === l.value).length])),
      };
    });
    return { cycle: row.c, levels, rows, distribution, byDepartment };
  });
}

export async function calibrateReview(ctx: RequestContext, input: z.output<typeof calibrateSchema>) {
  authorize(ctx, "performance.manage", "all");
  return ctx.db(async (tx) => {
    const [r] = await tx.select().from(reviews).where(eq(reviews.id, input.reviewId)).for("update");
    if (!r || r.kind !== "manager") throw notFound("Manager review");
    const cycle = await lockCycle(tx, r.cycleId);
    if (cycle.status !== "calibration") throw invalidState("Ratings can be calibrated while the cycle is in calibration.");
    if (r.status !== "submitted") throw invalidState("Only submitted, unshared manager reviews can be calibrated.");
    const [scale] = await tx.select({ levels: ratingScales.levels }).from(ratingScales).where(eq(ratingScales.id, cycle.ratingScaleId));
    const values = (scale?.levels ?? []).map((l) => l.value);
    if (values.length && (input.calibratedRating < Math.min(...values) || input.calibratedRating > Math.max(...values))) {
      throw validation("The rating is outside the cycle's scale.", { calibratedRating: ["Out of range"] });
    }
    const after = { calibratedRating: input.calibratedRating, calibrationNote: input.note };
    await tx.update(reviews).set(after).where(eq(reviews.id, r.id));
    await audit(tx, ctx, { action: "performance.rating_calibrated", entityType: "review", entityId: r.id, changes: diff(r, after), metadata: { cycleId: r.cycleId, employeeId: r.employeeId } });
    return { id: r.id };
  });
}

/* ------------------------------------------------------------------ */
/* Reminders (system context)                                          */
/* ------------------------------------------------------------------ */

const dueFor = (c: CycleRow, kind: string) => (kind === "self" ? c.selfDueOn : kind === "manager" ? c.managerDueOn : c.peerDueOn);

/**
 * Remind reviewers of open reviews due within 3 days or overdue. One
 * notification per review per day (dedupe key includes the date).
 */
export async function sendReviewReminders(tx: Tx, tenantId: string, today = todayIn()) {
  const soon = addDaysIso(today, 3);
  const cycles = await tx
    .select()
    .from(reviewCycles)
    .where(and(eq(reviewCycles.tenantId, tenantId), inArray(reviewCycles.status, ["active", "calibration"])));
  let sent = 0;
  for (const c of cycles) {
    const open = await tx
      .select({ id: reviews.id, kind: reviews.kind, reviewer: reviews.reviewerEmployeeId })
      .from(reviews)
      .where(and(eq(reviews.tenantId, tenantId), eq(reviews.cycleId, c.id), inArray(reviews.status, ["not_started", "in_progress"])));
    const due = open.filter((r) => {
      const d = dueFor(c, r.kind);
      if (c.status === "calibration" && r.kind !== "manager") return false;
      return !!d && d <= soon;
    });
    if (!due.length) continue;
    const people = await tx
      .select({ id: employees.id, userId: employees.userId })
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), inArray(employees.id, [...new Set(due.map((d) => d.reviewer))])));
    const userOf = new Map(people.map((p) => [p.id, p.userId]));
    for (const r of due) {
      const userId = userOf.get(r.reviewer);
      if (!userId) continue;
      const d = dueFor(c, r.kind)!;
      await notify(tx, {
        tenantId,
        userIds: [userId],
        category: "performance",
        title: d < today ? `${c.name}: review overdue` : `${c.name}: review due ${d}`,
        body: "You have a review to complete.",
        href: `/performance/reviews/${r.id}`,
        dedupeKey: `review-reminder:${r.id}:${today}`,
      });
      sent++;
    }
  }
  return sent;
}
