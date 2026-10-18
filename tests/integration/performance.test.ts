import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, jobs, legalEntities, notifications, reviewTemplates, reviews } from "@/server/db/schema";
import { createEmployee } from "@/server/services/employees/mutations";
import { installPerformanceDefaults } from "@/server/services/talent/performance/setup";
import { checkInGoal, listGoals, saveGoal } from "@/server/services/talent/performance/goals";
import {
  assignPeers,
  calibrateReview,
  calibrationView,
  closeCycle,
  launchCycle,
  listCycles,
  saveCycle,
  shareManagerReviews,
  startCalibration,
} from "@/server/services/talent/performance/cycles";
import { acknowledgeReview, getReview, listMyReviews, myUpwardSummary, saveReview, summarizeReviewFeedback, suggestCoachingTopics } from "@/server/services/talent/performance/reviews";
import { listPromotions, recommendPromotion, updateDevelopmentPlanFromReview } from "@/server/services/talent/performance/development";
import { getCareerPlan } from "@/server/services/talent/engagement/career";
import { createEmployeeSchema } from "@/lib/validation/employees";
import { goalCheckinSchema, goalSchema, promotionSchema, reviewCycleSchema, saveReviewSchema } from "@/lib/validation/talent";
import type { RequestContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { addMember, contextFor, createOwnedTenant } from "../helpers/fixtures";

async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe("performance flow E", () => {
  let org: Awaited<ReturnType<typeof createOwnedTenant>>;
  let hr: RequestContext;
  let ids: { m: string; a: string; b: string; p: string; u: string };
  let ctxs: Record<"m" | "a" | "b" | "p" | "u", RequestContext>;
  let cycleId: string;
  let templateId: string;

  beforeAll(async () => {
    org = await createOwnedTenant();
    hr = await contextFor(org.tenant.id, org.user.id);
    const [{ id: le }] = await db.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.tenantId, org.tenant.id));
    const make = async (firstName: string, managerId: string | null = null) =>
      (
        await createEmployee(
          hr,
          createEmployeeSchema.parse({ firstName, legalEntityId: le, employmentType: "full_time", workerType: "employee", workMode: "onsite", joiningDate: "2024-01-15", probationMonths: 0, noticePeriodDays: 30, managerId }),
        )
      ).id;
    const m = await make("Meera");
    const a = await make("Arjun", m);
    const b = await make("Bela", m);
    const p = await make("Pranav", m);
    const u = await make("Uma");
    ids = { m, a, b, p, u };
    const link = async (id: string, role: string) => {
      const mem = await addMember(org.tenant.id, [role], { employeeId: id });
      return contextFor(org.tenant.id, mem.user.id);
    };
    ctxs = { m: await link(m, "people_manager"), a: await link(a, "employee"), b: await link(b, "employee"), p: await link(p, "employee"), u: await link(u, "employee") };
    await installPerformanceDefaults(hr);
    [{ id: templateId }] = await db.select({ id: reviewTemplates.id }).from(reviewTemplates).where(eq(reviewTemplates.tenantId, org.tenant.id));
  });

  it("creates and launches a cycle with self, manager and upward reviews", async () => {
    ({ id: cycleId } = await saveCycle(
      hr,
      reviewCycleSchema.parse({ name: "FY27 annual", kind: "annual", periodStart: "2026-04-01", periodEnd: "2027-03-31", templateId, includePeers: true, includeUpward: true, selfDueOn: "2027-04-10" }),
    ));
    const launched = await launchCycle(hr, cycleId);
    expect(launched.participants).toBe(5);
    expect(launched.withoutManager).toBe(2); // Meera and Uma have no manager
    await expectCode(launchCycle(hr, cycleId), "INVALID_STATE");
    const rows = await db.select().from(reviews).where(eq(reviews.cycleId, cycleId));
    expect(rows.filter((r) => r.kind === "self")).toHaveLength(5);
    expect(rows.filter((r) => r.kind === "manager")).toHaveLength(3);
    expect(rows.filter((r) => r.kind === "upward" && r.employeeId === ids.m)).toHaveLength(3);
    const [event] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.tenantId, org.tenant.id), eq(jobs.type, "domain_event")))
      .then((js) => js.filter((j) => (j.payload as { event: string }).event === "performance.cycle_started"));
    expect(event).toBeTruthy();
    const notes = await db.select().from(notifications).where(and(eq(notifications.tenantId, org.tenant.id), eq(notifications.userId, org.user.id)));
    expect(notes.some((n) => n.title.includes("no manager"))).toBe(true);
  });

  it("assigns goals with weights capped at 100 and records check-ins", async () => {
    const g1 = await saveGoal(ctxs.m, goalSchema.parse({ employeeId: ids.a, cycleId, title: "Ship payments v2", weight: 60, startValue: 0, targetValue: 100, metricUnit: "%" }));
    await saveGoal(ctxs.a, goalSchema.parse({ employeeId: ids.a, cycleId, title: "Mentor a new joiner", weight: 40 }));
    await expectCode(saveGoal(ctxs.a, goalSchema.parse({ employeeId: ids.a, cycleId, title: "One more", weight: 10 })), "VALIDATION");
    // Unrelated employees cannot set goals for others.
    await expectCode(saveGoal(ctxs.u, goalSchema.parse({ employeeId: ids.a, cycleId, title: "Nope", weight: 0 })), "FORBIDDEN");
    const r = await checkInGoal(ctxs.a, goalCheckinSchema.parse({ goalId: g1.id, value: 50, note: "Halfway" }));
    expect(r.progressPercent).toBe(50);
    const mine = await listGoals(ctxs.a, "mine", { cycleId });
    expect(mine).toHaveLength(2);
    // Private goals are not visible to an unrelated colleague.
    expect((await listGoals(ctxs.u, "company")).some((g) => g.employeeId === ids.a)).toBe(false);
    expect((await listGoals(ctxs.m, "team")).filter((g) => g.employeeId === ids.a)).toHaveLength(2);
  });

  const reviewOf = async (employeeId: string, kind: "self" | "manager" | "peer" | "upward", reviewer?: string) => {
    const rows = await db.select().from(reviews).where(and(eq(reviews.cycleId, cycleId), eq(reviews.employeeId, employeeId), eq(reviews.kind, kind)));
    return reviewer ? rows.find((r) => r.reviewerEmployeeId === reviewer)! : rows[0];
  };

  it("hides the self review from the manager until submitted", async () => {
    const self = await reviewOf(ids.a, "self");
    const mgr = await reviewOf(ids.a, "manager");
    await saveReview(ctxs.a, saveReviewSchema.parse({ reviewId: self.id, responses: { impact: { rating: 4 } }, submit: false }));
    expect((await getReview(ctxs.m, mgr.id)).selfReview).toBeNull();
    await expectCode(getReview(ctxs.m, self.id), "NOT_FOUND");
    await expectCode(saveReview(ctxs.a, saveReviewSchema.parse({ reviewId: self.id, responses: { impact: { rating: 4 } }, submit: true })), "VALIDATION");
    await saveReview(
      ctxs.a,
      saveReviewSchema.parse({ reviewId: self.id, responses: { impact: { rating: 4 }, achievements: { text: "Delivered the payments migration on time." }, collaboration: { rating: 5 } }, submit: true }),
    );
    const seen = await getReview(ctxs.m, mgr.id);
    expect(seen.selfReview?.responses.achievements.text).toMatch(/payments/);
    expect(seen.goals).toHaveLength(2);
    // Other employees cannot even see (let alone write) someone else's review.
    await expectCode(saveReview(ctxs.b, saveReviewSchema.parse({ reviewId: self.id, responses: {}, submit: false })), "NOT_FOUND");
  });

  it("keeps peer reviews from the reviewee and all reviews from unrelated employees", async () => {
    await assignPeers(ctxs.m, { cycleId, employeeId: ids.a, peerIds: [ids.p] });
    await expectCode(assignPeers(ctxs.u, { cycleId, employeeId: ids.a, peerIds: [ids.b] }), "FORBIDDEN");
    const peer = await reviewOf(ids.a, "peer", ids.p);
    expect(peer).toBeTruthy();
    await saveReview(ctxs.p, saveReviewSchema.parse({ reviewId: peer.id, responses: { collaboration: { rating: 4 }, growth: { text: "Could delegate more." } }, submit: true }));
    await expectCode(getReview(ctxs.a, peer.id), "NOT_FOUND");
    expect((await listMyReviews(ctxs.a)).toWrite.some((r) => r.kind === "peer")).toBe(false);
    // RLS: the reviewee cannot even select the peer row.
    const viaRls = await ctxs.a.db((tx) => tx.select().from(reviews).where(and(eq(reviews.employeeId, ids.a), eq(reviews.kind, "peer"))));
    expect(viaRls).toHaveLength(0);
    const mgr = await reviewOf(ids.a, "manager");
    await expectCode(getReview(ctxs.u, mgr.id), "NOT_FOUND");
    const unrelated = await ctxs.u.db((tx) => tx.select().from(reviews).where(eq(reviews.employeeId, ids.a)));
    expect(unrelated).toHaveLength(0);
    // Not shared yet: the employee cannot read the manager review.
    await expectCode(getReview(ctxs.a, mgr.id), "NOT_FOUND");
  });

  it("collects upward feedback but releases it only in aggregate after close", async () => {
    for (const k of ["a", "b", "p"] as const) {
      const up = await reviewOf(ids.m, "upward", ids[k]);
      await saveReview(ctxs[k], saveReviewSchema.parse({ reviewId: up.id, responses: { support: { rating: k === "a" ? 5 : 4 } }, submit: true }));
    }
    expect(await myUpwardSummary(ctxs.m)).toEqual([]);
    const up = await reviewOf(ids.m, "upward", ids.a);
    await expectCode(getReview(ctxs.m, up.id), "NOT_FOUND");
  });

  it("requires justification to override the suggested rating, then submits", async () => {
    const mgr = await reviewOf(ids.a, "manager");
    const responses = { impact: { rating: 4 }, achievements: { text: "Strong delivery on payments." }, collaboration: { rating: 4 }, growth: { text: "Needs to improve delegation." } };
    const draft = await saveReview(ctxs.m, saveReviewSchema.parse({ reviewId: mgr.id, responses, submit: false }));
    expect(draft.suggestion).not.toBeNull();
    const override = draft.suggestion! >= 4.5 ? 3 : 5;
    await expectCode(saveReview(ctxs.m, saveReviewSchema.parse({ reviewId: mgr.id, responses, overallRating: override, submit: true })), "VALIDATION");
    const done = await saveReview(
      ctxs.m,
      saveReviewSchema.parse({ reviewId: mgr.id, responses, overallRating: override, overrideJustification: "Exceptional incident leadership in Q3.", developmentAreas: "Delegation\nStakeholder communication", submit: true }),
    );
    expect(done.status).toBe("submitted");
    expect(done.overallRating).toBe(override);
    const summary = await summarizeReviewFeedback(ctxs.m, mgr.id);
    expect(summary.source).toBe("rules");
    expect(summary.data.summary.length).toBeGreaterThan(0);
    const coaching = await suggestCoachingTopics(ctxs.m, mgr.id);
    expect(Array.isArray(coaching.data.topics)).toBe(true);
    await expectCode(summarizeReviewFeedback(ctxs.u, mgr.id), "NOT_FOUND");
  });

  it("calibrates (audited), shares, acknowledges, closes and updates the development plan", async () => {
    const mgr = await reviewOf(ids.a, "manager");
    await expectCode(calibrateReview(hr, { reviewId: mgr.id, calibratedRating: 4, note: "Aligned with peers" }), "INVALID_STATE");
    await startCalibration(hr, cycleId);
    const view = await calibrationView(hr, cycleId);
    const row = view.rows.find((r) => r.reviewId === mgr.id)!;
    expect(row.finalRating).toBe(row.overallRating);
    await calibrateReview(hr, { reviewId: mgr.id, calibratedRating: 4, note: "Aligned with peers" });
    const [log] = await db.select().from(auditLogs).where(and(eq(auditLogs.tenantId, org.tenant.id), eq(auditLogs.action, "performance.rating_calibrated"), eq(auditLogs.entityId, mgr.id)));
    expect(log.changes).toMatchObject({ calibratedRating: { to: 4 } });
    expect((await calibrationView(hr, cycleId)).distribution.find((d) => d.value === 4)?.count).toBe(1);

    const promo = await recommendPromotion(ctxs.m, promotionSchema.parse({ cycleId, employeeId: ids.a, justification: "Consistently operating at the next level.", proposedAnnualCtc: 1800000 }));
    const asManager = await listPromotions(ctxs.m);
    expect(asManager.find((p) => p.id === promo.id)?.proposedAnnualCtc).toBeNull();
    expect((await listPromotions(hr)).find((p) => p.id === promo.id)?.proposedAnnualCtc).toBe(180000000);

    const shared = await shareManagerReviews(hr, cycleId);
    expect(shared.shared).toBe(1);
    const mine = await getReview(ctxs.a, mgr.id);
    expect(mine.access.canAcknowledge).toBe(true);
    expect(mine.finalRating).toBe(4);
    expect(mine.calibrationNote).toBeNull();
    expect(mine.overrideJustification).toBeNull();
    await acknowledgeReview(ctxs.a, mgr.id);
    await expectCode(acknowledgeReview(ctxs.a, mgr.id), "INVALID_STATE");

    await expectCode(updateDevelopmentPlanFromReview(ctxs.m, mgr.id), "INVALID_STATE"); // not closed yet
    await closeCycle(hr, cycleId);
    const self = await reviewOf(ids.b, "self");
    await expectCode(saveReview(ctxs.b, saveReviewSchema.parse({ reviewId: self.id, responses: {}, submit: false })), "INVALID_STATE");

    const upward = await myUpwardSummary(ctxs.m);
    expect(upward).toHaveLength(1);
    expect(upward[0]).toMatchObject({ suppressed: false, responses: 3 });
    expect(upward[0].questions[0].average).toBeCloseTo(4.33, 2);

    const plan = await updateDevelopmentPlanFromReview(ctxs.m, mgr.id);
    expect(plan.added).toBe(2);
    const again = await updateDevelopmentPlanFromReview(ctxs.a, mgr.id);
    expect(again.added).toBe(0);
    const career = await getCareerPlan(ctxs.a, ids.a);
    expect(career.plan?.actions.map((x) => x.title)).toEqual(["Delegation", "Stakeholder communication"]);
  });

  it("isolates tenants", async () => {
    const other = await createOwnedTenant();
    const otherHr = await contextFor(other.tenant.id, other.user.id);
    expect((await listCycles(otherHr)).some((c) => c.id === cycleId)).toBe(false);
    const mgr = await reviewOf(ids.a, "manager");
    await expectCode(getReview(otherHr, mgr.id), "NOT_FOUND");
    const leaked = await otherHr.db((tx) => tx.select().from(reviews).where(eq(reviews.cycleId, cycleId)));
    expect(leaked).toHaveLength(0);
  });
});
