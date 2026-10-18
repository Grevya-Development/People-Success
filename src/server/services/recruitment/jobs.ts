import { withSystem } from "../../db/tx";
import { registerJobHandler, registerSchedule } from "../../jobs/registry";
import { todayIn } from "@/lib/format";
import { sendInterviewReminders } from "./interviews";
import { expireOffers } from "./offers";
import { evaluateReferralRewards, postApprovedRewards } from "./referrals";
import "./approval-handlers";

/** Interview reminders for the next 24 hours (deduplicated per interview, user and start time). */
registerJobHandler("recruitment.interview_reminders", async (job) => {
  if (!job.tenantId) return;
  return withSystem((tx) => sendInterviewReminders(tx, job.tenantId!), job.tenantId);
});
registerSchedule({ name: "recruitment.interview_reminders", every: { minutes: 30 }, perTenant: true, jobType: "recruitment.interview_reminders" });

/** Sent offers past their expiry date become expired. */
registerJobHandler("recruitment.expire_offers", async (job) => {
  if (!job.tenantId) return;
  const n = await withSystem((tx) => expireOffers(tx, job.tenantId!, todayIn()), job.tenantId);
  return { expired: n };
});
registerSchedule({ name: "recruitment.expire_offers", every: { dailyAtIst: "00:15" }, perTenant: true, jobType: "recruitment.expire_offers" });

/** Referral rewards: pending → eligible after the waiting period; approved → posted to an open payroll period. */
registerJobHandler("recruitment.referral_rewards", async (job) => {
  if (!job.tenantId) return;
  return withSystem(async (tx) => {
    const r = await evaluateReferralRewards(tx, job.tenantId!, todayIn());
    const posted = await postApprovedRewards(tx, job.tenantId!);
    return { ...r, posted };
  }, job.tenantId);
});
registerSchedule({ name: "recruitment.referral_rewards", every: { dailyAtIst: "02:00" }, perTenant: true, jobType: "recruitment.referral_rewards" });
