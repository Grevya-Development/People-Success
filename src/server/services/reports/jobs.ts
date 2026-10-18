import { and, eq, isNotNull, lte } from "drizzle-orm";
import { format, subDays } from "date-fns";
import { db } from "../../db/client";
import { withSystem } from "../../db/tx";
import { savedReports, users } from "../../db/schema";
import { registerJobHandler, registerSchedule } from "../../jobs/registry";
import { contextForUser } from "../../auth/system-context";
import { enqueueEmail, renderEmail, sendNow } from "../email";
import { notify } from "../notifications";
import { logger } from "../../lib/logger";
import { env } from "../../env";
import { nextRunAt, runReport } from "./service";

/**
 * Scheduled reports: run as the report's creator with their CURRENT
 * permissions (revoked access stops delivery), then email recipients a link.
 * Report data is never placed in the email body.
 */
registerJobHandler("reports.deliver_scheduled", async () => {
  const due = await db
    .select()
    .from(savedReports)
    .where(and(isNotNull(savedReports.schedule), lte(savedReports.nextRunAt, new Date())))
    .limit(50);
  let delivered = 0;
  for (const r of due) {
    const ctx = await contextForUser(r.tenantId, r.createdBy);
    const next = nextRunAt(r.schedule!);
    if (!ctx) {
      await db.update(savedReports).set({ nextRunAt: null, schedule: null }).where(eq(savedReports.id, r.id));
      continue;
    }
    try {
      const rangeDays = Number((r.filters as { rangeDays?: number }).rangeDays ?? 30);
      const params = {
        from: format(subDays(new Date(), rangeDays), "yyyy-MM-dd"),
        to: format(new Date(), "yyyy-MM-dd"),
        departmentId: (r.filters as { departmentId?: string | null }).departmentId ?? null,
        locationId: (r.filters as { locationId?: string | null }).locationId ?? null,
      };
      const result = await runReport(ctx, r.reportKey, params, 1);
      const link = `${env().NEXT_PUBLIC_APP_URL}/reports/${r.reportKey}?from=${params.from}&to=${params.to}`;
      const outboxIds = await withSystem(async (tx) => {
        const recips = r.recipients.length ? await tx.select({ id: users.id, email: users.email }).from(users) : [];
        const targets = recips.filter((u) => r.recipients.includes(u.id));
        const ids: (string | null)[] = [];
        for (const u of targets) {
          const mail = renderEmail({
            title: `Scheduled report: ${r.name}`,
            body: [`Your ${r.schedule} report "${result.def.title}" for ${params.from} to ${params.to} is ready.`, "Open it in PeopleSuccess to view or export. Access depends on your permissions."],
            cta: { label: "Open report", href: link },
          });
          ids.push(await enqueueEmail(tx, { tenantId: r.tenantId, to: u.email, template: "scheduled_report", subject: `Report: ${r.name}`, html: mail.html, text: mail.text, dedupeKey: `report:${r.id}:${params.to}:${u.id}` }));
        }
        await notify(tx, { tenantId: r.tenantId, userIds: targets.map((t) => t.id), category: "report", title: `Report ready: ${r.name}`, href: link.replace(env().NEXT_PUBLIC_APP_URL, ""), dedupeKey: `report:${r.id}:${params.to}` });
        await tx.update(savedReports).set({ lastRunAt: new Date(), nextRunAt: next }).where(eq(savedReports.id, r.id));
        return ids;
      }, r.tenantId);
      for (const id of outboxIds) await sendNow(id);
      delivered++;
    } catch (err) {
      logger.warn("reports.scheduled_failed", { reportId: r.id, err });
      await db.update(savedReports).set({ nextRunAt: next }).where(eq(savedReports.id, r.id));
    }
  }
  return { due: due.length, delivered };
});
registerSchedule({ name: "reports.deliver_scheduled", every: { minutes: 15 }, perTenant: false, jobType: "reports.deliver_scheduled" });
