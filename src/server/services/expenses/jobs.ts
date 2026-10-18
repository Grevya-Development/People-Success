import { onDomainEvent, registerJobHandler, registerSchedule } from "../../jobs/registry";
import { postPendingReimbursements } from "./reimbursement";
import "./approval-handlers";

/**
 * Approved payroll-method claims that found no open payroll period are posted
 * once one opens: immediately on "payroll.period_opened", and by a daily
 * sweep as a safety net. Both paths are idempotent (unique source key).
 */
registerJobHandler("expenses.post_reimbursements", async (job) => {
  if (!job.tenantId) return { skipped: "no tenant" };
  return postPendingReimbursements(job.tenantId);
});
registerSchedule({ name: "expenses.post_reimbursements", every: { dailyAtIst: "06:30" }, perTenant: true, jobType: "expenses.post_reimbursements" });

onDomainEvent("payroll.period_opened", async (tenantId) => {
  await postPendingReimbursements(tenantId);
});
