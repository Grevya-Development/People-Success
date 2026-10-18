import { onDomainEvent, registerJobHandler, registerSchedule } from "../../jobs/registry";
import { postBenefitDeductions } from "./deductions";

registerJobHandler("benefits.post_deductions", async (job) => {
  if (!job.tenantId) return { skipped: "no tenant" };
  return postBenefitDeductions(job.tenantId);
});
registerSchedule({ name: "benefits.post_deductions", every: { dailyAtIst: "06:45" }, perTenant: true, jobType: "benefits.post_deductions" });

onDomainEvent("payroll.period_opened", async (tenantId) => {
  await postBenefitDeductions(tenantId);
});
