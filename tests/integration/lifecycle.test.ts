import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  approvalPolicies,
  approvalRequests,
  approvalSteps,
  documents,
  employees,
  employmentRecords,
  exitCases,
  jobs,
  legalEntities,
  lifecyclePlans,
  notifications,
  policies,
  tasks,
} from "@/server/db/schema";
import type { RequestContext } from "@/server/auth/context";
import { createEmployee } from "@/server/services/employees/mutations";
import { assignAsset } from "@/server/services/employees/sections";
import { decide, updateTaskStatus } from "@/server/services/inbox";
import { installStandardTemplates, listTemplates } from "@/server/services/lifecycle/templates";
import {
  acknowledgeForTask,
  getPlanDetail,
  listPlans,
  myOnboarding,
  recordCheckin,
  setPlanTaskStatus,
  startOnboarding,
} from "@/server/services/lifecycle/plans";
import {
  completeExit,
  confirmAccessRevocation,
  generateExitLetters,
  getExitCase,
  initiateExit,
  listExitCases,
  myExit,
  recordExitAssetReturn,
  saveExitInterview,
  saveSettlementInputs,
  setSettlementStatus,
  submitResignation,
  updateExitTerms,
  withdrawResignation,
} from "@/server/services/lifecycle/exits";
import { onEmployeeCreated, onOfferAccepted, runLifecycleReminders } from "@/server/services/lifecycle/jobs";
import { PLAN_CONTAINER, shiftDate } from "@/server/services/lifecycle/shared";
import { createEmployeeSchema } from "@/lib/validation/employees";
import { checkinSchema, exitInterviewSchema, hrExitSchema, resignationSchema, settlementInputsSchema } from "@/lib/validation/lifecycle";
import { todayIn } from "@/lib/format";
import { addMember, contextFor, createOwnedTenant } from "../helpers/fixtures";

type Org = Awaited<ReturnType<typeof createOwnedTenant>>;

async function setupOrg() {
  const org = await createOwnedTenant();
  const [le] = await db.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.tenantId, org.tenant.id));
  const owner = await contextFor(org.tenant.id, org.user.id);
  const hire = (firstName: string, joiningDate: string, managerId: string | null = null) =>
    createEmployee(
      owner,
      createEmployeeSchema.parse({
        firstName,
        legalEntityId: le.id,
        employmentType: "full_time",
        workerType: "employee",
        workMode: "onsite",
        joiningDate,
        probationMonths: 6,
        noticePeriodDays: 30,
        managerId,
      }),
    );
  const withLogin = async (emp: { id: string }, roles: string[]) => {
    const m = await addMember(org.tenant.id, roles, { employeeId: emp.id });
    return { userId: m.user.id, ctx: await contextFor(org.tenant.id, m.user.id) };
  };
  return { org, le: le.id, owner, hire, withLogin };
}

const eventsOf = async (tenantId: string, event: string) =>
  (await db.select().from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.type, "domain_event")))).filter(
    (j) => (j.payload as { event: string }).event === event,
  );

const planTasksOf = (planId: string) =>
  db.select().from(tasks).where(and(eq(tasks.containerType, PLAN_CONTAINER), eq(tasks.containerId, planId)));

describe("lifecycle: onboarding (flow B)", () => {
  let s: Awaited<ReturnType<typeof setupOrg>>;
  let hr: { userId: string; ctx: RequestContext };
  let mgr: { userId: string; ctx: RequestContext };
  let mgrEmp: { id: string };
  let joiner: { id: string };
  let joinerLogin: { userId: string; ctx: RequestContext };
  let planId: string;
  const joining = shiftDate(todayIn(), 10);

  beforeAll(async () => {
    s = await setupOrg();
    hr = await s.withLogin(await s.hire("Hema", "2023-01-01"), ["hr_admin"]);
    mgrEmp = await s.hire("Manu", "2023-01-01");
    mgr = await s.withLogin(mgrEmp, ["people_manager"]);
    const res = await installStandardTemplates(hr.ctx);
    expect(res.added).toBe(2);
    // Idempotent.
    expect((await installStandardTemplates(hr.ctx)).added).toBe(0);
    joiner = await s.hire("Joy", joining, mgrEmp.id);
    joinerLogin = await s.withLogin(joiner, ["employee"]);
  });

  it("lists the seeded templates", async () => {
    const t = await listTemplates(hr.ctx);
    expect(t.map((x) => x.name).sort()).toEqual(["Standard offboarding", "Standard onboarding"]);
    expect(t.find((x) => x.kind === "onboarding")!.taskCount).toBe(15);
  });

  it("auto-starts onboarding from offer.accepted, idempotently, with resolved assignees and due dates", async () => {
    const [{ status }] = await db.select({ status: employees.status }).from(employees).where(eq(employees.id, joiner.id));
    expect(status).toBe("pending");
    const first = await onOfferAccepted(s.org.tenant.id, { event: "offer.accepted", offerId: randomUUID(), employeeId: joiner.id, candidateName: "Joy", joiningDate: joining });
    expect(first).toHaveProperty("planId");
    planId = (first as { planId: string }).planId;
    // Redelivery and the sibling event do nothing.
    expect(await onOfferAccepted(s.org.tenant.id, { employeeId: joiner.id })).toHaveProperty("skipped");
    expect(await onEmployeeCreated(s.org.tenant.id, { employeeId: joiner.id, source: "offer" })).toHaveProperty("skipped");
    const plans = await db.select().from(lifecyclePlans).where(eq(lifecyclePlans.employeeId, joiner.id));
    expect(plans).toHaveLength(1);
    expect(plans[0].anchorDate).toBe(joining);

    const rows = await planTasksOf(planId);
    expect(rows).toHaveLength(15);
    const byTitle = (t: string) => rows.find((r) => r.title.startsWith(t))!;
    expect(byTitle("Upload identity").assigneeUserId).toBe(joinerLogin.userId);
    expect(byTitle("Upload identity").dueOn).toBe(shiftDate(joining, -7));
    expect(byTitle("First-day checklist").assigneeUserId).toBe(mgr.userId);
    expect(byTitle("Share the orientation").assigneeUserId).toBe(hr.userId);
    // IT: the first member holding assets.manage (the owner here).
    expect(byTitle("Prepare laptop").assigneeUserId).toBe(s.org.user.id);
    expect(byTitle("Buddy").assigneeUserId).toBeNull();
    expect((byTitle("Buddy").config as { assigneeNote?: string }).assigneeNote).toMatch(/buddy/i);
    expect(byTitle("30-day check-in").dueOn).toBe(shiftDate(joining, 30));
  });

  it("prevents a duplicate open plan", async () => {
    await expect(startOnboarding(hr.ctx, { employeeId: joiner.id, templateId: null, buddyEmployeeId: null })).rejects.toThrow(/already has an open onboarding plan/);
  });

  it("refuses to complete a document task until the document exists", async () => {
    const rows = await planTasksOf(planId);
    const idTask = rows.find((r) => r.kind === "document_upload" && (r.config as { documentCategory?: string }).documentCategory === "identity")!;
    await expect(updateTaskStatus(joinerLogin.ctx, { taskId: idTask.id, status: "done" })).rejects.toThrow(/Upload/);
    // HR cannot force it either.
    await expect(setPlanTaskStatus(hr.ctx, { taskId: idTask.id, status: "done" })).rejects.toThrow(/Upload/);
    await db.insert(documents).values({
      tenantId: s.org.tenant.id,
      ownerType: "employee",
      ownerId: joiner.id,
      employeeId: joiner.id,
      category: "identity",
      title: "PAN card",
      storagePath: `${s.org.tenant.id}/employee/${joiner.id}/${randomUUID()}.pdf`,
      fileName: "pan.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1200,
      scanStatus: "clean",
      uploadedBy: joinerLogin.userId,
    });
    const done = await updateTaskStatus(joinerLogin.ctx, { taskId: idTask.id, status: "done" });
    expect(done.status).toBe("done");
    const [plan] = await db.select().from(lifecyclePlans).where(eq(lifecyclePlans.id, planId));
    expect(plan.progressPercent).toBeGreaterThan(0);
    expect(plan.status).toBe("in_progress");
  });

  it("completes the acknowledgement task when the employee acknowledges the policy", async () => {
    const [policy] = await db
      .insert(policies)
      .values({ tenantId: s.org.tenant.id, title: "Code of conduct", body: "Be kind.", effectiveFrom: "2026-01-01", requiresAcknowledgement: true, status: "published", publishedAt: new Date() })
      .returning();
    const ackTask = (await planTasksOf(planId)).find((r) => r.kind === "acknowledgement")!;
    await expect(updateTaskStatus(joinerLogin.ctx, { taskId: ackTask.id, status: "done" })).rejects.toThrow(/acknowledge/);
    // Someone else cannot acknowledge on the employee's behalf.
    await expect(acknowledgeForTask(hr.ctx, { taskId: ackTask.id, policyId: policy.id })).rejects.toThrow();
    const res = await acknowledgeForTask(joinerLogin.ctx, { taskId: ackTask.id, policyId: policy.id });
    expect(res.completed).toBe(true);
    const [t] = await db.select().from(tasks).where(eq(tasks.id, ackTask.id));
    expect(t.status).toBe("done");
  });

  it("shows the employee their own onboarding", async () => {
    const mine = await myOnboarding(joinerLogin.ctx);
    expect(mine?.id).toBe(planId);
    expect(mine?.isSubject).toBe(true);
  });

  it("completes the plan when every required task is done and notifies the manager", async () => {
    const before = await getPlanDetail(hr.ctx, planId);
    const progressBefore = before.progressPercent;
    for (const t of before.tasks.filter((x) => x.required && x.status !== "done")) {
      if (t.kind === "checkin") {
        // A check-in completes only with notes.
        await expect(setPlanTaskStatus(mgr.ctx, { taskId: t.id, status: "done" })).rejects.toThrow(/check-in/);
        await recordCheckin(mgr.ctx, checkinSchema.parse({ taskId: t.id, settlingIn: 4, note: "Settling in well." }));
      } else if (t.kind === "document_upload") {
        await db.insert(documents).values({
          tenantId: s.org.tenant.id,
          ownerType: "employee",
          ownerId: joiner.id,
          employeeId: joiner.id,
          category: (t.documentCategory ?? "other") as "education",
          title: "Degree",
          storagePath: `${s.org.tenant.id}/employee/${joiner.id}/${randomUUID()}.pdf`,
          fileName: "degree.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1200,
          scanStatus: "clean",
        });
        await setPlanTaskStatus(hr.ctx, { taskId: t.id, status: "done" });
      } else {
        await setPlanTaskStatus(hr.ctx, { taskId: t.id, status: "done" });
      }
    }
    const [plan] = await db.select().from(lifecyclePlans).where(eq(lifecyclePlans.id, planId));
    expect(plan.status).toBe("completed");
    expect(plan.progressPercent).toBe(100);
    expect(progressBefore).toBeLessThan(100);
    const notes = await db.select().from(notifications).where(and(eq(notifications.userId, mgr.userId), eq(notifications.tenantId, s.org.tenant.id)));
    expect(notes.some((n) => n.title === "Onboarding complete: Joy")).toBe(true);
    expect((await eventsOf(s.org.tenant.id, "onboarding.completed")).length).toBe(1);
    // The employee is still pending: never auto-activated.
    const [{ status }] = await db.select({ status: employees.status }).from(employees).where(eq(employees.id, joiner.id));
    expect(status).toBe("pending");
  });

  it("lists plans for HR and the manager's team only", async () => {
    const all = await listPlans(hr.ctx, { status: "all" });
    expect(all.some((p) => p.id === planId)).toBe(true);
    const team = await listPlans(mgr.ctx, { status: "all" });
    expect(team.map((p) => p.employee.id)).toEqual([joiner.id]);
    await expect(listPlans(joinerLogin.ctx)).rejects.toThrow();
  });

  it("reminds overdue assignees and escalates to HR after three days", async () => {
    const other = await s.hire("Ravi", shiftDate(todayIn(), -20), mgrEmp.id);
    const { id } = await startOnboarding(hr.ctx, { employeeId: other.id, templateId: null, buddyEmployeeId: null });
    const res = await runLifecycleReminders(s.org.tenant.id);
    expect(res.reminded).toBeGreaterThan(0);
    expect(res.escalated).toBeGreaterThan(0);
    const again = await runLifecycleReminders(s.org.tenant.id);
    expect(again.escalated).toBe(0);
    const hrNotes = await db.select().from(notifications).where(and(eq(notifications.userId, hr.userId), sql`${notifications.title} like 'Escalated:%'`));
    expect(hrNotes.length).toBeGreaterThan(0);
    expect(id).toBeTruthy();
  });
});

describe("lifecycle: exits (flow F)", () => {
  let s: Awaited<ReturnType<typeof setupOrg>>;
  let hr: { userId: string; ctx: RequestContext };
  let mgr: { userId: string; ctx: RequestContext };
  let fin: { userId: string; ctx: RequestContext };
  let mgrEmp: { id: string };
  let esha: { id: string; employeeCode: string };
  let eshaLogin: { userId: string; ctx: RequestContext };
  let peer: { userId: string; ctx: RequestContext };
  let exitId: string;

  beforeAll(async () => {
    s = await setupOrg();
    hr = await s.withLogin(await s.hire("Hema", "2023-01-01"), ["hr_admin"]);
    mgrEmp = await s.hire("Manu", "2023-01-01");
    mgr = await s.withLogin(mgrEmp, ["people_manager"]);
    fin = await s.withLogin(await s.hire("Farah", "2023-01-01"), ["finance_manager"]);
    await installStandardTemplates(hr.ctx);
    esha = await s.hire("Esha", "2024-01-01", mgrEmp.id);
    eshaLogin = await s.withLogin(esha, ["employee"]);
    peer = await s.withLogin(await s.hire("Pia", "2024-01-01", mgrEmp.id), ["employee"]);
    await assignAsset(s.owner, { employeeId: esha.id, tag: `LAP-${randomUUID().slice(0, 6)}`, category: "laptop", name: "ThinkPad" });
  });

  it("employee submits a resignation that routes to the manager then HR", async () => {
    const lwd = shiftDate(todayIn(), 30);
    const { id } = await submitResignation(eshaLogin.ctx, resignationSchema.parse({ requestedLastWorkingDate: lwd, reasonCategory: "better_opportunity", reasonDetail: "New role" }));
    exitId = id;
    await expect(submitResignation(eshaLogin.ctx, resignationSchema.parse({ requestedLastWorkingDate: lwd, reasonCategory: "other" }))).rejects.toThrow(/open exit/);
    const [ec] = await db.select().from(exitCases).where(eq(exitCases.id, id));
    expect(ec.status).toBe("submitted");
    expect((await eventsOf(s.org.tenant.id, "resignation.submitted")).some((e) => (e.payload as { employeeId: string }).employeeId === esha.id)).toBe(true);
    const mine = await myExit(eshaLogin.ctx);
    expect(mine?.current?.id).toBe(id);
    expect(mine?.current?.interview).toBeNull();
  });

  it("another employee cannot see the exit case", async () => {
    await expect(getExitCase(peer.ctx, exitId)).rejects.toThrow(/permission/);
    await expect(listExitCases(peer.ctx)).rejects.toThrow(/permission/);
    // The manager sees a limited view.
    const asMgr = await getExitCase(mgr.ctx, exitId);
    expect(asMgr.access).toBe("viewer");
    expect(asMgr.interview).toBeNull();
    expect(asMgr.settlementInputs).toBeNull();
  });

  it("manager and HR approval put the employee on notice with an offboarding plan", async () => {
    const [req] = await db.select().from(approvalRequests).where(and(eq(approvalRequests.subjectType, "resignation"), eq(approvalRequests.subjectId, exitId)));
    await decide(mgr.ctx, { requestId: req.id, decision: "approve", comment: null });
    const [step2] = await db.select().from(approvalSteps).where(and(eq(approvalSteps.requestId, req.id), eq(approvalSteps.stepNo, 2)));
    expect(step2.approverUserIds).toContain(hr.userId);
    await decide(hr.ctx, { requestId: req.id, decision: "approve", comment: null });

    const [ec] = await db.select().from(exitCases).where(eq(exitCases.id, exitId));
    expect(ec.status).toBe("accepted");
    expect(ec.approvedLastWorkingDate).toBe(shiftDate(todayIn(), 30));
    const [emp] = await db.select().from(employees).where(eq(employees.id, esha.id));
    expect(emp.status).toBe("on_notice");
    expect(emp.resignationDate).toBe(todayIn());
    expect(emp.lastWorkingDate).toBe(ec.approvedLastWorkingDate);
    const [plan] = await db.select().from(lifecyclePlans).where(eq(lifecyclePlans.exitCaseId, exitId));
    expect(plan.kind).toBe("offboarding");
    expect(plan.anchorDate).toBe(ec.approvedLastWorkingDate);
    const rows = await planTasksOf(plan.id);
    expect(rows).toHaveLength(8);
    expect(rows.find((r) => r.ownerGroup === "employee")!.assigneeUserId).toBe(eshaLogin.userId);
    expect(rows.find((r) => r.ownerGroup === "finance")!.assigneeUserId).toBe(fin.userId);
  });

  it("HR releases early (notice shortfall recorded with treatment)", async () => {
    const res = await updateExitTerms(hr.ctx, { exitCaseId: exitId, approvedLastWorkingDate: todayIn(), shortfallTreatment: "waived" });
    expect(res.noticeShortfallDays).toBe(30);
    expect(res.shortfallTreatment).toBe("waived");
    const [plan] = await db.select().from(lifecyclePlans).where(eq(lifecyclePlans.exitCaseId, exitId));
    expect(plan.anchorDate).toBe(todayIn());
  });

  it("asset return, interview, settlement inputs, letters and access revocation", async () => {
    // Asset task cannot be ticked while an asset is out.
    const detail = await getExitCase(hr.ctx, exitId);
    const assetTask = detail.plan!.tasks.find((t) => t.code === "asset_return")!;
    await expect(setPlanTaskStatus(hr.ctx, { taskId: assetTask.id, status: "done" })).rejects.toThrow(/still assigned/);
    await recordExitAssetReturn(hr.ctx, { exitCaseId: exitId, assignmentId: detail.assets[0].assignmentId, condition: "Good" });
    expect((await db.select().from(tasks).where(eq(tasks.id, assetTask.id)))[0].status).toBe("done");

    await saveExitInterview(
      hr.ctx,
      exitInterviewSchema.parse({
        exitCaseId: exitId,
        conductedOn: todayIn(),
        primaryReason: "career_growth",
        ratings: { role: 4, manager: 4, growth: 2, compensation: 3, culture: 4, workLife: 3 },
        wouldRecommend: true,
        regretted: true,
        comments: "Wants a lead role.",
      }),
    );
    // The interview is confidential to HR.
    expect((await myExit(eshaLogin.ctx))?.current?.interview).toBeNull();

    await saveSettlementInputs(
      hr.ctx,
      settlementInputsSchema.parse({ exitCaseId: exitId, noticeRecoveryDays: 0, noticePayInLieuDays: 0, leaveEncashmentDays: 6.5, otherRecoveries: 1500, otherPayments: 0 }),
    );
    await setSettlementStatus(hr.ctx, { exitCaseId: exitId, status: "draft" });
    await setSettlementStatus(hr.ctx, { exitCaseId: exitId, status: "pending_approval" });
    await expect(setSettlementStatus(hr.ctx, { exitCaseId: exitId, status: "approved" })).rejects.toThrow(/payroll approvers/);
    await setSettlementStatus(fin.ctx, { exitCaseId: exitId, status: "approved" });
    const afterSettle = await getExitCase(hr.ctx, exitId);
    expect(afterSettle.settlementStatus).toBe("approved");
    expect(afterSettle.settlementInputs?.otherRecoveries).toBe(150_000);

    const letters = await generateExitLetters(hr.ctx, { exitCaseId: exitId, kinds: ["experience", "relieving"] });
    const docs = await db.select().from(documents).where(eq(documents.employeeId, esha.id));
    const generated = docs.filter((d) => d.bucket === "generated");
    expect(generated).toHaveLength(2);
    expect(generated.every((d) => d.mimeType === "application/pdf" && d.sizeBytes > 500 && d.category === "exit")).toBe(true);
    expect(Object.keys(letters.documents).sort()).toEqual(["experience", "relieving"]);

    // Access revocation needs authorized confirmation, not a checkbox.
    const access = afterSettle.plan!.tasks.find((t) => t.code === "access_revocation")!;
    await expect(updateTaskStatus(s.owner, { taskId: access.id, status: "done" })).rejects.toThrow(/confirmed/);
    await expect(confirmAccessRevocation(mgr.ctx, { taskId: access.id, note: "Disabled" })).rejects.toThrow();
    await confirmAccessRevocation(hr.ctx, { taskId: access.id, note: "Email and SSO disabled" });
  });

  it("cannot complete with open tasks; completes once they are done", async () => {
    await expect(completeExit(hr.ctx, { exitCaseId: exitId, eligibleForRehire: true, exitReason: null })).rejects.toThrow(/required/);
    const detail = await getExitCase(hr.ctx, exitId);
    for (const t of detail.plan!.tasks.filter((x) => x.status !== "done" && x.status !== "waived")) {
      await setPlanTaskStatus(hr.ctx, { taskId: t.id, status: "done" });
    }
    const recordsBefore = await db.select().from(employmentRecords).where(eq(employmentRecords.employeeId, esha.id));
    await completeExit(hr.ctx, { exitCaseId: exitId, eligibleForRehire: true, exitReason: null });

    const [emp] = await db.select().from(employees).where(eq(employees.id, esha.id));
    expect(emp.status).toBe("exited");
    expect(emp.exitDate).toBe(todayIn());
    expect(emp.exitReason).toBe("Better opportunity");
    const records = await db.select().from(employmentRecords).where(eq(employmentRecords.employeeId, esha.id));
    expect(records).toHaveLength(recordsBefore.length);
    expect(records.find((r) => r.changeType === "hire")!.effectiveTo).toBe(shiftDate(todayIn(), 1));
    const [ec] = await db.select().from(exitCases).where(eq(exitCases.id, exitId));
    expect(ec.status).toBe("completed");
    expect(ec.eligibleForRehire).toBe(true);
    expect((await eventsOf(s.org.tenant.id, "employee.exited")).some((e) => (e.payload as { employeeId: string }).employeeId === esha.id)).toBe(true);
    const lettersVisible = await db.select().from(documents).where(and(eq(documents.employeeId, esha.id), eq(documents.bucket, "generated")));
    expect(lettersVisible.every((d) => d.employeeVisible)).toBe(true);
  });

  it("an employee can withdraw a resignation before acceptance", async () => {
    const { id } = await submitResignation(peer.ctx, resignationSchema.parse({ requestedLastWorkingDate: shiftDate(todayIn(), 30), reasonCategory: "relocation" }));
    await withdrawResignation(peer.ctx, id);
    const [ec] = await db.select().from(exitCases).where(eq(exitCases.id, id));
    expect(ec.status).toBe("withdrawn");
    const [req] = await db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, id));
    expect(req.status).toBe("cancelled");
  });

  it("termination requires exits.manage and the typed employee code", async () => {
    const target = await s.hire("Tara", "2024-01-01", mgrEmp.id);
    const input = (confirmation: string | null) =>
      hrExitSchema.parse({ employeeId: target.id, type: "termination", lastWorkingDate: todayIn(), reasonCategory: "conduct", reasonDetail: "Policy breach", confirmation });
    await expect(initiateExit(mgr.ctx, input(target.employeeCode))).rejects.toThrow(/permission/);
    await expect(initiateExit(hr.ctx, input("WRONG"))).rejects.toThrow(/employee code/);
    const { id } = await initiateExit(hr.ctx, input(target.employeeCode.toLowerCase()));
    const [ec] = await db.select().from(exitCases).where(eq(exitCases.id, id));
    expect(ec.status).toBe("under_review");
    const [req] = await db.select().from(approvalRequests).where(and(eq(approvalRequests.subjectType, "exit_case"), eq(approvalRequests.subjectId, id)));
    expect(req.status).toBe("pending");
    const pol = await db.select().from(approvalPolicies).where(and(eq(approvalPolicies.tenantId, s.org.tenant.id), eq(approvalPolicies.subjectType, "exit_case")));
    expect(pol).toHaveLength(1);
    // Not on notice until approved.
    const [emp] = await db.select({ status: employees.status }).from(employees).where(eq(employees.id, target.id));
    expect(emp.status).toBe("active");
  });

  it("isolates tenants", async () => {
    const other = await setupOrg();
    const otherHr = await other.withLogin(await other.hire("Olga", "2023-01-01"), ["hr_admin"]);
    await expect(getExitCase(otherHr.ctx, exitId)).rejects.toThrow(/not found/);
    expect((await listExitCases(otherHr.ctx, { status: "all" })).length).toBe(0);
    const [plan] = await db.select().from(lifecyclePlans).where(eq(lifecyclePlans.exitCaseId, exitId));
    await expect(getPlanDetail(otherHr.ctx, plan.id)).rejects.toThrow(/not found/);
    expect((await listPlans(otherHr.ctx, { status: "all" })).length).toBe(0);
    await expect(saveExitInterview(otherHr.ctx, exitInterviewSchema.parse({
      exitCaseId: exitId, conductedOn: todayIn(), primaryReason: "other",
      ratings: { role: 1, manager: 1, growth: 1, compensation: 1, culture: 1, workLife: 1 }, wouldRecommend: false, regretted: false,
    }))).rejects.toThrow(/not found/);
  });
});

export type { Org };
