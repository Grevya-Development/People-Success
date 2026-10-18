import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { departments, legalEntities, oneOnOnes, successionPlans, surveyParticipants, surveyResponses, surveys } from "@/server/db/schema";
import { createEmployee } from "@/server/services/employees/mutations";
import { closeSurvey, getSurveyForResponse, launchSurvey, listSurveys, saveSurvey, submitSurveyResponse } from "@/server/services/talent/engagement/surveys";
import { surveyResults, textThemeSummary } from "@/server/services/talent/engagement/results";
import { giveRecognition, listRecognitions } from "@/server/services/talent/engagement/recognition";
import { listOneOnOnes, saveOneOnOne } from "@/server/services/talent/engagement/one-on-ones";
import { listSuccessionPlans, saveSuccessionPlan } from "@/server/services/talent/engagement/career";
import { peopleSuccessOverview } from "@/server/services/talent/engagement/overview";
import { createEmployeeSchema } from "@/lib/validation/employees";
import { oneOnOneSchema, recognitionSchema, successionPlanSchema, surveySchema } from "@/lib/validation/talent";
import { todayIn } from "@/lib/format";
import type { RequestContext } from "@/server/auth/context";
import type { AppError } from "@/server/lib/errors";
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

describe("engagement and people success", () => {
  let org: Awaited<ReturnType<typeof createOwnedTenant>>;
  let hr: RequestContext;
  let people: { id: string; ctx: RequestContext }[];
  let deptX: string;
  let deptY: string;
  let surveyId: string;

  beforeAll(async () => {
    org = await createOwnedTenant();
    hr = await contextFor(org.tenant.id, org.user.id);
    const [{ id: le }] = await db.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.tenantId, org.tenant.id));
    [{ id: deptX }] = await db.insert(departments).values({ tenantId: org.tenant.id, name: "Engineering" }).returning({ id: departments.id });
    [{ id: deptY }] = await db.insert(departments).values({ tenantId: org.tenant.id, name: "Legal" }).returning({ id: departments.id });
    people = [];
    const specs = [
      { name: "Lead", dept: deptX, mgr: false },
      { name: "Ira", dept: deptX, mgr: true },
      { name: "Jai", dept: deptX, mgr: true },
      { name: "Yash", dept: deptY, mgr: false },
    ];
    for (const s of specs) {
      const e = await createEmployee(
        hr,
        createEmployeeSchema.parse({
          firstName: s.name,
          legalEntityId: le,
          employmentType: "full_time",
          workerType: "employee",
          workMode: "onsite",
          joiningDate: "2023-06-01",
          probationMonths: 0,
          noticePeriodDays: 30,
          departmentId: s.dept,
          managerId: s.mgr ? people[0].id : null,
        }),
      );
      const m = await addMember(org.tenant.id, [s.name === "Lead" ? "people_manager" : "employee"], { employeeId: e.id });
      people.push({ id: e.id, ctx: await contextFor(org.tenant.id, m.user.id) });
    }
  });

  it("launches an anonymous survey and stores responses without identity", async () => {
    ({ id: surveyId } = await saveSurvey(
      hr,
      surveySchema.parse({
        title: "October pulse",
        kind: "pulse",
        isAnonymous: true,
        minGroupSize: 3,
        audienceAll: true,
        questions: [
          { id: "valued", label: "I feel valued", type: "scale", driver: "Recognition", required: true },
          { id: "enps", label: "Recommend us?", type: "enps", required: true },
          { id: "comment", label: "Anything else?", type: "text", required: false },
        ],
      }),
    ));
    await expectCode(saveSurvey(people[1].ctx, surveySchema.parse({ title: "x", questions: [{ id: "a", label: "a", type: "scale" }] })), "FORBIDDEN");
    const launched = await launchSurvey(hr, surveyId);
    expect(launched.participants).toBe(4);
    // Backdate the opening so a stored real response day would show up.
    await db.update(surveys).set({ opensOn: "2026-01-05" }).where(eq(surveys.id, surveyId));
    expect((await listSurveys(people[1].ctx)).map((s) => s.id)).toContain(surveyId);

    await submitSurveyResponse(people[1].ctx, { surveyId, answers: { valued: 4, enps: 9, comment: "Great team culture and growth" } });
    await expectCode(submitSurveyResponse(people[1].ctx, { surveyId, answers: { valued: 5, enps: 10 } }), "CONFLICT");
    await expectCode(submitSurveyResponse(people[2].ctx, { surveyId, answers: { valued: 9, enps: 9 } }), "VALIDATION");
    await submitSurveyResponse(people[2].ctx, { surveyId, answers: { valued: 5, enps: 10, comment: "Growth paths could be clearer" } });

    const rows = await db.select().from(surveyResponses).where(eq(surveyResponses.surveyId, surveyId));
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.employeeId).toBeNull();
      // Anonymous responses carry the survey's opening day, never the real response day.
      expect(r.submittedOn).toBe("2026-01-05");
      expect(r.departmentId).toBe(deptX);
      expect(r.tenureBand).toBe("3y+");
      expect(Object.keys(r)).not.toContain("participantId");
    }
    const participant = await db.select().from(surveyParticipants).where(eq(surveyParticipants.employeeId, people[1].id));
    expect(participant[0].respondedOn).toBe(todayIn());
    expect((await getSurveyForResponse(people[1].ctx, surveyId)).respondedOn).toBe(todayIn());
    // Respondents cannot read raw responses.
    const viaRls = await people[1].ctx.db((tx) => tx.select().from(surveyResponses).where(eq(surveyResponses.surveyId, surveyId)));
    expect(viaRls).toHaveLength(0);
    await expectCode(surveyResults(people[1].ctx, surveyId), "FORBIDDEN");
  });

  it("suppresses results below the minimum group size", async () => {
    const small = await surveyResults(hr, surveyId);
    expect(small.aggregate.suppressed).toBe(true);
    expect(small.aggregate.questions).toEqual([]);
    expect(small.aggregate.responseRate).toBe(0.5);
    await expectCode(textThemeSummary(hr, surveyId, "comment"), "VALIDATION");

    await submitSurveyResponse(people[0].ctx, { surveyId, answers: { valued: 3, enps: 6, comment: "More growth and learning budget" } });
    await submitSurveyResponse(people[3].ctx, { surveyId, answers: { valued: 2, enps: 3 } });
    const full = await surveyResults(hr, surveyId);
    expect(full.aggregate.suppressed).toBe(false);
    expect(full.aggregate.responseCount).toBe(4);
    expect(full.aggregate.enps?.score).toBe(0); // 2 promoters, 2 detractors
    const eng = full.breakdowns.department.find((g) => g.key === deptX)!;
    const legal = full.breakdowns.department.find((g) => g.key === deptY)!;
    expect(eng.suppressed).toBe(false);
    expect(legal).toEqual({ key: deptY, label: "Legal", suppressed: true });
    expect(JSON.stringify(full)).not.toContain("Growth paths could be clearer");

    const themes = await textThemeSummary(hr, surveyId, "comment");
    expect(themes.source).toBe("rules");
    expect(themes.answered).toBe(3);
    expect(themes.themes.find((t) => t.theme === "growth")?.mentions).toBe(3);
    await closeSurvey(hr, surveyId);
    await expectCode(submitSurveyResponse(people[3].ctx, { surveyId, answers: { valued: 2, enps: 3 } }), "INVALID_STATE");
  });

  it("keeps 1:1s private to the pair and posts recognitions", async () => {
    const [lead, ira, jai] = people;
    await saveOneOnOne(lead.ctx, oneOnOneSchema.parse({ withEmployeeId: ira.id, heldOn: todayIn(), agenda: "Career goals", notes: "Private note" }));
    await expectCode(saveOneOnOne(ira.ctx, oneOnOneSchema.parse({ withEmployeeId: jai.id, heldOn: todayIn() })), "FORBIDDEN");
    expect(await listOneOnOnes(ira.ctx)).toHaveLength(1);
    expect(await listOneOnOnes(jai.ctx)).toHaveLength(0);
    const hidden = await jai.ctx.db((tx) => tx.select().from(oneOnOnes));
    expect(hidden).toHaveLength(0);
    const hrView = await hr.db((tx) => tx.select().from(oneOnOnes));
    expect(hrView).toHaveLength(0);

    const overview = await peopleSuccessOverview(lead.ctx);
    expect(overview.reports).toBe(2);
    expect(overview.overdueOneOnOnes.map((o) => o.employeeId)).toEqual([jai.id]);
    expect(overview.departmentTrend.points[0]).toMatchObject({ suppressed: false });

    await giveRecognition(jai.ctx, recognitionSchema.parse({ toEmployeeId: ira.id, badge: "Team player", message: "Thanks for the on-call help!" }));
    await expectCode(giveRecognition(jai.ctx, recognitionSchema.parse({ toEmployeeId: jai.id, badge: "Team player", message: "Me me me" })), "VALIDATION");
    expect((await listRecognitions(people[3].ctx)).some((r) => r.message.includes("on-call"))).toBe(true);
  });

  it("restricts succession plans to succession.manage", async () => {
    await saveSuccessionPlan(hr, successionPlanSchema.parse({ roleTitle: "Head of Engineering", incumbentEmployeeId: people[0].id, criticality: "high", candidates: [{ employeeId: people[1].id, readiness: "1_2_years" }] }));
    expect(await listSuccessionPlans(hr)).toHaveLength(1);
    await expectCode(listSuccessionPlans(people[0].ctx), "FORBIDDEN");
    const viaRls = await people[0].ctx.db((tx) => tx.select().from(successionPlans));
    expect(viaRls).toHaveLength(0);
  });

  it("isolates tenants", async () => {
    const other = await createOwnedTenant();
    const otherHr = await contextFor(other.tenant.id, other.user.id);
    await expectCode(surveyResults(otherHr, surveyId), "NOT_FOUND");
    expect(await listSurveys(otherHr)).toEqual([]);
    expect((await listRecognitions(otherHr)).length).toBe(0);
  });
});
