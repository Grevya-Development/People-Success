import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { withSystem } from "@/server/db/tx";
import { departments, documents, employeeSkills, jobs, learningEnrollments, legalEntities, skills } from "@/server/db/schema";
import { runJobsOnce } from "@/server/jobs/runner";
import "@/server/jobs/handlers";
import { createEmployee } from "@/server/services/employees/mutations";
import { getCourse, listCatalog, saveCourse } from "@/server/services/talent/learning/courses";
import { createAssignment, runAssignments, sendLearningReminders } from "@/server/services/talent/learning/assignments";
import { enrollSelf, listMyLearning, submitQuiz, teamLearning, updateProgress } from "@/server/services/talent/learning/enrollments";
import { createEmployeeSchema } from "@/lib/validation/employees";
import { courseSchema, learningAssignmentSchema } from "@/lib/validation/talent";
import { todayIn } from "@/lib/format";
import type { RequestContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { addMember, contextFor, createOwnedTenant } from "../helpers/fixtures";

async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (err) {
    expect((err as AppError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

async function drain() {
  for (let i = 0; i < 40; i++) {
    await db.update(jobs).set({ runAt: new Date(Date.now() - 60_000) }).where(eq(jobs.status, "queued"));
    if (!(await runJobsOnce({ workerId: "learning-test", limit: 100 }))) break;
  }
}

describe("learning", () => {
  let org: Awaited<ReturnType<typeof createOwnedTenant>>;
  let hr: RequestContext;
  let le: string;
  let dept: string;
  let mgr: { id: string; ctx: RequestContext };
  let emp: { id: string; ctx: RequestContext };
  let courseId: string;

  const make = async (firstName: string, opts: { managerId?: string | null; departmentId?: string | null; joiningDate?: string } = {}) =>
    (
      await createEmployee(
        hr,
        createEmployeeSchema.parse({
          firstName,
          legalEntityId: le,
          employmentType: "full_time",
          workerType: "employee",
          workMode: "onsite",
          joiningDate: opts.joiningDate ?? "2025-01-10",
          probationMonths: 0,
          noticePeriodDays: 30,
          managerId: opts.managerId ?? null,
          departmentId: opts.departmentId ?? null,
        }),
      )
    ).id;

  beforeAll(async () => {
    org = await createOwnedTenant();
    hr = await contextFor(org.tenant.id, org.user.id);
    [{ id: le }] = await db.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.tenantId, org.tenant.id));
    [{ id: dept }] = await db.insert(departments).values({ tenantId: org.tenant.id, name: "Finance" }).returning({ id: departments.id });
    const mId = await make("Kavya", { departmentId: dept });
    const eId = await make("Rohan", { managerId: mId, departmentId: dept });
    await make("Sana", { departmentId: null });
    const m = await addMember(org.tenant.id, ["people_manager"], { employeeId: mId });
    const e = await addMember(org.tenant.id, ["employee"], { employeeId: eId });
    mgr = { id: mId, ctx: await contextFor(org.tenant.id, m.user.id) };
    emp = { id: eId, ctx: await contextFor(org.tenant.id, e.user.id) };
    ({ id: courseId } = await saveCourse(
      hr,
      courseSchema.parse({
        title: "POSH awareness",
        format: "link",
        url: "https://learning.example.com/posh",
        durationMinutes: 45,
        skills: ["Workplace conduct"],
        isMandatory: true,
        certificateValidityMonths: 12,
        quiz: {
          passMark: 70,
          questions: [
            { id: "q1", prompt: "Who should you report to?", options: ["ICC", "Nobody"], answer: 0 },
            { id: "q2", prompt: "Is retaliation allowed?", options: ["Yes", "No"], answer: 1 },
            { id: "q3", prompt: "Training is yearly?", options: ["Yes", "No"], answer: 0 },
          ],
        },
      }),
    ));
  });

  it("hides the answer key from learners and restricts management", async () => {
    const view = await getCourse(emp.ctx, courseId);
    expect(JSON.stringify(view.course.quiz)).not.toContain("answer");
    await expectCode(saveCourse(emp.ctx, courseSchema.parse({ title: "Hack", url: "https://x.example.com" })), "FORBIDDEN");
    expect((await listCatalog(emp.ctx)).some((c) => c.id === courseId)).toBe(true);
  });

  it("creates enrollments from rules idempotently", async () => {
    await createAssignment(hr, learningAssignmentSchema.parse({ courseId, departmentIds: [dept], dueInDays: 14 }));
    await drain();
    const first = await db.select().from(learningEnrollments).where(eq(learningEnrollments.courseId, courseId));
    expect(first).toHaveLength(2); // Kavya and Rohan (Finance), not Sana
    const again = await withSystem((tx) => runAssignments(tx, org.tenant.id), org.tenant.id);
    expect(again.created).toBe(0);
    await enrollSelf(emp.ctx, courseId); // already enrolled: no duplicate
    const after = await db.select().from(learningEnrollments).where(eq(learningEnrollments.courseId, courseId));
    expect(after).toHaveLength(2);
    const mine = await listMyLearning(emp.ctx);
    expect(mine).toHaveLength(1);
    expect(mine[0].dueOn).toBeTruthy();
  });

  it("scores quizzes server-side, completes on pass and stores a certificate", async () => {
    const [mine] = await listMyLearning(emp.ctx);
    const p = await updateProgress(emp.ctx, { enrollmentId: mine.id, progressPercent: 100 });
    expect(p.status).toBe("in_progress"); // quiz still required
    const fail = await submitQuiz(emp.ctx, { enrollmentId: mine.id, answers: { q1: 1, q2: 1, q3: 1 } });
    expect(fail).toMatchObject({ passed: false, score: 33, attempts: 1 });
    const pass = await submitQuiz(emp.ctx, { enrollmentId: mine.id, answers: { q1: 0, q2: 1, q3: 0 } });
    expect(pass).toMatchObject({ passed: true, score: 100, attempts: 2 });
    expect(pass.certificateDocumentId).toBeTruthy();
    const [doc] = await db.select().from(documents).where(eq(documents.id, pass.certificateDocumentId!));
    expect(doc).toMatchObject({ ownerType: "employee", employeeId: emp.id, category: "certificate", employeeVisible: true, bucket: "generated" });
    const [enr] = await db.select().from(learningEnrollments).where(eq(learningEnrollments.id, mine.id));
    expect(enr.status).toBe("completed");
    expect(enr.expiresOn).toBeTruthy();
    const skill = await db
      .select({ source: employeeSkills.source, proficiency: employeeSkills.proficiency })
      .from(employeeSkills)
      .innerJoin(skills, eq(skills.id, employeeSkills.skillId))
      .where(and(eq(employeeSkills.employeeId, emp.id), eq(skills.name, "Workplace conduct")));
    expect(skill).toEqual([{ source: "course", proficiency: 2 }]);
    // Another employee cannot touch my enrollment.
    await expectCode(submitQuiz(mgr.ctx, { enrollmentId: mine.id, answers: {} }), "NOT_FOUND");
  });

  it("shows team completion to the manager and reminds overdue learners once a day", async () => {
    const team = await teamLearning(mgr.ctx);
    expect(team.employees.find((e) => e.id === emp.id)?.completionPercent).toBe(100);
    await db.update(learningEnrollments).set({ dueOn: "2020-01-01" }).where(and(eq(learningEnrollments.employeeId, mgr.id), eq(learningEnrollments.courseId, courseId)));
    const sent = await withSystem((tx) => sendLearningReminders(tx, org.tenant.id), org.tenant.id);
    expect(sent).toBeGreaterThanOrEqual(1);
    await expectCode(teamLearning(emp.ctx, "all"), "FORBIDDEN");
  });

  it("expires certificates and re-enrolls through the assignment job", async () => {
    await db.update(learningEnrollments).set({ expiresOn: "2020-01-01" }).where(and(eq(learningEnrollments.employeeId, emp.id), eq(learningEnrollments.status, "completed")));
    const r = await withSystem((tx) => runAssignments(tx, org.tenant.id, { today: todayIn() }), org.tenant.id);
    expect(r.created).toBe(1);
    const rows = await db.select().from(learningEnrollments).where(and(eq(learningEnrollments.employeeId, emp.id), eq(learningEnrollments.courseId, courseId)));
    expect(rows.map((x) => x.status).sort()).toEqual(["assigned", "expired"]);
  });

  it("enrolls new joiners from the employee event", async () => {
    await createAssignment(hr, learningAssignmentSchema.parse({ courseId, newJoiners: true, dueInDays: 7 }));
    await drain();
    const joiner = await make("Tara", { joiningDate: todayIn() });
    await drain();
    const rows = await db.select().from(learningEnrollments).where(eq(learningEnrollments.employeeId, joiner));
    expect(rows).toHaveLength(1);
  });

  it("isolates tenants", async () => {
    const other = await createOwnedTenant();
    const otherHr = await contextFor(other.tenant.id, other.user.id);
    await expectCode(getCourse(otherHr, courseId), "NOT_FOUND");
    expect((await listCatalog(otherHr)).some((c) => c.id === courseId)).toBe(false);
  });
});
