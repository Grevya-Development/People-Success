/**
 * Talent background work: learning assignment rules, certificate expiry,
 * reminders for reviews and courses, survey closing, and milestone
 * suggestions. All handlers run in system context and filter by tenant.
 */
import { withSystem } from "../../db/tx";
import { onDomainEvent, registerJobHandler, registerSchedule } from "../../jobs/registry";
import { notify } from "../notifications";
import { todayIn } from "@/lib/format";
import { runAssignments, sendLearningReminders } from "./learning/assignments";
import { sendReviewReminders } from "./performance/cycles";
import { closeExpiredSurveys } from "./engagement/surveys";
import { managerUserFor } from "./engagement/overview";

registerJobHandler("learning.assign", async (job) => {
  const tenantId = job.tenantId;
  if (!tenantId) return { skipped: "no tenant" };
  const assignmentId = typeof job.payload.assignmentId === "string" ? job.payload.assignmentId : undefined;
  const employeeId = typeof job.payload.employeeId === "string" ? job.payload.employeeId : undefined;
  return withSystem((tx) => runAssignments(tx, tenantId, { assignmentId, employeeId, today: todayIn() }), tenantId);
});
registerSchedule({ name: "learning.assign", every: { dailyAtIst: "02:00" }, perTenant: true, jobType: "learning.assign" });

// New employees pick up matching rules (including "new joiners") straight away.
for (const event of ["employee.created", "employee.joined"] as const) {
  onDomainEvent(event, async (tenantId, e) => {
    const employeeId = typeof e.employeeId === "string" ? e.employeeId : null;
    if (!employeeId) return;
    await withSystem((tx) => runAssignments(tx, tenantId, { employeeId }), tenantId);
  });
}

registerJobHandler("talent.reminders", async (job) => {
  const tenantId = job.tenantId;
  if (!tenantId) return { skipped: "no tenant" };
  const today = todayIn();
  return withSystem(async (tx) => {
    const reviews = await sendReviewReminders(tx, tenantId, today);
    const learning = await sendLearningReminders(tx, tenantId, today);
    const surveysClosed = await closeExpiredSurveys(tx, tenantId, today);
    return { reviews, learning, surveysClosed };
  }, tenantId);
});
registerSchedule({ name: "talent.reminders", every: { dailyAtIst: "09:00" }, perTenant: true, jobType: "talent.reminders" });

// Work anniversaries: suggest a recognition to the manager (notification only).
onDomainEvent("milestone.reached", async (tenantId, e) => {
  if (e.milestone !== "work_anniversary" || typeof e.employeeId !== "string") return;
  const target = await managerUserFor(tenantId, e.employeeId);
  if (!target) return;
  const years = typeof e.years === "number" ? e.years : null;
  await withSystem(
    (tx) =>
      notify(tx, {
        tenantId,
        userIds: [target.userId],
        category: "engagement",
        title: `${target.employeeName} celebrates ${years ? `${years} year${years === 1 ? "" : "s"}` : "a work anniversary"} today`,
        body: "Consider recognizing them on the recognition wall.",
        href: "/engagement?tab=recognition",
        dedupeKey: `anniversary-suggest:${e.employeeId}:${String(e.date ?? "")}`,
      }),
    tenantId,
  );
});
