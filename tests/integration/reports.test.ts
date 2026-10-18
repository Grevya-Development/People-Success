import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, legalEntities, savedReports } from "@/server/db/schema";
import { createEmployee } from "@/server/services/employees/mutations";
import { REPORTS } from "@/server/services/reports/catalog";
import { availableReports, exportReport, runReport, saveReport } from "@/server/services/reports/service";
import { contextForUser } from "@/server/auth/system-context";
import { createEmployeeSchema } from "@/lib/validation/employees";
import { addMember, contextFor, createOwnedTenant } from "../helpers/fixtures";

describe("reports", () => {
  let tenantId: string;
  let ownerId: string;
  const period = { from: "2024-01-01", to: "2026-12-31" };
  beforeAll(async () => {
    const t = await createOwnedTenant();
    tenantId = t.tenant.id;
    ownerId = t.user.id;
    const ctx = await contextFor(tenantId, ownerId);
    const [le] = await db.select().from(legalEntities).where(eq(legalEntities.tenantId, tenantId));
    await createEmployee(ctx, createEmployeeSchema.parse({ firstName: "Ria", lastName: "=cmd()", legalEntityId: le.id, employmentType: "full_time", workerType: "employee", workMode: "onsite", joiningDate: "2025-05-01", probationMonths: 0, noticePeriodDays: 30 }));
  });

  it("runs every standard report query for an owner", async () => {
    const ctx = await contextFor(tenantId, ownerId);
    expect(availableReports(ctx).length).toBe(REPORTS.length);
    for (const r of REPORTS) {
      const res = await runReport(ctx, r.key, period);
      expect(Array.isArray(res.rows)).toBe(true);
    }
    const dir = await runReport(ctx, "employee_directory", period);
    expect(dir.rows[0]).toMatchObject({ name: "Ria =cmd()" });
  });

  it("exports CSV (formula-safe) and PDF with an audit record", async () => {
    const ctx = await contextFor(tenantId, ownerId);
    const csv = await exportReport(ctx, "employee_directory", period, "csv");
    const text = new TextDecoder().decode(csv.bytes);
    expect(text).toContain("Ria =cmd()"); // inside a cell, not at cell start
    expect(text).not.toMatch(/(^|,)=cmd/m);
    const pdf = await exportReport(ctx, "joiners_and_leavers", period, "pdf");
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe("%PDF-");
    const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, "report.exported")));
    expect(logs.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses reports and exports without permission", async () => {
    const emp = await addMember(tenantId, ["employee"]);
    const ctx = await contextFor(tenantId, emp.user.id);
    expect(availableReports(ctx)).toHaveLength(0);
    await expect(runReport(ctx, "employee_directory", period)).rejects.toThrow();
    const owner = await contextFor(tenantId, ownerId);
    await expect(runReport(owner, "employee_directory", { from: "2026-02-01", to: "2026-01-01" })).rejects.toThrow(/start date/);
  });

  it("saves a scheduled report and resolves the creator's current access", async () => {
    const ctx = await contextFor(tenantId, ownerId);
    const saved = await saveReport(ctx, { name: "Weekly joiners", reportKey: "joiners_and_leavers", filters: { rangeDays: 7 }, schedule: "weekly", recipientUserIds: [ownerId] });
    const [row] = await db.select().from(savedReports).where(eq(savedReports.id, saved.id));
    expect(row.nextRunAt).not.toBeNull();
    const sys = await contextForUser(tenantId, ownerId);
    expect(sys?.grants["reports.export"]).toBe("all");
  });
});
