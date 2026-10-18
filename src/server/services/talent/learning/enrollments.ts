import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { can, getTeamEmployeeIds, type RequestContext } from "../../../auth/context";
import type { Tx } from "../../../db/client";
import { courses, documents, employeeSkills, employees, learningEnrollments, legalEntities, skills, tenants } from "../../../db/schema";
import { audit } from "../../../lib/audit";
import { forbidden, invalidState, notFound } from "../../../lib/errors";
import { PdfBuilder } from "../../../pdf/builder";
import { storeGeneratedPdf } from "../../../pdf/store";
import { emitDomainEvent } from "../../events";
import { notify } from "../../notifications";
import { formatDate, todayIn } from "@/lib/format";
import { addMonthsIso, learningBucket, scoreQuiz } from "@/lib/talent/learning";
import type { progressSchema, quizAttemptSchema } from "@/lib/validation/talent";
import { employeeBasics, requireEmployeeId } from "../shared";

type EnrollmentRow = typeof learningEnrollments.$inferSelect;
type CourseRow = typeof courses.$inferSelect;

export type MyLearningItem = {
  id: string;
  courseId: string;
  title: string;
  format: string;
  durationMinutes: number | null;
  isMandatory: boolean;
  status: EnrollmentRow["status"];
  bucket: ReturnType<typeof learningBucket>;
  dueOn: string | null;
  progressPercent: number;
  score: number | null;
  attempts: number;
  completedAt: string | null;
  expiresOn: string | null;
  certificateDocumentId: string | null;
};

export async function listMyLearning(ctx: RequestContext): Promise<MyLearningItem[]> {
  if (!ctx.employeeId) return [];
  const me = ctx.employeeId;
  const today = todayIn();
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ e: learningEnrollments, c: courses })
      .from(learningEnrollments)
      .innerJoin(courses, eq(courses.id, learningEnrollments.courseId))
      .where(eq(learningEnrollments.employeeId, me))
      .orderBy(desc(learningEnrollments.createdAt))
      .limit(500);
    return rows.map(({ e, c }) => ({
      id: e.id,
      courseId: c.id,
      title: c.title,
      format: c.format,
      durationMinutes: c.durationMinutes,
      isMandatory: c.isMandatory,
      status: e.status,
      bucket: learningBucket(e.status, e.dueOn, today),
      dueOn: e.dueOn,
      progressPercent: e.progressPercent,
      score: e.score,
      attempts: e.attempts,
      completedAt: e.completedAt?.toISOString() ?? null,
      expiresOn: e.expiresOn,
      certificateDocumentId: e.certificateDocumentId,
    }));
  });
}

/** Optional self-enrollment in an active catalog course. Idempotent. */
export async function enrollSelf(ctx: RequestContext, courseId: string) {
  const me = requireEmployeeId(ctx);
  if (!ctx.grants["learning.view"]) throw forbidden();
  return ctx.db(async (tx) => {
    const [c] = await tx.select().from(courses).where(and(eq(courses.id, courseId), eq(courses.isActive, true)));
    if (!c) throw notFound("Course");
    const existing = await tx
      .select()
      .from(learningEnrollments)
      .where(and(eq(learningEnrollments.employeeId, me), eq(learningEnrollments.courseId, courseId)))
      .orderBy(desc(learningEnrollments.createdAt));
    const today = todayIn();
    const live = existing.find((e) => e.status === "assigned" || e.status === "in_progress" || (e.status === "completed" && (!e.expiresOn || e.expiresOn > today)));
    if (live) return { id: live.id, created: false };
    const [row] = await tx
      .insert(learningEnrollments)
      .values({ tenantId: ctx.tenantId, employeeId: me, courseId, status: "assigned", assignedBy: ctx.userId })
      .onConflictDoNothing()
      .returning({ id: learningEnrollments.id });
    if (row) await audit(tx, ctx, { action: "learning.enrolled", entityType: "learning_enrollment", entityId: row.id, metadata: { courseId, self: true } });
    return { id: row?.id ?? null, created: !!row };
  });
}

async function lockOwnEnrollment(tx: Tx, ctx: RequestContext, enrollmentId: string) {
  const me = requireEmployeeId(ctx);
  const [row] = await tx
    .select({ e: learningEnrollments, c: courses })
    .from(learningEnrollments)
    .innerJoin(courses, eq(courses.id, learningEnrollments.courseId))
    .where(eq(learningEnrollments.id, enrollmentId))
    .for("update", { of: learningEnrollments });
  if (!row || row.e.employeeId !== me) throw notFound("Enrollment");
  return row;
}

/** Mark progress. Courses without a quiz complete at 100%. */
export async function updateProgress(ctx: RequestContext, input: z.output<typeof progressSchema>) {
  return ctx.db(async (tx) => {
    const { e, c } = await lockOwnEnrollment(tx, ctx, input.enrollmentId);
    if (e.status !== "assigned" && e.status !== "in_progress") throw invalidState("This course is not open.");
    const hasQuiz = !!c.quiz?.questions.length;
    const progress = Math.max(e.progressPercent, hasQuiz ? Math.min(input.progressPercent, 99) : input.progressPercent);
    if (!hasQuiz && progress >= 100) {
      const result = await completeEnrollment(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, e, c, null);
      return { status: "completed" as const, ...result };
    }
    await tx.update(learningEnrollments).set({ status: "in_progress", progressPercent: progress }).where(eq(learningEnrollments.id, e.id));
    return { status: "in_progress" as const, progressPercent: progress, certificateDocumentId: null };
  });
}

/** Score server-side; attempts are counted; a pass completes the course. */
export async function submitQuiz(ctx: RequestContext, input: z.output<typeof quizAttemptSchema>) {
  return ctx.db(async (tx) => {
    const { e, c } = await lockOwnEnrollment(tx, ctx, input.enrollmentId);
    if (e.status !== "assigned" && e.status !== "in_progress") throw invalidState("This course is not open.");
    if (!c.quiz?.questions.length) throw invalidState("This course has no quiz.");
    const result = scoreQuiz(c.quiz, input.answers);
    const attempts = e.attempts + 1;
    await tx
      .update(learningEnrollments)
      .set({ attempts, score: result.score, status: "in_progress", progressPercent: Math.max(e.progressPercent, result.passed ? 100 : 90) })
      .where(eq(learningEnrollments.id, e.id));
    await audit(tx, ctx, { action: "learning.quiz_attempted", entityType: "learning_enrollment", entityId: e.id, metadata: { courseId: c.id, score: result.score, passed: result.passed, attempts } });
    if (!result.passed) return { ...result, attempts, certificateDocumentId: null };
    const done = await completeEnrollment(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, { ...e, attempts, score: result.score }, c, result.score);
    return { ...result, attempts, certificateDocumentId: done.certificateDocumentId };
  });
}

async function certificatePdf(tx: Tx, input: { tenantId: string; employeeId: string; course: CourseRow; completedOn: string; expiresOn: string | null; score: number | null }) {
  const [org] = await tx
    .select({ tenantName: tenants.name, legalName: legalEntities.legalName, employeeName: employees.displayName, code: employees.employeeCode })
    .from(employees)
    .innerJoin(tenants, eq(tenants.id, employees.tenantId))
    .leftJoin(legalEntities, eq(legalEntities.id, employees.legalEntityId))
    .where(eq(employees.id, input.employeeId));
  const pdf = await PdfBuilder.create({ title: `Certificate - ${input.course.title}`, author: org?.tenantName, footer: org?.tenantName ?? undefined });
  pdf.letterhead({ name: org?.tenantName ?? "PeopleSuccess", legalName: org?.legalName }, "Certificate of completion");
  pdf.spacer(18);
  pdf.text("This certifies that", { size: 11, align: "center" });
  pdf.spacer(4);
  pdf.text(org?.employeeName ?? "Employee", { size: 20, bold: true, align: "center" });
  pdf.spacer(4);
  pdf.text("has successfully completed", { size: 11, align: "center" });
  pdf.spacer(4);
  pdf.text(input.course.title, { size: 15, bold: true, align: "center" });
  pdf.spacer(18);
  const pairs: [string, string][] = [
    ["Employee code", org?.code ?? "-"],
    ["Completed on", formatDate(input.completedOn)],
  ];
  if (input.course.durationMinutes) pairs.push(["Duration", `${Math.round((input.course.durationMinutes / 60) * 10) / 10} hours`]);
  if (input.score != null) pairs.push(["Assessment score", `${input.score}%`]);
  pairs.push(["Valid until", input.expiresOn ? formatDate(input.expiresOn) : "No expiry"]);
  if (input.course.provider) pairs.push(["Provider", input.course.provider]);
  pdf.grid(pairs, 2);
  if (input.course.skills.length) pdf.text(`Skills: ${input.course.skills.join(", ")}`, { size: 9.5 });
  return pdf.toBytes();
}

/**
 * Complete an enrollment: status, expiry, certificate PDF (employee-visible
 * document) and course skills on the employee profile (source "course",
 * proficiency 2, only if the skill is not already recorded).
 */
export async function completeEnrollment(tx: Tx, actor: { tenantId: string; userId: string | null }, e: EnrollmentRow, c: CourseRow, score: number | null) {
  const today = todayIn();
  const expiresOn = c.certificateValidityMonths ? addMonthsIso(today, c.certificateValidityMonths) : null;
  const bytes = await certificatePdf(tx, { tenantId: actor.tenantId, employeeId: e.employeeId, course: c, completedOn: today, expiresOn, score });
  const doc = await storeGeneratedPdf(tx, {
    tenantId: actor.tenantId,
    bytes,
    ownerType: "employee",
    ownerId: e.employeeId,
    employeeId: e.employeeId,
    category: "certificate",
    title: `Certificate: ${c.title}`,
    fileName: `certificate-${c.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}.pdf`,
    employeeVisible: true,
    createdBy: actor.userId,
  });
  if (expiresOn) await tx.update(documents).set({ expiresOn }).where(eq(documents.id, doc.id));
  await tx
    .update(learningEnrollments)
    .set({ status: "completed", completedAt: new Date(), progressPercent: 100, score: score ?? e.score, expiresOn, certificateDocumentId: doc.id })
    .where(eq(learningEnrollments.id, e.id));

  let skillsAdded = 0;
  for (const name of c.skills) {
    await tx.insert(skills).values({ tenantId: actor.tenantId, name }).onConflictDoNothing();
    const [skill] = await tx
      .select({ id: skills.id })
      .from(skills)
      .where(and(eq(skills.tenantId, actor.tenantId), sql`lower(${skills.name}) = lower(${name})`));
    if (!skill) continue;
    const added = await tx
      .insert(employeeSkills)
      .values({ tenantId: actor.tenantId, employeeId: e.employeeId, skillId: skill.id, proficiency: 2, source: "course" })
      .onConflictDoNothing()
      .returning({ skillId: employeeSkills.skillId });
    skillsAdded += added.length;
  }
  await audit(tx, actor, { action: "learning.completed", entityType: "learning_enrollment", entityId: e.id, metadata: { courseId: c.id, certificateDocumentId: doc.id, expiresOn, skillsAdded } });
  await emitDomainEvent(tx, actor.tenantId, "learning.course_completed", { employeeId: e.employeeId, courseId: c.id, enrollmentId: e.id }, { dedupeKey: `course-completed:${e.id}` });
  return { certificateDocumentId: doc.id, expiresOn, skillsAdded, progressPercent: 100 };
}

/* ------------------------------------------------------------------ */
/* Manager dashboard                                                    */
/* ------------------------------------------------------------------ */

export type TeamLearningSummary = {
  employees: { id: string; name: string; assigned: number; completed: number; overdue: number; completionPercent: number | null }[];
  overdue: { enrollmentId: string; employeeId: string; employeeName: string; course: string; dueOn: string }[];
  totals: { assigned: number; completed: number; overdue: number; completionPercent: number | null };
};

/** Team scope (reporting subtree), or the whole company for learning.manage. */
export async function teamLearning(ctx: RequestContext, scope: "team" | "all" = "team"): Promise<TeamLearningSummary> {
  if (scope === "all" && !can(ctx, "learning.manage", "all")) throw forbidden();
  const ids = scope === "team" ? await getTeamEmployeeIds(ctx) : null;
  const empty = { employees: [], overdue: [], totals: { assigned: 0, completed: 0, overdue: 0, completionPercent: null } };
  if (ids && !ids.length) return empty;
  const today = todayIn();
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ id: learningEnrollments.id, employeeId: learningEnrollments.employeeId, status: learningEnrollments.status, dueOn: learningEnrollments.dueOn, course: courses.title })
      .from(learningEnrollments)
      .innerJoin(courses, eq(courses.id, learningEnrollments.courseId))
      .where(and(ids ? inArray(learningEnrollments.employeeId, ids) : undefined, inArray(learningEnrollments.status, ["assigned", "in_progress", "completed", "expired"])))
      .limit(20000);
    const people = await employeeBasics(tx, ids ?? [...new Set(rows.map((r) => r.employeeId))]);
    const per = new Map<string, { assigned: number; completed: number; overdue: number }>();
    const overdue: TeamLearningSummary["overdue"] = [];
    for (const r of rows) {
      const p = per.get(r.employeeId) ?? { assigned: 0, completed: 0, overdue: 0 };
      p.assigned += 1;
      if (r.status === "completed") p.completed += 1;
      if (learningBucket(r.status, r.dueOn, today) === "overdue") {
        p.overdue += 1;
        overdue.push({ enrollmentId: r.id, employeeId: r.employeeId, employeeName: people.get(r.employeeId)?.name ?? "Unknown", course: r.course, dueOn: r.dueOn! });
      }
      per.set(r.employeeId, p);
    }
    const pct = (done: number, all: number) => (all ? Math.round((done / all) * 100) : null);
    const list = [...people.values()]
      .map((e) => {
        const p = per.get(e.id) ?? { assigned: 0, completed: 0, overdue: 0 };
        return { id: e.id, name: e.name, ...p, completionPercent: pct(p.completed, p.assigned) };
      })
      .filter((e) => ids || e.assigned > 0)
      .sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name));
    const totals = list.reduce((a, e) => ({ assigned: a.assigned + e.assigned, completed: a.completed + e.completed, overdue: a.overdue + e.overdue }), { assigned: 0, completed: 0, overdue: 0 });
    return { employees: list, overdue: overdue.sort((a, b) => a.dueOn.localeCompare(b.dueOn)), totals: { ...totals, completionPercent: pct(totals.completed, totals.assigned) } };
  });
}

/** In-app notification helper for new enrollments (system or user context). */
export async function notifyEnrolled(tx: Tx, tenantId: string, items: { enrollmentId: string; userId: string | null; title: string; dueOn: string | null }[]) {
  for (const i of items) {
    if (!i.userId) continue;
    await notify(tx, {
      tenantId,
      userIds: [i.userId],
      category: "learning",
      title: `New course assigned: ${i.title}`,
      body: i.dueOn ? `Please complete it by ${formatDate(i.dueOn)}.` : null,
      href: "/learning",
      dedupeKey: `learning-assigned:${i.enrollmentId}`,
    });
  }
}
