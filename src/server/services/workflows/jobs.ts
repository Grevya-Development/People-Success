import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { addDays, format } from "date-fns";
import { withSystem } from "../../db/tx";
import { documents, employees } from "../../db/schema";
import { onDomainEvent, registerJobHandler, registerSchedule } from "../../jobs/registry";
import { emitDomainEvent } from "../events";
import { executeRunStep, resumeRunsWaitingFor, startRunsForEvent } from "./engine";
import { todayIn } from "@/lib/format";

// Every domain event may start workflows and may resume runs waiting for it.
onDomainEvent("*", async (tenantId, event, jobId) => {
  await resumeRunsWaitingFor(tenantId, event);
  await startRunsForEvent(tenantId, event, jobId);
});

registerJobHandler("workflow.step", async (job) => {
  const runId = String(job.payload.runId ?? "");
  if (!runId) return { skipped: "no run" };
  return executeRunStep(runId);
});

import "./approval-handlers";

/**
 * Daily scan that turns dates into events: probation ending in 14 days, work
 * anniversaries, and documents expiring in 30 days. Dedupe keys make each
 * milestone fire once.
 */
registerJobHandler("lifecycle.scan", async (job) => {
  const tenantId = job.tenantId;
  if (!tenantId) return;
  const today = todayIn();
  const in14 = format(addDays(new Date(`${today}T00:00:00`), 14), "yyyy-MM-dd");
  const in30 = format(addDays(new Date(`${today}T00:00:00`), 30), "yyyy-MM-dd");
  return withSystem(async (tx) => {
    let emitted = 0;
    const probation = await tx
      .select({ id: employees.id, date: employees.probationEndDate })
      .from(employees)
      .where(
        and(
          eq(employees.tenantId, tenantId),
          eq(employees.status, "active"),
          isNull(employees.confirmationDate),
          isNull(employees.deletedAt),
          gte(employees.probationEndDate, today),
          lte(employees.probationEndDate, in14),
        ),
      );
    for (const e of probation) {
      await emitDomainEvent(tx, tenantId, "milestone.reached", { milestone: "probation_ending", employeeId: e.id, date: e.date }, { dedupeKey: `probation:${e.id}:${e.date}` });
      emitted++;
    }
    const anniversaries = await tx
      .select({ id: employees.id, joiningDate: employees.joiningDate })
      .from(employees)
      .where(
        and(
          eq(employees.tenantId, tenantId),
          inArray(employees.status, ["active", "on_notice"]),
          isNull(employees.deletedAt),
          sql`to_char(${employees.joiningDate}, 'MM-DD') = ${today.slice(5)}`,
          sql`${employees.joiningDate} < ${today}::date`,
        ),
      );
    for (const e of anniversaries) {
      const years = Number(today.slice(0, 4)) - Number(e.joiningDate.slice(0, 4));
      await emitDomainEvent(tx, tenantId, "milestone.reached", { milestone: "work_anniversary", employeeId: e.id, years, date: today }, { dedupeKey: `anniversary:${e.id}:${today}` });
      emitted++;
    }
    const expiring = await tx
      .select({ id: documents.id, title: documents.title, employeeId: documents.employeeId, expiresOn: documents.expiresOn })
      .from(documents)
      .where(and(eq(documents.tenantId, tenantId), isNull(documents.deletedAt), eq(documents.isCurrent, true), eq(documents.expiresOn, in30)));
    for (const d of expiring) {
      await emitDomainEvent(tx, tenantId, "document.expiring", { documentId: d.id, title: d.title, employeeId: d.employeeId, date: d.expiresOn }, { dedupeKey: `doc-expiry:${d.id}:${d.expiresOn}` });
      emitted++;
    }
    return { emitted };
  }, tenantId);
});
registerSchedule({ name: "lifecycle.scan", every: { dailyAtIst: "06:00" }, perTenant: true, jobType: "lifecycle.scan" });
