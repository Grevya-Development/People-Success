import { withSystem } from "../../db/tx";
import { registerJobHandler, registerSchedule } from "../../jobs/registry";
import { syncKnowledgeForTenant } from "./knowledge";
import { escalateOverdueTickets } from "./sla";
import { autoCloseResolved } from "./tickets";

registerJobHandler("helpdesk.sla_escalate", async (job) => {
  if (!job.tenantId) return { skipped: "no tenant" };
  return withSystem((tx) => escalateOverdueTickets(tx, job.tenantId!), job.tenantId);
});
registerSchedule({ name: "helpdesk.sla_escalate", every: { minutes: 15 }, perTenant: true, jobType: "helpdesk.sla_escalate" });

registerJobHandler("helpdesk.auto_close", async (job) => {
  if (!job.tenantId) return { skipped: "no tenant" };
  const closed = await withSystem((tx) => autoCloseResolved(tx, job.tenantId!), job.tenantId);
  return { closed };
});
registerSchedule({ name: "helpdesk.auto_close", every: { dailyAtIst: "02:30" }, perTenant: true, jobType: "helpdesk.auto_close" });

/**
 * Nightly knowledge sync: reindex published policies whose version or edit
 * time is newer than their chunks, and drop unpublished sources. KB articles
 * are also reindexed immediately when published or edited.
 */
registerJobHandler("helpdesk.knowledge_sync", async (job) => {
  if (!job.tenantId) return { skipped: "no tenant" };
  return syncKnowledgeForTenant(job.tenantId);
});
registerSchedule({ name: "helpdesk.knowledge_sync", every: { dailyAtIst: "01:30" }, perTenant: true, jobType: "helpdesk.knowledge_sync" });
