import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Tx } from "../../db/client";
import { withSystem } from "../../db/tx";
import { authorize, can, canAccessEmployee, getTeamEmployeeIds, scopeOf, type RequestContext } from "../../auth/context";
import {
  departments,
  designations,
  employees,
  lifecyclePlans,
  lifecycleTemplateTasks,
  lifecycleTemplates,
  memberships,
  policies,
  tasks,
  users,
} from "../../db/schema";
import { audit } from "../../lib/audit";
import { conflict, forbidden, invalidState, notFound, validation } from "../../lib/errors";
import { notify } from "../notifications";
import { uploadDocument } from "../documents/documents";
import { acknowledgePolicy } from "../documents/policies";
import { markJoined } from "../employees/mutations";
import { todayIn } from "@/lib/format";
import { DOCUMENT_CATEGORY_LABELS } from "@/lib/validation/documents";
import type {
  checkinSchema,
  PlanKind,
  reassignTaskSchema,
  setBuddySchema,
  startPlanSchema,
  waiveTaskSchema,
} from "@/lib/validation/lifecycle";
import { selectTemplate } from "./templates";
import {
  OPEN_TASK_STATUSES,
  PLAN_CONTAINER,
  cfg,
  completeTask,
  isRequired,
  isWaived,
  missingEvidence,
  pendingPoliciesFor,
  progressOf,
  recalcPlan,
  reconcilePlans,
  resolveAssignee,
  shiftDate,
  type CheckinEntry,
  type LifecycleActor,
  type PlanRow,
  type TaskConfig,
  type TaskRow,
} from "./shared";

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

export const managePermFor = (kind: PlanKind): "onboarding.manage" | "exits.manage" => (kind === "onboarding" ? "onboarding.manage" : "exits.manage");
const viewPermFor = (kind: PlanKind): "onboarding.view" | "exits.view" => (kind === "onboarding" ? "onboarding.view" : "exits.view");
export const canManageKind = (ctx: RequestContext, kind: PlanKind) => can(ctx, managePermFor(kind), "all");

async function canViewPlan(ctx: RequestContext, tx: Tx, plan: PlanRow) {
  if (canManageKind(ctx, plan.kind)) return true;
  if (plan.employeeId === ctx.employeeId && scopeOf(ctx, viewPermFor(plan.kind))) return true;
  if (plan.employeeId !== ctx.employeeId && (await canAccessEmployee(ctx, viewPermFor(plan.kind), plan.employeeId))) return true;
  // People who own a task in the plan (IT, buddy, finance) may see it.
  const [mine] = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.containerType, PLAN_CONTAINER), eq(tasks.containerId, plan.id), eq(tasks.assigneeUserId, ctx.userId)))
    .limit(1);
  return !!mine;
}

/** Whether ctx may change this task's status (manager of the module, the assignee, or the employee for their own tasks). */
function canActOn(ctx: RequestContext, task: TaskRow, plan: PlanRow) {
  if (canManageKind(ctx, plan.kind)) return true;
  if (task.assigneeUserId === ctx.userId) return true;
  return task.ownerGroup === "employee" && !!ctx.employeeId && plan.employeeId === ctx.employeeId;
}

const actorOf = (ctx: RequestContext): LifecycleActor => ({ tenantId: ctx.tenantId, userId: ctx.userId });

async function loadTask(tx: Tx, taskId: string, lock = false) {
  const q = tx.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.containerType, PLAN_CONTAINER)));
  const [task] = lock ? await q.for("update") : await q;
  if (!task || !task.containerId) throw notFound("Task");
  const [plan] = await tx.select().from(lifecyclePlans).where(eq(lifecyclePlans.id, task.containerId));
  if (!plan) throw notFound("Plan");
  return { task, plan };
}

/* ------------------------------------------------------------------ */
/* Creating plans                                                      */
/* ------------------------------------------------------------------ */

export type CreatePlanOptions = {
  employeeId: string;
  kind: PlanKind;
  templateId?: string | null;
  buddyEmployeeId?: string | null;
  anchorDate?: string;
  exitCaseId?: string | null;
  /** Return null instead of throwing when the employee already has an open plan of this kind. */
  ifAbsent?: boolean;
};

/**
 * Instantiate a plan from a template inside an open transaction: picks the
 * best-matching template unless one is given, resolves assignees per owner
 * group, computes due dates from the anchor and notifies assignees.
 */
export async function createPlan(tx: Tx, actor: LifecycleActor, opts: CreatePlanOptions): Promise<PlanRow | null> {
  const [emp] = await tx
    .select()
    .from(employees)
    .where(and(eq(employees.id, opts.employeeId), eq(employees.tenantId, actor.tenantId), isNull(employees.deletedAt)));
  if (!emp) throw notFound("Employee");
  const anchor = opts.anchorDate ?? emp.joiningDate;

  let template: typeof lifecycleTemplates.$inferSelect | null = null;
  if (opts.templateId) {
    [template] = await tx
      .select()
      .from(lifecycleTemplates)
      .where(and(eq(lifecycleTemplates.id, opts.templateId), eq(lifecycleTemplates.tenantId, actor.tenantId), eq(lifecycleTemplates.kind, opts.kind)));
    if (!template) throw validation("That template is not available.", { templateId: ["Not found"] });
  } else {
    template = await selectTemplate(tx, actor.tenantId, opts.kind, {
      departmentId: emp.departmentId,
      locationId: emp.locationId,
      legalEntityId: emp.legalEntityId,
      employmentType: emp.employmentType,
    });
  }
  if (!template) {
    throw invalidState(`No active ${opts.kind} template matches this employee. Add the standard templates or create one first.`);
  }

  if (opts.buddyEmployeeId) {
    if (opts.buddyEmployeeId === emp.id) throw validation("The buddy must be someone else.", { buddyEmployeeId: ["Choose someone else"] });
    const [buddy] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.id, opts.buddyEmployeeId), eq(employees.tenantId, actor.tenantId), isNull(employees.deletedAt), inArray(employees.status, ["active", "on_notice"])));
    if (!buddy) throw validation("Choose an active employee as buddy.", { buddyEmployeeId: ["Not found"] });
  }

  const [plan] = await tx
    .insert(lifecyclePlans)
    .values({
      tenantId: actor.tenantId,
      employeeId: emp.id,
      kind: opts.kind,
      templateId: template.id,
      exitCaseId: opts.exitCaseId ?? null,
      anchorDate: anchor,
      buddyEmployeeId: opts.buddyEmployeeId ?? null,
      createdBy: actor.userId,
    })
    .onConflictDoNothing()
    .returning();
  if (!plan) {
    if (opts.ifAbsent) return null;
    throw conflict(`${emp.displayName} already has an open ${opts.kind} plan.`);
  }

  const templateTasks = await tx
    .select()
    .from(lifecycleTemplateTasks)
    .where(eq(lifecycleTemplateTasks.templateId, template.id))
    .orderBy(asc(lifecycleTemplateTasks.sortOrder), asc(lifecycleTemplateTasks.createdAt));

  const cache = new Map<string, Awaited<ReturnType<typeof resolveAssignee>>>();
  const rows: (typeof tasks.$inferInsert)[] = [];
  for (const tt of templateTasks) {
    if (!cache.has(tt.ownerGroup)) cache.set(tt.ownerGroup, await resolveAssignee(tx, actor.tenantId, tt.ownerGroup, emp, plan.buddyEmployeeId));
    const who = cache.get(tt.ownerGroup)!;
    const c = (tt.config ?? {}) as TaskConfig;
    const due = c.anchor === "probation_end" && emp.probationEndDate ? shiftDate(emp.probationEndDate, -7) : shiftDate(anchor, tt.dueOffsetDays);
    rows.push({
      tenantId: actor.tenantId,
      title: tt.title,
      description: tt.description,
      ownerGroup: tt.ownerGroup,
      assigneeUserId: who.userId,
      subjectEmployeeId: emp.id,
      containerType: PLAN_CONTAINER,
      containerId: plan.id,
      dueOn: due,
      kind: tt.kind,
      config: { ...c, templateTaskId: tt.id, assigneeNote: who.note },
      sortOrder: tt.sortOrder,
      priority: isRequired({ config: c }) ? 2 : 1,
      createdBy: actor.userId,
    });
  }
  if (rows.length) await tx.insert(tasks).values(rows);

  await audit(tx, actor, {
    action: `${opts.kind}.plan_started`,
    entityType: "lifecycle_plan",
    entityId: plan.id,
    metadata: { employeeId: emp.id, templateId: template.id, template: template.name, tasks: rows.length, anchorDate: anchor },
  });

  const perAssignee = new Map<string, number>();
  for (const r of rows) if (r.assigneeUserId) perAssignee.set(r.assigneeUserId, (perAssignee.get(r.assigneeUserId) ?? 0) + 1);
  for (const [userId, n] of perAssignee) {
    await notify(tx, {
      tenantId: actor.tenantId,
      userIds: [userId],
      category: opts.kind === "onboarding" ? "onboarding" : "exits",
      title: `${n} ${opts.kind} ${n === 1 ? "task" : "tasks"} for ${emp.displayName}`,
      body: opts.kind === "onboarding" ? "New joiner checklist items are assigned to you." : "Exit checklist items are assigned to you.",
      href: "/inbox?tab=tasks",
      dedupeKey: `plan-assigned:${plan.id}:${userId}`,
    });
  }

  // Evidence that already exists (documents uploaded earlier, policies acknowledged) completes tasks right away.
  await reconcilePlans(tx, actor, [plan.id]);
  return (await recalcPlan(tx, actor, plan.id)) ?? plan;
}

const RECENT_JOIN_DAYS = 90;

export async function startOnboarding(ctx: RequestContext, input: z.output<typeof startPlanSchema>) {
  authorize(ctx, "onboarding.manage", "all");
  return ctx.db(async (tx) => {
    const [emp] = await tx
      .select({ id: employees.id, status: employees.status, joiningDate: employees.joiningDate, name: employees.displayName })
      .from(employees)
      .where(and(eq(employees.id, input.employeeId), isNull(employees.deletedAt)));
    if (!emp) throw notFound("Employee");
    if (emp.status !== "pending" && !(emp.status === "active" && emp.joiningDate >= shiftDate(todayIn(), -RECENT_JOIN_DAYS))) {
      throw invalidState(`Onboarding can start for pre-joining employees or people who joined in the last ${RECENT_JOIN_DAYS} days.`);
    }
    const [open] = await tx
      .select({ id: lifecyclePlans.id })
      .from(lifecyclePlans)
      .where(and(eq(lifecyclePlans.employeeId, emp.id), eq(lifecyclePlans.kind, "onboarding"), inArray(lifecyclePlans.status, ["not_started", "in_progress"])));
    if (open) throw conflict(`${emp.name} already has an open onboarding plan.`);
    const plan = await createPlan(tx, actorOf(ctx), { employeeId: emp.id, kind: "onboarding", templateId: input.templateId, buddyEmployeeId: input.buddyEmployeeId });
    return { id: plan!.id };
  });
}

/**
 * Auto-start onboarding for a new hire (offer accepted / employee created
 * from an offer). System context; idempotent: any existing onboarding plan
 * for the employee, open or closed, means nothing is created.
 */
export async function autoStartOnboarding(tenantId: string, employeeId: string, source: string) {
  return withSystem(async (tx) => {
    const [emp] = await tx
      .select({ id: employees.id, status: employees.status })
      .from(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId), isNull(employees.deletedAt)));
    if (!emp || (emp.status !== "pending" && emp.status !== "active")) return { skipped: "employee not eligible" };
    const [existing] = await tx
      .select({ id: lifecyclePlans.id })
      .from(lifecyclePlans)
      .where(and(eq(lifecyclePlans.tenantId, tenantId), eq(lifecyclePlans.employeeId, employeeId), eq(lifecyclePlans.kind, "onboarding")))
      .limit(1);
    if (existing) return { skipped: "plan exists", planId: existing.id };
    const actor: LifecycleActor = { tenantId, userId: null, actorType: "system" };
    try {
      const plan = await createPlan(tx, actor, { employeeId, kind: "onboarding", ifAbsent: true });
      if (plan) await audit(tx, actor, { action: "onboarding.auto_started", entityType: "lifecycle_plan", entityId: plan.id, metadata: { source } });
      return plan ? { planId: plan.id } : { skipped: "plan exists" };
    } catch (err) {
      // No matching template: nothing to start; HR can start one manually later.
      if (err instanceof Error && "code" in err && (err as { code: string }).code === "INVALID_STATE") return { skipped: err.message };
      throw err;
    }
  }, tenantId);
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

export type PlanListItem = {
  id: string;
  kind: PlanKind;
  status: string;
  progressPercent: number;
  anchorDate: string;
  createdAt: string;
  completedAt: string | null;
  employee: { id: string; name: string; code: string; status: string; designation: string | null; department: string | null };
  templateName: string | null;
  taskCount: number;
  openCount: number;
  overdueCount: number;
};

/** Plans visible to the caller: all (manage / view:all) or their team (view:team). */
export async function listPlans(ctx: RequestContext, opts: { kind?: PlanKind; status?: "open" | "completed" | "all" } = {}): Promise<PlanListItem[]> {
  const kind = opts.kind ?? "onboarding";
  const scope = canManageKind(ctx, kind) ? "all" : scopeOf(ctx, viewPermFor(kind));
  if (!scope || scope === "self") throw forbidden();
  const team = scope === "team" ? await getTeamEmployeeIds(ctx) : null;
  if (team && !team.length) return [];
  const today = todayIn();
  return ctx.db(async (tx) => {
    const statusFilter =
      opts.status === "completed"
        ? eq(lifecyclePlans.status, "completed")
        : opts.status === "all"
          ? undefined
          : inArray(lifecyclePlans.status, ["not_started", "in_progress"]);
    const rows = await tx
      .select({
        plan: lifecyclePlans,
        name: employees.displayName,
        code: employees.employeeCode,
        empStatus: employees.status,
        designation: designations.title,
        department: departments.name,
        templateName: lifecycleTemplates.name,
      })
      .from(lifecyclePlans)
      .innerJoin(employees, eq(employees.id, lifecyclePlans.employeeId))
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(lifecycleTemplates, eq(lifecycleTemplates.id, lifecyclePlans.templateId))
      .where(and(eq(lifecyclePlans.kind, kind), statusFilter, team ? inArray(lifecyclePlans.employeeId, team) : undefined))
      .orderBy(asc(lifecyclePlans.anchorDate), desc(lifecyclePlans.createdAt))
      .limit(500);
    if (!rows.length) return [];
    const counts = await tx
      .select({
        planId: tasks.containerId,
        total: sql<number>`count(*)`.mapWith(Number),
        open: sql<number>`count(*) filter (where ${tasks.status} in ('open','in_progress','blocked'))`.mapWith(Number),
        overdue: sql<number>`count(*) filter (where ${tasks.status} in ('open','in_progress','blocked') and ${tasks.dueOn} < ${today}::date)`.mapWith(Number),
      })
      .from(tasks)
      .where(and(eq(tasks.containerType, PLAN_CONTAINER), inArray(tasks.containerId, rows.map((r) => r.plan.id))))
      .groupBy(tasks.containerId);
    const byPlan = new Map(counts.map((c) => [c.planId, c]));
    return rows.map((r) => ({
      id: r.plan.id,
      kind: r.plan.kind,
      status: r.plan.status,
      progressPercent: r.plan.progressPercent,
      anchorDate: r.plan.anchorDate,
      createdAt: r.plan.createdAt.toISOString(),
      completedAt: r.plan.completedAt?.toISOString() ?? null,
      employee: { id: r.plan.employeeId, name: r.name, code: r.code, status: r.empStatus, designation: r.designation, department: r.department },
      templateName: r.templateName,
      taskCount: byPlan.get(r.plan.id)?.total ?? 0,
      openCount: byPlan.get(r.plan.id)?.open ?? 0,
      overdueCount: byPlan.get(r.plan.id)?.overdue ?? 0,
    }));
  });
}

/* ------------------------------------------------------------------ */
/* Plan detail                                                         */
/* ------------------------------------------------------------------ */

export type PlanTask = {
  id: string;
  title: string;
  description: string | null;
  ownerGroup: string;
  kind: string;
  code: string | null;
  status: string;
  dueOn: string | null;
  overdue: boolean;
  required: boolean;
  assigneeUserId: string | null;
  assigneeName: string | null;
  assigneeNote: string | null;
  completedAt: string | null;
  completedByName: string | null;
  waived: { reason: string; at: string; byName: string | null } | null;
  documentCategory: string | null;
  documentLabel: string | null;
  formTarget: string | null;
  policy: { id: string; title: string } | null;
  checkin: TaskConfig["checkin"] | null;
  checkinDay: number | null;
  confirmation: { note: string; at: string; byName: string | null } | null;
  /** Null when completion evidence exists (or none is needed). */
  missingEvidence: string | null;
  canUpdate: boolean;
};

export type TimelineEntry = { at: string; label: string; detail: string | null };

export type PlanDetail = {
  id: string;
  kind: PlanKind;
  status: string;
  progressPercent: number;
  anchorDate: string;
  createdAt: string;
  completedAt: string | null;
  exitCaseId: string | null;
  templateName: string | null;
  employee: {
    id: string;
    name: string;
    code: string;
    status: string;
    joiningDate: string;
    designation: string | null;
    department: string | null;
    managerName: string | null;
    hasLogin: boolean;
  };
  buddy: { id: string; name: string } | null;
  tasks: PlanTask[];
  pendingPolicies: { id: string; title: string }[];
  timeline: TimelineEntry[];
  canManage: boolean;
  isSubject: boolean;
};

async function hydrateTasks(tx: Tx, ctx: RequestContext, plan: PlanRow, rows: TaskRow[]): Promise<PlanTask[]> {
  const today = todayIn();
  const userIds = [
    ...new Set(
      rows.flatMap((t) => [t.assigneeUserId, t.completedBy, cfg(t).waived?.by, cfg(t).confirmation?.by]).filter((x): x is string => !!x),
    ),
  ];
  const policyIds = [...new Set(rows.map((t) => cfg(t).policyId).filter((x): x is string => !!x))];
  const [people, pols] = await Promise.all([
    userIds.length ? tx.select({ id: users.id, name: users.fullName, email: users.email }).from(users).where(inArray(users.id, userIds)) : [],
    policyIds.length ? tx.select({ id: policies.id, title: policies.title }).from(policies).where(inArray(policies.id, policyIds)) : [],
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.name ?? p.email]));
  const policyOf = new Map(pols.map((p) => [p.id, p]));
  const out: PlanTask[] = [];
  for (const t of rows) {
    const c = cfg(t);
    const open = (OPEN_TASK_STATUSES as readonly string[]).includes(t.status);
    out.push({
      id: t.id,
      title: t.title,
      description: t.description,
      ownerGroup: t.ownerGroup,
      kind: t.kind,
      code: c.code ?? null,
      status: isWaived(t) ? "waived" : t.status,
      dueOn: t.dueOn,
      overdue: open && !!t.dueOn && t.dueOn < today,
      required: isRequired(t),
      assigneeUserId: t.assigneeUserId,
      assigneeName: t.assigneeUserId ? (nameOf.get(t.assigneeUserId) ?? null) : null,
      assigneeNote: t.assigneeUserId ? null : (c.assigneeNote ?? null),
      completedAt: t.completedAt?.toISOString() ?? null,
      completedByName: t.completedBy ? (nameOf.get(t.completedBy) ?? null) : null,
      waived: c.waived ? { reason: c.waived.reason, at: c.waived.at, byName: nameOf.get(c.waived.by) ?? null } : null,
      documentCategory: c.documentCategory ?? null,
      documentLabel: c.documentCategory ? (DOCUMENT_CATEGORY_LABELS[c.documentCategory] ?? c.documentCategory) : null,
      formTarget: c.formTarget ?? null,
      policy: c.policyId ? (policyOf.get(c.policyId) ?? null) : null,
      checkin: c.checkin ?? null,
      checkinDay: c.checkinDay ?? null,
      confirmation: c.confirmation ? { note: c.confirmation.note, at: c.confirmation.at, byName: nameOf.get(c.confirmation.by) ?? null } : null,
      missingEvidence: open ? await missingEvidence(tx, t, plan) : null,
      canUpdate: canActOn(ctx, t, plan) && t.status !== "cancelled",
    });
  }
  return out;
}

export async function planTasks(tx: Tx, planId: string) {
  return tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.containerType, PLAN_CONTAINER), eq(tasks.containerId, planId)))
    .orderBy(asc(tasks.sortOrder), asc(tasks.dueOn), asc(tasks.createdAt));
}

export async function loadPlanDetail(tx: Tx, ctx: RequestContext, plan: PlanRow): Promise<PlanDetail> {
  const [emp] = await tx
    .select({
      id: employees.id,
      name: employees.displayName,
      code: employees.employeeCode,
      status: employees.status,
      joiningDate: employees.joiningDate,
      userId: employees.userId,
      designation: designations.title,
      department: departments.name,
      managerName: sql<string | null>`(select m.display_name from employees m where m.id = ${employees.managerId})`,
    })
    .from(employees)
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(eq(employees.id, plan.employeeId));
  const [buddy] = plan.buddyEmployeeId
    ? await tx.select({ id: employees.id, name: employees.displayName }).from(employees).where(eq(employees.id, plan.buddyEmployeeId))
    : [];
  const [template] = plan.templateId
    ? await tx.select({ name: lifecycleTemplates.name }).from(lifecycleTemplates).where(eq(lifecycleTemplates.id, plan.templateId))
    : [];
  const rows = await planTasks(tx, plan.id);
  const hydrated = await hydrateTasks(tx, ctx, plan, rows);
  const pending = rows.some((t) => t.kind === "acknowledgement" && !cfg(t).policyId) ? await pendingPoliciesFor(tx, plan.employeeId) : [];
  const [creator] = plan.createdBy ? await tx.select({ name: users.fullName, email: users.email }).from(users).where(eq(users.id, plan.createdBy)) : [];

  const timeline: TimelineEntry[] = [
    { at: plan.createdAt.toISOString(), label: "Plan started", detail: creator ? `by ${creator.name ?? creator.email}` : "automatically" },
    ...hydrated.filter((t) => t.status === "done" && t.completedAt).map((t) => ({ at: t.completedAt!, label: `Done: ${t.title}`, detail: t.completedByName ? `by ${t.completedByName}` : "automatically" })),
    ...hydrated.filter((t) => t.waived).map((t) => ({ at: t.waived!.at, label: `Waived: ${t.title}`, detail: t.waived!.reason })),
    ...hydrated.flatMap((t) =>
      [t.checkin?.employee, t.checkin?.manager].filter((e): e is CheckinEntry => !!e).map((e) => ({ at: e.at, label: `Check-in note: ${t.title}`, detail: e.byName ? `by ${e.byName}` : null })),
    ),
    ...(plan.completedAt ? [{ at: plan.completedAt.toISOString(), label: "Plan completed", detail: null }] : []),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return {
    id: plan.id,
    kind: plan.kind,
    status: plan.status,
    progressPercent: plan.progressPercent,
    anchorDate: plan.anchorDate,
    createdAt: plan.createdAt.toISOString(),
    completedAt: plan.completedAt?.toISOString() ?? null,
    exitCaseId: plan.exitCaseId,
    templateName: template?.name ?? null,
    employee: {
      id: emp.id,
      name: emp.name,
      code: emp.code,
      status: emp.status,
      joiningDate: emp.joiningDate,
      designation: emp.designation,
      department: emp.department,
      managerName: emp.managerName,
      hasLogin: !!emp.userId,
    },
    buddy: buddy ?? null,
    tasks: hydrated,
    pendingPolicies: pending.map((p) => ({ id: p.id, title: p.title })),
    timeline,
    canManage: canManageKind(ctx, plan.kind),
    isSubject: plan.employeeId === ctx.employeeId,
  };
}

export async function getPlanDetail(ctx: RequestContext, planId: string): Promise<PlanDetail> {
  return ctx.db(async (tx) => {
    const [plan] = await tx.select().from(lifecyclePlans).where(eq(lifecyclePlans.id, planId));
    if (!plan) throw notFound("Plan");
    if (!(await canViewPlan(ctx, tx, plan))) throw forbidden();
    return loadPlanDetail(tx, ctx, plan);
  });
}

/** The signed-in employee's own onboarding plan (open first, else the latest). */
export async function myOnboarding(ctx: RequestContext): Promise<PlanDetail | null> {
  if (!ctx.employeeId) return null;
  const me = ctx.employeeId;
  return ctx.db(async (tx) => {
    const [plan] = await tx
      .select()
      .from(lifecyclePlans)
      .where(and(eq(lifecyclePlans.employeeId, me), eq(lifecyclePlans.kind, "onboarding"), ne(lifecyclePlans.status, "cancelled")))
      .orderBy(sql`case when ${lifecyclePlans.status} in ('not_started','in_progress') then 0 else 1 end`, desc(lifecyclePlans.createdAt))
      .limit(1);
    if (!plan) return null;
    return loadPlanDetail(tx, ctx, plan);
  });
}

/* ------------------------------------------------------------------ */
/* Task actions                                                        */
/* ------------------------------------------------------------------ */

export async function setPlanTaskStatus(ctx: RequestContext, input: { taskId: string; status: "open" | "in_progress" | "blocked" | "done" }) {
  return ctx.db(async (tx) => {
    const { task, plan } = await loadTask(tx, input.taskId, true);
    if (!canActOn(ctx, task, plan)) throw forbidden();
    if (task.status === "cancelled") throw invalidState(isWaived(task) ? "This task was waived. Reopen it first." : "This task was cancelled.");
    if (plan.status === "cancelled") throw invalidState("This plan was cancelled.");
    if (task.status === input.status) return { id: task.id, status: task.status };
    if (input.status === "done") {
      const missing = await missingEvidence(tx, task, plan);
      if (missing) throw invalidState(missing);
      await completeTask(tx, actorOf(ctx), task);
      return { id: task.id, status: "done" };
    }
    await tx.update(tasks).set({ status: input.status, completedAt: null, completedBy: null }).where(eq(tasks.id, task.id));
    await audit(tx, ctx, { action: `task.${input.status}`, entityType: "task", entityId: task.id, metadata: { title: task.title } });
    await recalcPlan(tx, actorOf(ctx), plan.id);
    return { id: task.id, status: input.status };
  });
}

export async function waiveTask(ctx: RequestContext, input: z.output<typeof waiveTaskSchema>) {
  return ctx.db(async (tx) => {
    const { task, plan } = await loadTask(tx, input.taskId, true);
    if (!canManageKind(ctx, plan.kind)) throw forbidden();
    if (task.status === "done") throw invalidState("This task is already done.");
    if (task.status === "cancelled") throw invalidState("This task is already closed.");
    const config: TaskConfig = { ...cfg(task), waived: { reason: input.reason, by: ctx.userId, at: new Date().toISOString() } };
    await tx.update(tasks).set({ status: "cancelled", config, completedAt: null, completedBy: null }).where(eq(tasks.id, task.id));
    await audit(tx, ctx, { action: "task.waived", entityType: "task", entityId: task.id, metadata: { title: task.title, reason: input.reason } });
    await recalcPlan(tx, actorOf(ctx), plan.id);
    return { id: task.id };
  });
}

export async function reopenTask(ctx: RequestContext, taskId: string) {
  return ctx.db(async (tx) => {
    const { task, plan } = await loadTask(tx, taskId, true);
    if (!canManageKind(ctx, plan.kind)) throw forbidden();
    if (plan.status === "cancelled") throw invalidState("This plan was cancelled.");
    if (task.status !== "done" && !isWaived(task)) throw invalidState("Only completed or waived tasks can be reopened.");
    const { waived: _w, ...rest } = cfg(task);
    void _w;
    await tx.update(tasks).set({ status: "open", config: rest, completedAt: null, completedBy: null }).where(eq(tasks.id, task.id));
    await audit(tx, ctx, { action: "task.reopened", entityType: "task", entityId: task.id, metadata: { title: task.title } });
    await recalcPlan(tx, actorOf(ctx), plan.id);
    return { id: task.id };
  });
}

export async function sendTaskReminder(ctx: RequestContext, taskId: string) {
  return ctx.db(async (tx) => {
    const { task, plan } = await loadTask(tx, taskId);
    if (!canManageKind(ctx, plan.kind)) throw forbidden();
    if (!(OPEN_TASK_STATUSES as readonly string[]).includes(task.status)) throw invalidState("Only open tasks need reminders.");
    if (!task.assigneeUserId) throw invalidState("Assign this task to someone before sending a reminder.");
    const [emp] = await tx.select({ name: employees.displayName }).from(employees).where(eq(employees.id, plan.employeeId));
    await notify(tx, {
      tenantId: ctx.tenantId,
      userIds: [task.assigneeUserId],
      category: plan.kind === "onboarding" ? "onboarding" : "exits",
      title: `Reminder: ${task.title}`,
      body: `${plan.kind === "onboarding" ? "Onboarding" : "Exit"} task for ${emp?.name ?? "an employee"}${task.dueOn ? `, due ${task.dueOn}` : ""}.`,
      href: "/inbox?tab=tasks",
      dedupeKey: `lifecycle-reminder:${task.id}:${todayIn()}`,
    });
    await audit(tx, ctx, { action: "task.reminder_sent", entityType: "task", entityId: task.id, metadata: { title: task.title } });
    return { id: task.id };
  });
}

/** Active members who can be assigned lifecycle tasks. */
export async function assignableMembers(ctx: RequestContext) {
  return ctx.db((tx) =>
    tx
      .select({ value: users.id, label: sql<string>`coalesce(${users.fullName}, ${users.email})`, hint: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.status, "active")))
      .orderBy(asc(users.fullName), asc(users.email))
      .limit(2000),
  );
}

/** Active employees who can be chosen as onboarding buddies. */
export async function buddyOptions(ctx: RequestContext) {
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ value: employees.id, label: employees.displayName, hint: employees.employeeCode })
      .from(employees)
      .where(and(isNull(employees.deletedAt), inArray(employees.status, ["active", "on_notice"])))
      .orderBy(asc(employees.displayName))
      .limit(5000);
    return rows;
  });
}

export async function reassignTask(ctx: RequestContext, input: z.output<typeof reassignTaskSchema>) {
  return ctx.db(async (tx) => {
    const { task, plan } = await loadTask(tx, input.taskId, true);
    if (!canManageKind(ctx, plan.kind)) throw forbidden();
    if (input.assigneeUserId) {
      const [m] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, input.assigneeUserId), eq(memberships.status, "active")));
      if (!m) throw validation("Choose an active member.", { assigneeUserId: ["Not an active member"] });
    }
    const config: TaskConfig = { ...cfg(task), assigneeNote: input.assigneeUserId ? null : "Unassigned." };
    await tx.update(tasks).set({ assigneeUserId: input.assigneeUserId, config }).where(eq(tasks.id, task.id));
    await audit(tx, ctx, { action: "task.reassigned", entityType: "task", entityId: task.id, metadata: { title: task.title, to: input.assigneeUserId } });
    if (input.assigneeUserId && input.assigneeUserId !== ctx.userId) {
      await notify(tx, {
        tenantId: ctx.tenantId,
        userIds: [input.assigneeUserId],
        category: plan.kind === "onboarding" ? "onboarding" : "exits",
        title: `Task assigned to you: ${task.title}`,
        href: "/inbox?tab=tasks",
        dedupeKey: `task-assigned:${task.id}:${input.assigneeUserId}`,
      });
    }
    return { id: task.id };
  });
}

export async function setBuddy(ctx: RequestContext, input: z.output<typeof setBuddySchema>) {
  authorize(ctx, "onboarding.manage", "all");
  return ctx.db(async (tx) => {
    const [plan] = await tx.select().from(lifecyclePlans).where(eq(lifecyclePlans.id, input.planId)).for("update");
    if (!plan || plan.kind !== "onboarding") throw notFound("Plan");
    if (plan.status === "cancelled" || plan.status === "completed") throw invalidState("This plan is closed.");
    if (input.buddyEmployeeId) {
      if (input.buddyEmployeeId === plan.employeeId) throw validation("The buddy must be someone else.", { buddyEmployeeId: ["Choose someone else"] });
      const [b] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.id, input.buddyEmployeeId), isNull(employees.deletedAt), inArray(employees.status, ["active", "on_notice"])));
      if (!b) throw validation("Choose an active employee.", { buddyEmployeeId: ["Not found"] });
    }
    await tx.update(lifecyclePlans).set({ buddyEmployeeId: input.buddyEmployeeId }).where(eq(lifecyclePlans.id, plan.id));
    const [emp] = await tx
      .select({ id: employees.id, userId: employees.userId, managerId: employees.managerId, displayName: employees.displayName })
      .from(employees)
      .where(eq(employees.id, plan.employeeId));
    const who = await resolveAssignee(tx, ctx.tenantId, "buddy", emp, input.buddyEmployeeId);
    const buddyTasks = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.containerType, PLAN_CONTAINER), eq(tasks.containerId, plan.id), eq(tasks.ownerGroup, "buddy"), inArray(tasks.status, [...OPEN_TASK_STATUSES])));
    for (const t of buddyTasks) {
      await tx.update(tasks).set({ assigneeUserId: who.userId, config: { ...cfg(t), assigneeNote: who.note } }).where(eq(tasks.id, t.id));
    }
    if (who.userId && buddyTasks.length) {
      await notify(tx, {
        tenantId: ctx.tenantId,
        userIds: [who.userId],
        category: "onboarding",
        title: `You are ${emp.displayName}'s onboarding buddy`,
        body: "Buddy tasks are in your inbox.",
        href: "/inbox?tab=tasks",
        dedupeKey: `buddy:${plan.id}:${who.userId}`,
      });
    }
    await audit(tx, ctx, { action: "onboarding.buddy_set", entityType: "lifecycle_plan", entityId: plan.id, metadata: { buddyEmployeeId: input.buddyEmployeeId } });
    return { id: plan.id };
  });
}

export async function cancelPlan(ctx: RequestContext, planId: string) {
  return ctx.db(async (tx) => {
    const [plan] = await tx.select().from(lifecyclePlans).where(eq(lifecyclePlans.id, planId)).for("update");
    if (!plan) throw notFound("Plan");
    if (!canManageKind(ctx, plan.kind)) throw forbidden();
    if (plan.kind === "offboarding" && plan.exitCaseId) throw invalidState("Cancel the exit case instead; its checklist closes with it.");
    if (plan.status === "cancelled" || plan.status === "completed") throw invalidState("This plan is already closed.");
    await closePlan(tx, ctx, plan.id);
    return { id: plan.id };
  });
}

/** Cancel a plan and its open tasks (used for plan cancellation and withdrawn exits). */
export async function closePlan(tx: Tx, actor: LifecycleActor, planId: string) {
  await tx.update(lifecyclePlans).set({ status: "cancelled" }).where(eq(lifecyclePlans.id, planId));
  await tx
    .update(tasks)
    .set({ status: "cancelled" })
    .where(and(eq(tasks.containerType, PLAN_CONTAINER), eq(tasks.containerId, planId), inArray(tasks.status, [...OPEN_TASK_STATUSES])));
  await audit(tx, actor, { action: "lifecycle.plan_cancelled", entityType: "lifecycle_plan", entityId: planId });
}

/* ------------------------------------------------------------------ */
/* Evidence-producing actions                                          */
/* ------------------------------------------------------------------ */

/** Upload the document a task asks for, then complete the task. */
export async function uploadForTask(ctx: RequestContext, input: { taskId: string; title: string; file: File }, meta?: { ip?: string | null; userAgent?: string | null }) {
  const { task, plan } = await ctx.db((tx) => loadTask(tx, input.taskId));
  if (!canActOn(ctx, task, plan)) throw forbidden();
  if (task.kind !== "document_upload") throw invalidState("This task does not take a document.");
  if (task.status === "cancelled") throw invalidState("This task is closed.");
  const category = cfg(task).documentCategory ?? "other";
  const doc = await uploadDocument(ctx, { ownerType: "employee", employeeId: plan.employeeId, category, title: input.title, file: input.file }, { meta });
  await ctx.db(async (tx) => {
    const fresh = await loadTask(tx, task.id, true);
    if ((OPEN_TASK_STATUSES as readonly string[]).includes(fresh.task.status) && !(await missingEvidence(tx, fresh.task, fresh.plan))) {
      await completeTask(tx, actorOf(ctx), fresh.task);
    }
  });
  return { documentId: doc.id };
}

/** The employee acknowledges a policy from their onboarding checklist. */
export async function acknowledgeForTask(ctx: RequestContext, input: { taskId: string; policyId: string }, meta?: { ip?: string | null }) {
  const { task, plan } = await ctx.db((tx) => loadTask(tx, input.taskId));
  if (task.kind !== "acknowledgement") throw invalidState("This task is not a policy acknowledgement.");
  if (!ctx.employeeId || plan.employeeId !== ctx.employeeId) throw forbidden("Only the employee can acknowledge their policies.");
  const c = cfg(task);
  if (c.policyId && c.policyId !== input.policyId) throw validation("That policy is not part of this task.");
  await acknowledgePolicy(ctx, input.policyId, meta);
  return ctx.db(async (tx) => {
    const fresh = await loadTask(tx, task.id, true);
    if ((OPEN_TASK_STATUSES as readonly string[]).includes(fresh.task.status) && !(await missingEvidence(tx, fresh.task, fresh.plan))) {
      await completeTask(tx, actorOf(ctx), fresh.task);
      return { completed: true };
    }
    return { completed: false };
  });
}

/** Record a 30/60/90-day check-in note. The manager's (or HR's) note completes the task. */
export async function recordCheckin(ctx: RequestContext, input: z.output<typeof checkinSchema>) {
  return ctx.db(async (tx) => {
    const { task, plan } = await loadTask(tx, input.taskId, true);
    if (task.kind !== "checkin") throw invalidState("This task is not a check-in.");
    if (task.status === "cancelled") throw invalidState("This task is closed.");
    const isSubject = !!ctx.employeeId && plan.employeeId === ctx.employeeId;
    const side: "manager" | "employee" | null = isSubject
      ? "employee"
      : canManageKind(ctx, plan.kind) || task.assigneeUserId === ctx.userId
        ? "manager"
        : null;
    if (!side) throw forbidden();
    const c = cfg(task);
    const entry: CheckinEntry = {
      by: ctx.userId,
      byName: ctx.fullName ?? ctx.email,
      at: new Date().toISOString(),
      settlingIn: input.settlingIn,
      note: input.note,
      followUps: input.followUps,
    };
    const config: TaskConfig = { ...c, checkin: { ...c.checkin, [side]: entry } };
    await audit(tx, ctx, { action: "onboarding.checkin_recorded", entityType: "task", entityId: task.id, metadata: { side, settlingIn: input.settlingIn } });
    if (side === "manager" && task.status !== "done") {
      await completeTask(tx, actorOf(ctx), task, { config });
      return { completed: true };
    }
    await tx.update(tasks).set({ config }).where(eq(tasks.id, task.id));
    return { completed: false };
  });
}

/** Mark the joiner as joined from their plan (HR confirms; never automatic). */
export async function markJoinedFromPlan(ctx: RequestContext, input: { employeeId: string; joinedOn: string }) {
  authorize(ctx, "onboarding.manage", "all");
  await markJoined(ctx, input.employeeId, input.joinedOn);
  return { employeeId: input.employeeId };
}

/** Reconcile evidence for one plan from the UI (e.g. after an upload elsewhere). */
export async function refreshPlan(ctx: RequestContext, planId: string) {
  return ctx.db(async (tx) => {
    const [plan] = await tx.select().from(lifecyclePlans).where(eq(lifecyclePlans.id, planId));
    if (!plan) throw notFound("Plan");
    if (!(await canViewPlan(ctx, tx, plan))) throw forbidden();
    return reconcilePlans(tx, actorOf(ctx), [plan.id]);
  });
}

export { progressOf };

/** Employees HR can start onboarding for: pre-joining or joined recently, without an open plan. */
export async function onboardingCandidates(ctx: RequestContext) {
  authorize(ctx, "onboarding.manage", "all");
  const since = shiftDate(todayIn(), -RECENT_JOIN_DAYS);
  return ctx.db((tx) =>
    tx
      .select({ value: employees.id, label: employees.displayName, hint: sql<string>`${employees.employeeCode} || ' · joins ' || to_char(${employees.joiningDate}, 'DD Mon YYYY')` })
      .from(employees)
      .where(
        and(
          isNull(employees.deletedAt),
          sql`(${employees.status} = 'pending' or (${employees.status} = 'active' and ${employees.joiningDate} >= ${since}::date))`,
          sql`not exists (select 1 from lifecycle_plans p where p.employee_id = ${employees.id} and p.kind = 'onboarding' and p.status in ('not_started','in_progress'))`,
        ),
      )
      .orderBy(asc(employees.joiningDate), asc(employees.displayName))
      .limit(2000),
  );
}
