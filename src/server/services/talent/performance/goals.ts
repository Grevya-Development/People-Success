import { and, desc, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { can, getTeamEmployeeIds, scopeOf, type RequestContext } from "../../../auth/context";
import type { Tx } from "../../../db/client";
import { departments, employees, goalCheckins, goals, reviewCycles, users } from "../../../db/schema";
import { audit, diff } from "../../../lib/audit";
import { forbidden, invalidState, notFound, validation } from "../../../lib/errors";
import { notify } from "../../notifications";
import { progressFromValues, validateGoalWeights } from "@/lib/talent/ratings";
import type { goalCheckinSchema, goalSchema } from "@/lib/validation/talent";
import { employeeBasics } from "../shared";

type GoalRow = typeof goals.$inferSelect;

export type GoalView = GoalRow & {
  ownerName: string | null;
  departmentName: string | null;
  parentTitle: string | null;
  cycleName: string | null;
  cycleStatus: string | null;
  canEdit: boolean;
  lastCheckinAt: string | null;
};

export type GoalAccess = {
  manage: boolean;
  viewAll: boolean;
  reviewAll: boolean;
  selfAccess: boolean;
  /** Reporting subtree where the caller holds performance.review. */
  reviewTeam: Set<string>;
  /** Reporting subtree where the caller holds performance.view. */
  viewTeam: Set<string>;
  employeeId: string | null;
};

/** Resolve the caller's goal permissions once per request (no per-row queries). */
export async function goalAccess(ctx: RequestContext): Promise<GoalAccess> {
  const reviewScope = scopeOf(ctx, "performance.review");
  const viewScope = scopeOf(ctx, "performance.view");
  const team = reviewScope === "team" || viewScope === "team" ? await getTeamEmployeeIds(ctx) : [];
  return {
    manage: can(ctx, "performance.manage", "all"),
    viewAll: viewScope === "all" || reviewScope === "all",
    reviewAll: reviewScope === "all",
    selfAccess: !!viewScope || !!reviewScope,
    reviewTeam: new Set(reviewScope === "team" ? team : []),
    viewTeam: new Set(viewScope === "team" ? team : []),
    employeeId: ctx.employeeId,
  };
}

/**
 * Who may create or change a goal:
 * - company / department goals (no employee): performance.manage
 * - your own goals: any employee with performance access
 * - a report's goals: performance.review over that employee (manager chain), or HR
 */
export function canManageGoal(a: GoalAccess, employeeId: string | null) {
  if (a.manage) return true;
  if (!employeeId) return false;
  if (employeeId === a.employeeId) return a.selfAccess;
  return a.reviewAll || a.reviewTeam.has(employeeId);
}

export async function canManageGoalFor(ctx: RequestContext, employeeId: string | null) {
  return canManageGoal(await goalAccess(ctx), employeeId);
}

/**
 * Visibility: private goals are visible to the owner, their reporting line
 * and HR; team goals also to colleagues sharing the owner's manager; company
 * goals (and goals without an owner) to everyone in the tenant.
 */
function canViewGoal(a: GoalAccess, g: Pick<GoalRow, "employeeId" | "visibility">, ownerManagerId: string | null, myManagerId: string | null) {
  if (!g.employeeId || g.visibility === "company") return true;
  if (g.employeeId === a.employeeId) return true;
  if (a.manage || a.viewAll) return true;
  if (a.viewTeam.has(g.employeeId) || a.reviewTeam.has(g.employeeId)) return true;
  if (g.visibility === "team" && ownerManagerId && myManagerId && ownerManagerId === myManagerId) return true;
  return false;
}

async function myManagerId(tx: Tx, ctx: RequestContext) {
  if (!ctx.employeeId) return null;
  const [me] = await tx.select({ managerId: employees.managerId }).from(employees).where(eq(employees.id, ctx.employeeId));
  return me?.managerId ?? null;
}

function decorateWith(a: GoalAccess) {
  return async (tx: Tx, rows: GoalRow[]): Promise<GoalView[]> => {
  if (!rows.length) return [];
  const owners = await employeeBasics(tx, rows.map((r) => r.employeeId));
  const deptIds = [...new Set(rows.map((r) => r.departmentId).filter((x): x is string => !!x))];
  const parentIds = [...new Set(rows.map((r) => r.parentGoalId).filter((x): x is string => !!x))];
  const cycleIds = [...new Set(rows.map((r) => r.cycleId).filter((x): x is string => !!x))];
  const [deps, parents, cycles, checkins] = await Promise.all([
    deptIds.length ? tx.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, deptIds)) : [],
    parentIds.length ? tx.select({ id: goals.id, title: goals.title }).from(goals).where(inArray(goals.id, parentIds)) : [],
    cycleIds.length ? tx.select({ id: reviewCycles.id, name: reviewCycles.name, status: reviewCycles.status }).from(reviewCycles).where(inArray(reviewCycles.id, cycleIds)) : [],
    tx
      .select({ goalId: goalCheckins.goalId, last: sql<string>`max(${goalCheckins.createdAt})` })
      .from(goalCheckins)
      .where(inArray(goalCheckins.goalId, rows.map((r) => r.id)))
      .groupBy(goalCheckins.goalId),
  ]);
  const depMap = new Map(deps.map((d) => [d.id, d.name]));
  const parentMap = new Map(parents.map((p) => [p.id, p.title]));
  const cycleMap = new Map(cycles.map((c) => [c.id, c]));
  const lastMap = new Map(checkins.map((c) => [c.goalId, c.last]));
  const out: GoalView[] = [];
  for (const r of rows) {
    const cycle = r.cycleId ? cycleMap.get(r.cycleId) : null;
    out.push({
      ...r,
      ownerName: r.employeeId ? (owners.get(r.employeeId)?.name ?? null) : null,
      departmentName: r.departmentId ? (depMap.get(r.departmentId) ?? null) : null,
      parentTitle: r.parentGoalId ? (parentMap.get(r.parentGoalId) ?? null) : null,
      cycleName: cycle?.name ?? null,
      cycleStatus: cycle?.status ?? null,
      canEdit: cycle?.status !== "closed" && canManageGoal(a, r.employeeId),
      lastCheckinAt: lastMap.get(r.id) ? new Date(lastMap.get(r.id)!).toISOString() : null,
    });
  }
  return out;
  };
}

export type GoalScope = "mine" | "team" | "company";

/** Goals for a tab. Visibility rules are applied per row in addition to the scope filter. */
export async function listGoals(ctx: RequestContext, scope: GoalScope, opts: { cycleId?: string | null; employeeId?: string } = {}) {
  const a = await goalAccess(ctx);
  const teamIds = scope === "team" ? [...new Set([...a.viewTeam, ...a.reviewTeam])] : [];
  return ctx.db(async (tx) => {
    const where: SQL[] = [];
    if (opts.cycleId) where.push(eq(goals.cycleId, opts.cycleId));
    if (scope === "mine") {
      if (!ctx.employeeId) return [];
      where.push(eq(goals.employeeId, ctx.employeeId));
    } else if (scope === "team") {
      const ids = opts.employeeId ? teamIds.filter((i) => i === opts.employeeId) : teamIds;
      if (!ids.length) return [];
      where.push(inArray(goals.employeeId, ids));
    } else {
      const mgr = await myManagerId(tx, ctx);
      const peers = mgr
        ? (await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.managerId, mgr), isNull(employees.deletedAt)))).map((p) => p.id)
        : [];
      where.push(
        or(
          isNull(goals.employeeId),
          eq(goals.visibility, "company"),
          peers.length ? and(eq(goals.visibility, "team"), inArray(goals.employeeId, peers)) : undefined,
        )!,
      );
    }
    const rows = await tx
      .select()
      .from(goals)
      .where(and(...where, ne(goals.status, "cancelled")))
      .orderBy(desc(goals.createdAt))
      .limit(500);
    const mgr = await myManagerId(tx, ctx);
    const owners = await employeeBasics(tx, rows.map((r) => r.employeeId));
    const visible: GoalRow[] = [];
    for (const r of rows) if (canViewGoal(a, r, r.employeeId ? (owners.get(r.employeeId)?.managerId ?? null) : null, mgr)) visible.push(r);
    return decorateWith(a)(tx, visible);
  });
}

/** Goals an employee can align to: company, department and visible manager goals. */
export async function alignableGoals(ctx: RequestContext) {
  return ctx.db(async (tx) => {
    const mgr = await myManagerId(tx, ctx);
    const rows = await tx
      .select({ id: goals.id, title: goals.title, employeeId: goals.employeeId, departmentId: goals.departmentId })
      .from(goals)
      .where(
        and(
          inArray(goals.status, ["active", "draft"]),
          or(
            isNull(goals.employeeId),
            eq(goals.visibility, "company"),
            mgr ? and(eq(goals.employeeId, mgr), inArray(goals.visibility, ["team", "company"])) : undefined,
            ctx.employeeId ? eq(goals.employeeId, ctx.employeeId) : undefined,
          ),
        ),
      )
      .orderBy(goals.title)
      .limit(300);
    return rows.map((r) => ({ value: r.id, label: r.title, hint: r.employeeId ? (r.employeeId === ctx.employeeId ? "My goal" : "Shared goal") : r.departmentId ? "Department goal" : "Company goal" }));
  });
}

async function loadCycleForGoal(tx: Tx, cycleId: string | null) {
  if (!cycleId) return null;
  const [cycle] = await tx.select({ id: reviewCycles.id, status: reviewCycles.status }).from(reviewCycles).where(eq(reviewCycles.id, cycleId));
  if (!cycle) throw validation("Choose a valid review cycle.", { cycleId: ["Not found"] });
  if (cycle.status === "closed") throw invalidState("This review cycle is closed; its goals are locked.");
  return cycle;
}

async function otherWeights(tx: Tx, employeeId: string, cycleId: string | null, excludeId: string | null) {
  const rows = await tx
    .select({ weight: goals.weight })
    .from(goals)
    .where(
      and(
        eq(goals.employeeId, employeeId),
        cycleId ? eq(goals.cycleId, cycleId) : isNull(goals.cycleId),
        ne(goals.status, "cancelled"),
        excludeId ? ne(goals.id, excludeId) : undefined,
      ),
    );
  return rows.map((r) => r.weight);
}

export async function saveGoal(ctx: RequestContext, input: z.output<typeof goalSchema>) {
  const employeeId = input.employeeId;
  if (!employeeId && !can(ctx, "performance.manage", "all")) throw forbidden("Only HR can set company or department goals.");
  const a = await goalAccess(ctx);
  if (!canManageGoal(a, employeeId)) throw forbidden();
  if (employeeId && input.departmentId) throw validation("A goal belongs to an employee or a department, not both.");

  return ctx.db(async (tx) => {
    let before: GoalRow | undefined;
    if (input.id) {
      [before] = await tx.select().from(goals).where(eq(goals.id, input.id)).for("update");
      if (!before) throw notFound("Goal");
      if (before.employeeId !== employeeId) throw validation("A goal cannot be moved to another person.");
      if (before.cycleId) await loadCycleForGoal(tx, before.cycleId);
    }
    await loadCycleForGoal(tx, input.cycleId);
    if (employeeId) {
      const [emp] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)));
      if (!emp) throw notFound("Employee");
      const check = validateGoalWeights(await otherWeights(tx, employeeId, input.cycleId, input.id), input.weight);
      if (!check.ok) throw validation(check.message!, { weight: [check.message!] });
    }
    if (input.departmentId) {
      const [d] = await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, input.departmentId));
      if (!d) throw validation("Choose a valid department.", { departmentId: ["Not found"] });
    }
    if (input.parentGoalId) {
      if (input.parentGoalId === input.id) throw validation("A goal cannot align to itself.", { parentGoalId: ["Choose another goal"] });
      const [p] = await tx.select().from(goals).where(eq(goals.id, input.parentGoalId));
      if (!p) throw validation("Choose a valid parent goal.", { parentGoalId: ["Not found"] });
      const owner = p.employeeId ? (await employeeBasics(tx, [p.employeeId])).get(p.employeeId) : null;
      if (!canViewGoal(a, p, owner?.managerId ?? null, await myManagerId(tx, ctx))) throw validation("Choose a valid parent goal.", { parentGoalId: ["Not visible"] });
    }
    const current = before?.currentValue ?? input.startValue ?? null;
    const computed = progressFromValues(input.startValue, input.targetValue, current);
    const values = {
      employeeId,
      departmentId: input.departmentId,
      cycleId: input.cycleId,
      parentGoalId: input.parentGoalId,
      kind: input.kind,
      title: input.title,
      description: input.description,
      metricUnit: input.metricUnit,
      startValue: input.startValue,
      targetValue: input.targetValue,
      weight: input.weight,
      dueOn: input.dueOn,
      visibility: employeeId ? input.visibility : "company",
      ...(before ? {} : { currentValue: input.startValue, progressPercent: computed ?? 0 }),
    };
    if (before) {
      await tx.update(goals).set(values).where(eq(goals.id, before.id));
      await audit(tx, ctx, { action: "goal.updated", entityType: "goal", entityId: before.id, changes: diff(before, values) });
      return { id: before.id };
    }
    const [row] = await tx
      .insert(goals)
      .values({ tenantId: ctx.tenantId, ...values, status: "active", createdBy: ctx.userId })
      .returning({ id: goals.id });
    await audit(tx, ctx, { action: "goal.created", entityType: "goal", entityId: row.id, metadata: { employeeId, cycleId: input.cycleId, weight: input.weight } });
    // A manager setting a goal for a report lets the report know.
    if (employeeId && employeeId !== ctx.employeeId) {
      const owner = (await employeeBasics(tx, [employeeId])).get(employeeId);
      if (owner?.userId) {
        await notify(tx, {
          tenantId: ctx.tenantId,
          userIds: [owner.userId],
          category: "performance",
          title: "A new goal was added for you",
          body: input.title,
          href: "/performance?tab=goals",
          dedupeKey: `goal-assigned:${row.id}`,
        });
      }
    }
    return row;
  });
}

export async function checkInGoal(ctx: RequestContext, input: z.output<typeof goalCheckinSchema>) {
  const a = await goalAccess(ctx);
  return ctx.db(async (tx) => {
    const [g] = await tx.select().from(goals).where(eq(goals.id, input.goalId)).for("update");
    if (!g) throw notFound("Goal");
    if (!canManageGoal(a, g.employeeId)) throw forbidden();
    if (g.cycleId) await loadCycleForGoal(tx, g.cycleId);
    if (g.status === "cancelled") throw invalidState("This goal is cancelled.");
    const value = input.value ?? g.currentValue ?? null;
    const fromValues = input.value != null ? progressFromValues(g.startValue, g.targetValue, input.value) : null;
    const progress = fromValues ?? input.progressPercent ?? g.progressPercent;
    let status = input.status ?? g.status;
    if (!input.status && progress >= 100 && g.status === "active") status = "achieved";
    await tx.insert(goalCheckins).values({ tenantId: ctx.tenantId, goalId: g.id, value, progressPercent: progress, note: input.note, createdBy: ctx.userId });
    const after = { currentValue: value, progressPercent: progress, status };
    await tx.update(goals).set(after).where(eq(goals.id, g.id));
    await audit(tx, ctx, { action: "goal.checked_in", entityType: "goal", entityId: g.id, changes: diff(g, after) });
    return { progressPercent: progress, status };
  });
}

export async function goalCheckinHistory(ctx: RequestContext, goalId: string) {
  const a = await goalAccess(ctx);
  return ctx.db(async (tx) => {
    const [g] = await tx.select().from(goals).where(eq(goals.id, goalId));
    if (!g) throw notFound("Goal");
    const owner = g.employeeId ? (await employeeBasics(tx, [g.employeeId])).get(g.employeeId) : null;
    if (!canViewGoal(a, g, owner?.managerId ?? null, await myManagerId(tx, ctx))) throw notFound("Goal");
    return tx
      .select({ id: goalCheckins.id, value: goalCheckins.value, progressPercent: goalCheckins.progressPercent, note: goalCheckins.note, createdAt: goalCheckins.createdAt, by: users.fullName })
      .from(goalCheckins)
      .leftJoin(users, eq(users.id, goalCheckins.createdBy))
      .where(eq(goalCheckins.goalId, goalId))
      .orderBy(desc(goalCheckins.createdAt))
      .limit(50);
  });
}

/** Goals of one employee in one cycle, for review scoring. */
export async function goalsForReview(tx: Tx, employeeId: string, cycleId: string) {
  return tx
    .select({ id: goals.id, title: goals.title, weight: goals.weight, progressPercent: goals.progressPercent, status: goals.status, targetValue: goals.targetValue, currentValue: goals.currentValue, metricUnit: goals.metricUnit })
    .from(goals)
    .where(and(eq(goals.employeeId, employeeId), eq(goals.cycleId, cycleId), ne(goals.status, "cancelled")))
    .orderBy(goals.createdAt);
}
