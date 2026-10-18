import { and, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import type { z } from "zod";
import { authorize, type RequestContext } from "../../../auth/context";
import type { Tx } from "../../../db/client";
import { courses, employees, jobs, learningAssignments, learningEnrollments, learningPaths } from "../../../db/schema";
import { audit } from "../../../lib/audit";
import { notFound, validation } from "../../../lib/errors";
import { notify } from "../../notifications";
import { todayIn } from "@/lib/format";
import { addDaysIso, matchesAssignment, type AssignmentTarget } from "@/lib/talent/learning";
import type { learningAssignmentSchema } from "@/lib/validation/talent";
import { notifyEnrolled } from "./enrollments";

/**
 * Queue the assignment job from a user transaction. Inserted without
 * RETURNING: users may enqueue jobs in their tenant but not read the queue.
 */
async function queueAssignmentRun(tx: Tx, tenantId: string, payload: Record<string, unknown>, dedupeKey: string) {
  await tx.insert(jobs).values({ tenantId, type: "learning.assign", payload, dedupeKey }).onConflictDoNothing();
}

export async function listAssignments(ctx: RequestContext) {
  authorize(ctx, "learning.manage", "all");
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ a: learningAssignments, course: courses.title, path: learningPaths.title })
      .from(learningAssignments)
      .leftJoin(courses, eq(courses.id, learningAssignments.courseId))
      .leftJoin(learningPaths, eq(learningPaths.id, learningAssignments.pathId))
      .orderBy(desc(learningAssignments.createdAt));
    const counts = rows.length
      ? await tx
          .select({ assignmentId: learningEnrollments.assignmentId, status: learningEnrollments.status })
          .from(learningEnrollments)
          .where(inArray(learningEnrollments.assignmentId, rows.map((r) => r.a.id)))
      : [];
    return rows.map((r) => {
      const mine = counts.filter((c) => c.assignmentId === r.a.id);
      return {
        ...r.a,
        courseTitle: r.course,
        pathTitle: r.path,
        enrolled: mine.length,
        completed: mine.filter((m) => m.status === "completed").length,
        createdAt: r.a.createdAt.toISOString(),
        updatedAt: r.a.updatedAt.toISOString(),
      };
    });
  });
}

export async function createAssignment(ctx: RequestContext, input: z.output<typeof learningAssignmentSchema>) {
  authorize(ctx, "learning.manage", "all");
  return ctx.db(async (tx) => {
    if (input.courseId) {
      const [c] = await tx.select({ id: courses.id }).from(courses).where(and(eq(courses.id, input.courseId), eq(courses.isActive, true)));
      if (!c) throw validation("Choose an active course.", { courseId: ["Not found"] });
    }
    if (input.pathId) {
      const [p] = await tx.select({ id: learningPaths.id }).from(learningPaths).where(and(eq(learningPaths.id, input.pathId), eq(learningPaths.isActive, true)));
      if (!p) throw validation("Choose an active learning path.", { pathId: ["Not found"] });
    }
    const target: AssignmentTarget = {};
    if (input.all) target.all = true;
    if (input.newJoiners) target.newJoiners = true;
    if (input.departmentIds.length) target.departmentIds = input.departmentIds;
    if (input.designationIds.length) target.designationIds = input.designationIds;
    const [row] = await tx
      .insert(learningAssignments)
      .values({ tenantId: ctx.tenantId, courseId: input.courseId, pathId: input.pathId, target, dueInDays: input.dueInDays, createdBy: ctx.userId })
      .returning({ id: learningAssignments.id });
    await audit(tx, ctx, { action: "learning.assignment_created", entityType: "learning_assignment", entityId: row.id, metadata: { target, courseId: input.courseId, pathId: input.pathId, dueInDays: input.dueInDays } });
    // Enrollments are created by the job (idempotent), right away and daily after.
    await queueAssignmentRun(tx, ctx.tenantId, { assignmentId: row.id }, `learning-assign:${row.id}`);
    return row;
  });
}

export async function setAssignmentActive(ctx: RequestContext, id: string, isActive: boolean) {
  authorize(ctx, "learning.manage", "all");
  return ctx.db(async (tx) => {
    const [a] = await tx.select().from(learningAssignments).where(eq(learningAssignments.id, id));
    if (!a) throw notFound("Assignment");
    await tx.update(learningAssignments).set({ isActive }).where(eq(learningAssignments.id, id));
    await audit(tx, ctx, { action: isActive ? "learning.assignment_resumed" : "learning.assignment_paused", entityType: "learning_assignment", entityId: id });
    if (isActive) await queueAssignmentRun(tx, ctx.tenantId, { assignmentId: id }, `learning-assign:${id}:${Date.now()}`);
    return { isActive };
  });
}

/* ------------------------------------------------------------------ */
/* System context: rule evaluation, expiry, reminders                  */
/* ------------------------------------------------------------------ */

/** Completed enrollments whose certificate validity has lapsed become expired. */
export async function expireCertificates(tx: Tx, tenantId: string, today = todayIn()) {
  const rows = await tx
    .update(learningEnrollments)
    .set({ status: "expired" })
    .where(and(eq(learningEnrollments.tenantId, tenantId), eq(learningEnrollments.status, "completed"), lte(learningEnrollments.expiresOn, today)))
    .returning({ id: learningEnrollments.id });
  return rows.length;
}

/**
 * Create enrollments for every active assignment rule (or one rule / one
 * employee). Idempotent: an employee is enrolled in a course only when they
 * have no open enrollment, no waiver and no unexpired completion for it, and
 * the partial unique index guards concurrent runs.
 */
export async function runAssignments(tx: Tx, tenantId: string, opts: { assignmentId?: string; employeeId?: string; today?: string } = {}) {
  const today = opts.today ?? todayIn();
  await expireCertificates(tx, tenantId, today);
  const rules = await tx
    .select()
    .from(learningAssignments)
    .where(and(eq(learningAssignments.tenantId, tenantId), eq(learningAssignments.isActive, true), opts.assignmentId ? eq(learningAssignments.id, opts.assignmentId) : undefined));
  if (!rules.length) return { created: 0 };

  const pathIds = rules.map((r) => r.pathId).filter((x): x is string => !!x);
  const paths = pathIds.length ? await tx.select().from(learningPaths).where(and(eq(learningPaths.tenantId, tenantId), inArray(learningPaths.id, pathIds))) : [];
  const pathMap = new Map(paths.filter((p) => p.isActive).map((p) => [p.id, p.courseIds]));
  const allCourseIds = [...new Set(rules.flatMap((r) => (r.courseId ? [r.courseId] : (pathMap.get(r.pathId!) ?? []))))];
  if (!allCourseIds.length) return { created: 0 };
  const activeCourses = await tx
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(and(eq(courses.tenantId, tenantId), eq(courses.isActive, true), inArray(courses.id, allCourseIds)));
  const courseTitle = new Map(activeCourses.map((c) => [c.id, c.title]));

  const people = await tx
    .select({ id: employees.id, userId: employees.userId, departmentId: employees.departmentId, designationId: employees.designationId, joiningDate: employees.joiningDate, status: employees.status })
    .from(employees)
    .where(
      and(
        eq(employees.tenantId, tenantId),
        isNull(employees.deletedAt),
        inArray(employees.status, ["pending", "active", "on_notice"]),
        opts.employeeId ? eq(employees.id, opts.employeeId) : undefined,
      ),
    );
  if (!people.length) return { created: 0 };

  const existing = await tx
    .select({ employeeId: learningEnrollments.employeeId, courseId: learningEnrollments.courseId, status: learningEnrollments.status, expiresOn: learningEnrollments.expiresOn })
    .from(learningEnrollments)
    .where(and(eq(learningEnrollments.tenantId, tenantId), inArray(learningEnrollments.courseId, [...courseTitle.keys()]), opts.employeeId ? eq(learningEnrollments.employeeId, opts.employeeId) : undefined));
  const blocked = new Set(
    existing
      .filter((e) => e.status === "assigned" || e.status === "in_progress" || e.status === "waived" || (e.status === "completed" && (!e.expiresOn || e.expiresOn > today)))
      .map((e) => `${e.employeeId}:${e.courseId}`),
  );

  let created = 0;
  const toNotify: { enrollmentId: string; userId: string | null; title: string; dueOn: string | null }[] = [];
  for (const rule of rules) {
    const courseIds = (rule.courseId ? [rule.courseId] : (pathMap.get(rule.pathId!) ?? [])).filter((id) => courseTitle.has(id));
    const ruleCreatedOn = rule.createdAt.toISOString().slice(0, 10);
    for (const p of people) {
      // Pending (not yet joined) employees are only picked up by new-joiner rules.
      if (p.status === "pending" && !rule.target.newJoiners) continue;
      if (!matchesAssignment(rule.target, p, ruleCreatedOn)) continue;
      const start = p.joiningDate > today ? p.joiningDate : today;
      const dueOn = addDaysIso(start, rule.dueInDays);
      for (const courseId of courseIds) {
        const key = `${p.id}:${courseId}`;
        if (blocked.has(key)) continue;
        const [row] = await tx
          .insert(learningEnrollments)
          .values({ tenantId, employeeId: p.id, courseId, pathId: rule.pathId, assignmentId: rule.id, status: "assigned", dueOn, assignedBy: rule.createdBy })
          .onConflictDoNothing()
          .returning({ id: learningEnrollments.id });
        blocked.add(key);
        if (row) {
          created++;
          toNotify.push({ enrollmentId: row.id, userId: p.userId, title: courseTitle.get(courseId)!, dueOn });
        }
      }
    }
  }
  await notifyEnrolled(tx, tenantId, toNotify);
  return { created };
}

/** Remind learners of open enrollments due within 3 days or overdue; once per enrollment per day. */
export async function sendLearningReminders(tx: Tx, tenantId: string, today = todayIn()) {
  const soon = addDaysIso(today, 3);
  const rows = await tx
    .select({ id: learningEnrollments.id, dueOn: learningEnrollments.dueOn, userId: employees.userId, title: courses.title })
    .from(learningEnrollments)
    .innerJoin(employees, eq(employees.id, learningEnrollments.employeeId))
    .innerJoin(courses, eq(courses.id, learningEnrollments.courseId))
    .where(
      and(
        eq(learningEnrollments.tenantId, tenantId),
        inArray(learningEnrollments.status, ["assigned", "in_progress"]),
        lte(learningEnrollments.dueOn, soon),
        inArray(employees.status, ["active", "on_notice"]),
      ),
    );
  let sent = 0;
  for (const r of rows) {
    if (!r.userId || !r.dueOn) continue;
    await notify(tx, {
      tenantId,
      userIds: [r.userId],
      category: "learning",
      title: r.dueOn < today ? `Overdue: ${r.title}` : `Due soon: ${r.title}`,
      body: `Due ${r.dueOn}.`,
      href: "/learning",
      dedupeKey: `learning-reminder:${r.id}:${today}`,
    });
    sent++;
  }
  return sent;
}
