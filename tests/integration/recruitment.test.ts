import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { db } from "@/server/db/client";
import {
  applications,
  approvalRequests,
  candidates,
  compensationRecords,
  departments,
  documents,
  employees,
  employmentRecords,
  interviewFeedback,
  interviews,
  jobOpenings,
  jobRequisitions,
  jobs,
  legalEntities,
  offers,
  payrollInputs,
  payrollPeriods,
  recruitmentStages,
  referrals,
  tenants,
} from "@/server/db/schema";
import { withSystem } from "@/server/db/tx";
import type { RequestContext } from "@/server/auth/context";
import { decide } from "@/server/services/inbox";
import { createEmployee } from "@/server/services/employees/mutations";
import { createEmployeeSchema } from "@/lib/validation/employees";
import { openingSchema, publicApplicationSchema, requisitionSchema } from "@/lib/validation/recruitment";
import { createRequisition, getRequisition } from "@/server/services/recruitment/requisitions";
import { createOpening, transitionOpening } from "@/server/services/recruitment/openings";
import { getCareerSite, getPublicJob, submitPublicApplication } from "@/server/services/recruitment/careers";
import { getBoard, moveApplicationStage } from "@/server/services/recruitment/applications";
import { getCandidate, createManualCandidate, listCandidates } from "@/server/services/recruitment/candidates";
import { getInterview, scheduleInterview, submitFeedback, InterviewConflictError } from "@/server/services/recruitment/interviews";
import { createOffer, expireOffers, getOffer, reviseOffer, sendOffer, submitOffer } from "@/server/services/recruitment/offers";
import { getOfferByToken, respondToOffer } from "@/server/services/recruitment/offer-response";
import { decideReward, evaluateReferralRewards, postApprovedRewards, saveRewardPolicy, submitReferral, myReferrals } from "@/server/services/recruitment/referrals";
import { summarizeApplication } from "@/server/services/recruitment/ai";
import { recruitmentAnalytics } from "@/server/services/recruitment/analytics";
import { todayIn } from "@/lib/format";
import "@/server/services/approvals/handlers";
import { addMember, contextFor, createOwnedTenant, uniqueEmail } from "../helpers/fixtures";

const plusDays = (n: number) => {
  const d = new Date(`${todayIn()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function resumePdf(lines: string[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  lines.forEach((l, i) => page.drawText(l, { x: 50, y: 760 - i * 18, size: 11, font }));
  return new File([(await doc.save()) as BlobPart], "resume.pdf", { type: "application/pdf" });
}

async function pendingRequest(subjectType: string, subjectId: string) {
  const [r] = await db
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.subjectType, subjectType), eq(approvalRequests.subjectId, subjectId), eq(approvalRequests.status, "pending")));
  return r;
}

describe("recruitment: requisition to hire", () => {
  let org: Awaited<ReturnType<typeof createOwnedTenant>>;
  let tenantSlug: string;
  let le: string;
  let owner: RequestContext;
  let recruiter: RequestContext;
  let deptHead: RequestContext;
  let finance: RequestContext;
  let hrAdmin: RequestContext;
  let int1: RequestContext;
  let int2: RequestContext;
  let referrer: RequestContext;
  let hiringManagerEmp: string;
  let requisitionId: string;
  let openingId: string;
  let jobSlug: string;
  let applicationId: string;
  let candidateId: string;
  let offerId: string;
  let token: string;
  const applicantEmail = uniqueEmail("applicant");

  const stageId = async (kind: string) => {
    const [s] = await db.select().from(recruitmentStages).where(and(eq(recruitmentStages.tenantId, org.tenant.id), sql`${recruitmentStages.kind} = ${kind}`));
    return s.id;
  };

  beforeAll(async () => {
    org = await createOwnedTenant();
    [{ slug: tenantSlug }] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, org.tenant.id));
    [{ id: le }] = await db.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.tenantId, org.tenant.id));
    owner = await contextFor(org.tenant.id, org.user.id);
    const mk = (firstName: string, departmentId: string | null = null) =>
      createEmployee(
        owner,
        createEmployeeSchema.parse({
          firstName,
          legalEntityId: le,
          employmentType: "full_time",
          workerType: "employee",
          workMode: "onsite",
          joiningDate: "2024-04-01",
          probationMonths: 0,
          noticePeriodDays: 30,
          departmentId,
        }),
      );
    const head = await mk("Dina");
    const [dep] = await db.insert(departments).values({ tenantId: org.tenant.id, name: "Engineering", headEmployeeId: head.id }).returning();
    await db.update(employees).set({ departmentId: dep.id }).where(eq(employees.id, head.id));
    const hm = await mk("Harish", dep.id);
    hiringManagerEmp = hm.id;
    const headUser = await addMember(org.tenant.id, ["department_head"], { employeeId: head.id });
    const hmUser = await addMember(org.tenant.id, ["hiring_manager"], { employeeId: hm.id });
    deptHead = await contextFor(org.tenant.id, headUser.user.id);
    referrer = await contextFor(org.tenant.id, hmUser.user.id);
    finance = await contextFor(org.tenant.id, (await addMember(org.tenant.id, ["finance_manager"])).user.id);
    hrAdmin = await contextFor(org.tenant.id, (await addMember(org.tenant.id, ["hr_admin"])).user.id);
    recruiter = await contextFor(org.tenant.id, (await addMember(org.tenant.id, ["recruiter"])).user.id);
    int1 = await contextFor(org.tenant.id, (await addMember(org.tenant.id, ["interviewer"])).user.id);
    int2 = await contextFor(org.tenant.id, (await addMember(org.tenant.id, ["interviewer"])).user.id);
  });

  it("raises a requisition and approves it in two steps by different approvers", async () => {
    const req = await createRequisition(
      recruiter,
      requisitionSchema.parse({
        title: "Backend Engineer",
        departmentId: (await db.select().from(departments).where(eq(departments.tenantId, org.tenant.id)))[0].id,
        headcount: 2,
        employmentType: "full_time",
        reason: "new",
        justification: "Platform team needs two more backend engineers for the payments roadmap.",
        hiringManagerEmployeeId: hiringManagerEmp,
        budgetMaxAnnual: 2_400_000,
      }),
      { submit: true },
    );
    requisitionId = req.id;
    expect(req.code).toMatch(/^REQ-\d{4}$/);
    const [row] = await db.select().from(jobRequisitions).where(eq(jobRequisitions.id, req.id));
    expect(row.status).toBe("pending_approval");
    // Recruiters cannot see compensation budgets, so none was stored from their form.
    expect(row.budgetMaxAnnual).toBeNull();
    expect((await getRequisition(recruiter, req.id)).budget).toBeNull();

    const r1 = await pendingRequest("job_requisition", req.id);
    // Finance is step 2: they cannot decide step 1.
    await expect(decide(finance, { requestId: r1.id, decision: "approve" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await decide(deptHead, { requestId: r1.id, decision: "approve" });
    expect((await db.select().from(jobRequisitions).where(eq(jobRequisitions.id, req.id)))[0].status).toBe("pending_approval");
    await decide(finance, { requestId: r1.id, decision: "approve" });
    const [approved] = await db.select().from(jobRequisitions).where(eq(jobRequisitions.id, req.id));
    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).not.toBeNull();
  });

  it("opens and publishes a job from the approved requisition", async () => {
    const o = await createOpening(
      recruiter,
      openingSchema.parse({
        requisitionId,
        title: "Backend Engineer",
        description: "Build and run the services behind our payroll and payments products.",
        requirements: "- Design REST APIs\n- Operate PostgreSQL in production",
        skills: "TypeScript, Node.js, PostgreSQL, Kubernetes",
        experienceMinYears: 3,
        experienceMaxYears: 8,
        workMode: "hybrid",
        employmentType: "full_time",
        salaryMinAnnual: 1_800_000,
        salaryMaxAnnual: 2_400_000,
        showSalary: false,
        openings: 2,
        questions: [{ id: "notice", label: "What is your notice period in days?", type: "number", required: true }],
      }),
    );
    openingId = o.id;
    jobSlug = o.slug;
    expect(await getPublicJob(tenantSlug, jobSlug)).toBeNull(); // draft is not public
    await transitionOpening(recruiter, o.id, "published");
    const site = await getCareerSite(tenantSlug);
    expect(site?.jobs.map((j) => j.slug)).toContain(jobSlug);
    const job = site!.jobs.find((j) => j.slug === jobSlug)!;
    expect(job.salary).toBeNull(); // showSalary false
    expect(Object.keys(job)).not.toContain("recruiterUserId");
  });

  it("accepts a public application, blocks the duplicate and ignores bots", async () => {
    const input = publicApplicationSchema.parse({
      tenantSlug,
      jobSlug,
      firstName: "Asha",
      lastName: "Verma",
      email: applicantEmail.toUpperCase(),
      phone: "+91 98450 12345",
      experienceYears: 6,
      answers: { notice: "30" },
      consent: true,
    });
    const file = await resumePdf([
      "Asha Verma - Senior Backend Engineer",
      "Date of Birth: 01/01/1990   Gender: Female",
      "6 years of backend experience with TypeScript and Node.js services.",
      "Ran PostgreSQL clusters in production; designed REST APIs.",
    ]);
    const receipt = await submitPublicApplication(input, file, { ip: "203.0.113.7" });
    expect(receipt.stored).toBe(true);
    applicationId = receipt.applicationId!;
    const [app] = await db.select().from(applications).where(eq(applications.id, applicationId));
    candidateId = app.candidateId;
    expect(app.stageId).toBe(await stageId("applied"));
    expect(app.answers).toEqual({ notice: "30" });
    const [cand] = await db.select().from(candidates).where(eq(candidates.id, candidateId));
    expect(cand.email).toBe(applicantEmail);
    expect(cand.consentAt).not.toBeNull();
    const [resume] = await db.select().from(documents).where(eq(documents.id, cand.resumeDocumentId!));
    expect(resume).toMatchObject({ ownerType: "candidate", ownerId: candidateId, isSensitive: true, employeeVisible: false, category: "resume" });

    await expect(submitPublicApplication(input, await resumePdf(["again"]), { ip: "203.0.113.7" })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("already applied") });
    const bot = await submitPublicApplication({ ...input, email: uniqueEmail("bot"), website: "http://spam.example" }, file, { ip: "203.0.113.8" });
    expect(bot.stored).toBe(false);
    const apps = await db.select().from(applications).where(eq(applications.openingId, openingId));
    expect(apps).toHaveLength(1);
  });

  it("rejects non-resume uploads by content", async () => {
    const fake = new File([new TextEncoder().encode("MZ this is not a pdf") as BlobPart], "resume.pdf", { type: "application/pdf" });
    await expect(
      submitPublicApplication(
        publicApplicationSchema.parse({ tenantSlug, jobSlug, firstName: "X", email: uniqueEmail("x"), answers: { notice: "1" }, consent: true }),
        fake,
        { ip: "203.0.113.9" },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("moves the candidate through stages and records events", async () => {
    for (const kind of ["screening", "review", "assessment", "interview"]) {
      await moveApplicationStage(recruiter, { applicationId, stageId: await stageId(kind), note: null });
    }
    await expect(moveApplicationStage(recruiter, { applicationId, stageId: await stageId("hired"), note: null })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(moveApplicationStage(int1, { applicationId, stageId: await stageId("final"), note: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const board = await getBoard(recruiter, openingId);
    expect(board.cards.find((c) => c.applicationId === applicationId)?.stageId).toBe(await stageId("interview"));
    const events = await db.execute<{ n: number }>(sql`select count(*)::int as n from application_events where application_id = ${applicationId} and type = 'stage_changed'`);
    expect(Number([...events][0].n)).toBe(4);
    const stageEvents = await db.select().from(jobs).where(and(eq(jobs.tenantId, org.tenant.id), sql`${jobs.payload}->>'event' = 'candidate.stage_changed'`));
    expect(stageEvents.length).toBeGreaterThanOrEqual(4);
  });

  it("produces a rule-based job match without AI, ignoring protected details", async () => {
    const r = await summarizeApplication(recruiter, applicationId, null);
    expect(r.source).toBe("rules");
    expect(r.summary.model).toBe("rule-based");
    const ts = r.summary.criteria.find((c) => c.criterion === "Skill: TypeScript");
    expect(ts?.assessment).toBe("meets");
    expect(ts?.evidence).toMatch(/TypeScript/);
    expect(r.summary.criteria.find((c) => c.criterion === "Skill: Kubernetes")?.assessment).toBe("not_evident");
    expect(JSON.stringify(r.summary)).not.toMatch(/Female|1990/);
  });

  it("schedules an interview, warns on panel clashes, and keeps feedback independent", async () => {
    const start = new Date(Date.now() + 2 * 24 * 3600_000);
    const local = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(start).replace(" ", "T");
    const iv = await scheduleInterview(recruiter, {
      applicationId,
      roundName: "Technical",
      mode: "video",
      start: local,
      durationMinutes: 60,
      location: null,
      meetingUrl: "https://meet.example.com/abc",
      panelUserIds: [int1.userId, int2.userId],
      scorecardTemplateId: null,
      notifyCandidate: true,
    });
    await expect(
      scheduleInterview(recruiter, { applicationId, roundName: "Clash", mode: "phone", start: local, durationMinutes: 30, location: null, meetingUrl: null, panelUserIds: [int1.userId], scorecardTemplateId: null, notifyCandidate: false }),
    ).rejects.toBeInstanceOf(InterviewConflictError);

    // The interview happened: move it into the past so feedback opens.
    await db.update(interviews).set({ scheduledStart: new Date(Date.now() - 2 * 3600_000), scheduledEnd: new Date(Date.now() - 3600_000) }).where(eq(interviews.id, iv.id));

    const before = await getInterview(int1, iv.id);
    expect(before.othersFeedback).toBeNull();
    await submitFeedback(int1, { interviewId: iv.id, recommendation: "yes", overallRating: 4, scores: [{ key: "role_skills", rating: 4, notes: null }], strengths: "Solid API design", concerns: null });

    // int2 has not submitted: hidden in the service, and RLS returns only their own rows.
    const hidden = await getInterview(int2, iv.id);
    expect(hidden.othersFeedback).toBeNull();
    expect(hidden.othersHiddenReason).toMatch(/Submit your feedback/);
    const visibleToInt2 = await int2.db((tx) => tx.select().from(interviewFeedback).where(eq(interviewFeedback.interviewId, iv.id)));
    expect(visibleToInt2).toHaveLength(0);
    // Not on the panel: cannot submit.
    await expect(submitFeedback(hrAdmin, { interviewId: iv.id, recommendation: "no", overallRating: 2, scores: [], strengths: null, concerns: null })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await submitFeedback(int2, { interviewId: iv.id, recommendation: "strong_yes", overallRating: 5, scores: [], strengths: null, concerns: null });
    const after = await getInterview(int2, iv.id);
    expect(after.othersFeedback?.map((f) => f.overallRating)).toEqual([4]);
    const [app] = await db.select().from(applications).where(eq(applications.id, applicationId));
    expect(app.averageRating).toBe(4.5);
    const [done] = await db.select().from(interviews).where(eq(interviews.id, iv.id));
    expect(done.status).toBe("completed");
  });

  it("creates an offer, approves it in two steps and generates the letter", async () => {
    await moveApplicationStage(recruiter, { applicationId, stageId: await stageId("final"), note: null });
    await expect(
      createOffer(recruiter, { applicationId, legalEntityId: le, designationId: null, departmentId: null, locationId: null, reportingManagerId: hiringManagerEmp, employmentType: "full_time", joiningDate: plusDays(0), annualCtc: 2_000_000, probationMonths: 6, noticePeriodDays: 60, expiresOn: plusDays(7) }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" }); // not at the Offer stage yet
    await moveApplicationStage(recruiter, { applicationId, stageId: await stageId("offer"), note: null });
    const created = await createOffer(recruiter, {
      applicationId,
      legalEntityId: le,
      designationId: null,
      departmentId: null,
      locationId: null,
      reportingManagerId: hiringManagerEmp,
      employmentType: "full_time",
      joiningDate: plusDays(0),
      annualCtc: 2_000_000,
      probationMonths: 6,
      noticePeriodDays: 60,
      expiresOn: plusDays(7),
    });
    offerId = created.id;
    const [draft] = await db.select().from(offers).where(eq(offers.id, offerId));
    expect(draft.annualCtc).toBe(200_000_000);
    expect(draft.components.map((c) => c.code)).toEqual(["BASIC", "HRA", "SPECIAL"]);
    expect(draft.components.reduce((s, c) => s + c.annualAmount, 0)).toBe(200_000_000);

    await submitOffer(recruiter, offerId);
    const req = await pendingRequest("offer", offerId);
    await decide(hrAdmin, { requestId: req.id, decision: "approve" });
    await decide(finance, { requestId: req.id, decision: "approve" });
    const detail = await getOffer(recruiter, offerId);
    expect(detail.status).toBe("approved");
    expect(detail.document).not.toBeNull();
    const [doc] = await db.select().from(documents).where(eq(documents.id, detail.document!.id));
    expect(doc).toMatchObject({ ownerType: "offer", ownerId: offerId, category: "offer_letter", bucket: "generated", isSensitive: true, employeeVisible: false });
    expect(doc.sizeBytes).toBeGreaterThan(1000);
    expect(detail.esign.configured).toBe(false);
  });

  it("sends the offer; the candidate accepts once even when clicking twice", async () => {
    const sent = await sendOffer(recruiter, offerId);
    token = sent.token;
    const view = await getOfferByToken(token);
    expect(view.state).toBe("open");
    expect(view.offer?.annualCtc).toBe(200_000_000);
    expect((await getOfferByToken("x".repeat(43))).state).toBe("invalid");

    const [a, b] = await Promise.all([
      respondToOffer(token, "accept", "Looking forward!", { ip: "198.51.100.4" }),
      respondToOffer(token, "accept", null, { ip: "198.51.100.4" }),
    ]);
    expect(a.employeeId).toBeTruthy();
    expect(a.employeeId).toBe(b.employeeId);
    expect([a.alreadyResponded, b.alreadyResponded].sort()).toEqual([false, true]);

    const emps = await db.select().from(employees).where(and(eq(employees.tenantId, org.tenant.id), eq(employees.personalEmail, applicantEmail)));
    expect(emps).toHaveLength(1);
    const emp = emps[0];
    expect(emp).toMatchObject({ firstName: "Asha", lastName: "Verma", legalEntityId: le, managerId: hiringManagerEmp, noticePeriodDays: 60, workMode: "hybrid", status: "active" });
    const comp = await db.select().from(compensationRecords).where(eq(compensationRecords.employeeId, emp.id));
    expect(comp).toHaveLength(1);
    expect(comp[0].annualCtc).toBe(200_000_000);
    expect(comp[0].components).toHaveLength(3);
    const hire = await db.select().from(employmentRecords).where(eq(employmentRecords.employeeId, emp.id));
    expect(hire.map((h) => h.changeType)).toEqual(["hire"]);

    const [offer] = await db.select().from(offers).where(eq(offers.id, offerId));
    expect(offer).toMatchObject({ status: "accepted", employeeId: emp.id, responseIp: "198.51.100.4", esignProvider: null, esignStatus: null });
    const [cand] = await db.select().from(candidates).where(eq(candidates.id, candidateId));
    expect(cand.employeeId).toBe(emp.id);
    const [app] = await db.select().from(applications).where(eq(applications.id, applicationId));
    expect(app.status).toBe("hired");
    expect(app.stageId).toBe(await stageId("hired"));

    const evts = await db.select().from(jobs).where(and(eq(jobs.tenantId, org.tenant.id), sql`${jobs.payload}->>'event' = 'offer.accepted'`));
    expect(evts).toHaveLength(1);
    expect(evts[0].payload).toMatchObject({ offerId, employeeId: emp.id, candidateName: "Asha Verma", joiningDate: plusDays(0) });

    // Headcount 2: the opening and requisition stay open after the first hire.
    expect((await db.select().from(jobOpenings).where(eq(jobOpenings.id, openingId)))[0].status).toBe("published");
    expect((await db.select().from(jobRequisitions).where(eq(jobRequisitions.id, requisitionId)))[0].status).toBe("approved");
    expect((await getOfferByToken(token)).state).toBe("accepted");
    await expect(respondToOffer(token, "decline", null, { ip: null })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("handles a referral through hire, reward eligibility and a single payroll payout", async () => {
    await saveRewardPolicy(hrAdmin, { id: null, name: "Standard referral bonus", amount: 25_000, eligibleAfterDays: 0, isActive: true });

    // Referring someone who already applied is a polite duplicate.
    const dup = await submitReferral(referrer, { openingId, firstName: "Asha", lastName: "Verma", email: applicantEmail, phone: null, linkedinUrl: null, relationship: "former_colleague", note: null, consentConfirmed: true }, null);
    expect(dup.status).toBe("duplicate");
    expect(dup.message).not.toMatch(/Asha|hired|stage/i);

    const refEmail = uniqueEmail("referred");
    const ref = await submitReferral(referrer, { openingId, firstName: "Ravi", lastName: "Kumar", email: refEmail, phone: null, linkedinUrl: null, relationship: "former_colleague", note: "Great engineer", consentConfirmed: true }, null);
    expect(ref.status).toBe("submitted");
    const [refRow] = await db.select().from(referrals).where(eq(referrals.id, ref.referralId));
    const appId = refRow.applicationId!;
    const [refApp] = await db.select().from(applications).where(eq(applications.id, appId));
    expect(refApp).toMatchObject({ source: "referral", referralId: ref.referralId });

    for (const kind of ["screening", "interview", "offer"]) await moveApplicationStage(recruiter, { applicationId: appId, stageId: await stageId(kind), note: null });
    expect((await db.select().from(referrals).where(eq(referrals.id, ref.referralId)))[0].status).toBe("interviewing");
    const o = await createOffer(recruiter, { applicationId: appId, legalEntityId: le, designationId: null, departmentId: null, locationId: null, reportingManagerId: null, employmentType: "full_time", joiningDate: plusDays(0), annualCtc: 1_500_000, probationMonths: 0, noticePeriodDays: 30, expiresOn: plusDays(5) });
    await submitOffer(recruiter, o.id);
    const req = await pendingRequest("offer", o.id);
    await decide(hrAdmin, { requestId: req.id, decision: "approve" });
    await decide(finance, { requestId: req.id, decision: "approve" });
    const { token: t2 } = await sendOffer(recruiter, o.id);
    const acc = await respondToOffer(t2, "accept", null, { ip: null });
    expect(acc.state).toBe("accepted");

    const [r1] = await db.select().from(referrals).where(eq(referrals.id, ref.referralId));
    expect(r1).toMatchObject({ status: "hired", rewardStatus: "pending", rewardAmount: 2_500_000, rewardEligibleOn: plusDays(0) });
    // Second hire fills headcount 2: opening closed, requisition filled.
    expect((await db.select().from(jobOpenings).where(eq(jobOpenings.id, openingId)))[0].status).toBe("closed");
    expect((await db.select().from(jobRequisitions).where(eq(jobRequisitions.id, requisitionId)))[0].status).toBe("filled");

    expect(await withSystem((tx) => evaluateReferralRewards(tx, org.tenant.id, todayIn()), org.tenant.id)).toMatchObject({ eligible: 1 });
    expect((await db.select().from(referrals).where(eq(referrals.id, ref.referralId)))[0].rewardStatus).toBe("eligible");

    // No open payroll period yet: approved and waiting.
    const approve = await decideReward(hrAdmin, ref.referralId, "approve");
    expect(approve).toEqual({ status: "approved", awaitingPeriod: true });
    const [{ legalEntityId: refLe }] = await db.select({ legalEntityId: employees.legalEntityId }).from(employees).where(eq(employees.id, hiringManagerEmp));
    const today = todayIn();
    await db.insert(payrollPeriods).values({ tenantId: org.tenant.id, legalEntityId: refLe, year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)), startDate: `${today.slice(0, 7)}-01`, endDate: `${today.slice(0, 7)}-28`, payDate: `${today.slice(0, 7)}-28`, inputCutoffDate: `${today.slice(0, 7)}-25`, status: "open" });
    expect(await withSystem((tx) => postApprovedRewards(tx, org.tenant.id), org.tenant.id)).toBe(1);
    expect(await withSystem((tx) => postApprovedRewards(tx, org.tenant.id), org.tenant.id)).toBe(0);
    await expect(decideReward(hrAdmin, ref.referralId, "post_to_payroll")).rejects.toMatchObject({ code: "INVALID_STATE" });
    const inputs = await db.select().from(payrollInputs).where(and(eq(payrollInputs.sourceType, "referral_reward"), eq(payrollInputs.sourceId, ref.referralId)));
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ employeeId: hiringManagerEmp, amount: 2_500_000, kind: "referral_reward" });
    const mine = await myReferrals(referrer);
    expect(mine.find((m) => m.id === ref.referralId)?.rewardStatus).toBe("paid");
    expect(mine.find((m) => m.id === dup.referralId)?.status).toBe("duplicate");

    const analytics = await recruitmentAnalytics(recruiter, { openingId });
    expect(analytics.timeToHire.hires).toBe(2);
    expect(analytics.offers?.accepted).toBe(2);
    expect(analytics.funnel[0].reached).toBe(2);
  });

  it("expires offer links and revises sent offers into a new version", async () => {
    const o2 = await createOpening(recruiter, openingSchema.parse({ title: "QA Engineer", description: "Own test automation for our web products end to end.", skills: "Playwright", workMode: "remote", employmentType: "full_time", showSalary: false, openings: 1, questions: [] }));
    await transitionOpening(recruiter, o2.id, "published");
    const c = await createManualCandidate(recruiter, { firstName: "Meera", lastName: null, email: uniqueEmail("meera"), phone: null, currentCompany: null, currentTitle: null, experienceYears: 4, linkedinUrl: null, source: "sourced", sourceDetail: null, openingId: o2.id, consentConfirmed: true });
    await moveApplicationStage(recruiter, { applicationId: c.applicationId!, stageId: await stageId("offer"), note: null });
    const base = { legalEntityId: le, designationId: null, departmentId: null, locationId: null, reportingManagerId: null, employmentType: "full_time" as const, joiningDate: plusDays(10), annualCtc: 900_000, probationMonths: 3, noticePeriodDays: 30, expiresOn: plusDays(3) };
    const o = await createOffer(recruiter, { applicationId: c.applicationId!, ...base });
    await submitOffer(recruiter, o.id);
    const req = await pendingRequest("offer", o.id);
    await decide(hrAdmin, { requestId: req.id, decision: "approve" });
    await decide(finance, { requestId: req.id, decision: "approve" });
    const { token: t1 } = await sendOffer(recruiter, o.id);

    // Editing a sent offer creates v2 and kills the v1 link.
    const revised = await reviseOffer(recruiter, o.id, { ...base, annualCtc: 950_000 });
    expect(revised.newVersion).toBe(true);
    expect((await getOfferByToken(t1)).state).toBe("rescinded");
    const [v2] = await db.select().from(offers).where(eq(offers.id, revised.id));
    expect(v2).toMatchObject({ version: 2, status: "draft" });

    await submitOffer(recruiter, v2.id);
    const req2 = await pendingRequest("offer", v2.id);
    await decide(hrAdmin, { requestId: req2.id, decision: "approve" });
    await decide(finance, { requestId: req2.id, decision: "approve" });
    const { token: t2 } = await sendOffer(recruiter, v2.id);
    await db.update(offers).set({ expiresOn: plusDays(-1) }).where(eq(offers.id, v2.id));
    expect((await getOfferByToken(t2)).state).toBe("expired");
    await expect(respondToOffer(t2, "accept", null, { ip: null })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const [after] = await db.select().from(offers).where(eq(offers.id, v2.id));
    expect(after.status).toBe("expired");
    expect(await db.select().from(employees).where(eq(employees.personalEmail, (await db.select().from(candidates).where(eq(candidates.id, c.id)))[0].email))).toHaveLength(0);
    // The daily job is idempotent.
    expect(await withSystem((tx) => expireOffers(tx, org.tenant.id), org.tenant.id)).toBe(0);
  });

  it("isolates candidates and offers between tenants", async () => {
    const other = await createOwnedTenant();
    const otherOwner = await contextFor(other.tenant.id, other.user.id);
    const list = await listCandidates(otherOwner, { q: "", page: 1 });
    expect(list.items.map((i) => i.id)).not.toContain(candidateId);
    await expect(getCandidate(otherOwner, candidateId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getOffer(otherOwner, offerId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const leaked = await otherOwner.db((tx) => tx.select().from(offers));
    expect(leaked.filter((o) => o.tenantId === org.tenant.id)).toHaveLength(0);
    expect(await getPublicJob(tenantSlug, "does-not-exist")).toBeNull();
    // Interviewers without recruitment rights cannot open the candidate list.
    await expect(listCandidates(int1, { q: "", page: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Recruiters without offer rights? Interviewers see no offers at all under RLS.
    const offersForInterviewer = await int1.db((tx) => tx.select().from(offers));
    expect(offersForInterviewer).toHaveLength(0);
    expect(owner.tenantId).toBe(org.tenant.id);
  });
});
