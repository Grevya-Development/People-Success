import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { employees, legalEntities } from "@/server/db/schema";
import { createEmployee } from "@/server/services/employees/mutations";
import {
  departmentBreakdown,
  headcountTrend,
  payrollMetrics,
  recruitmentMetrics,
  serviceMetrics,
  talentMetrics,
  timeMetrics,
  workforceMetrics,
} from "@/server/services/analytics/metrics";
import { createEmployeeSchema } from "@/lib/validation/employees";
import { addMember, contextFor, createOwnedTenant } from "../helpers/fixtures";

describe("analytics metrics", () => {
  let tenantId: string;
  let ownerId: string;
  beforeAll(async () => {
    const t = await createOwnedTenant();
    tenantId = t.tenant.id;
    ownerId = t.user.id;
    const ctx = await contextFor(tenantId, ownerId);
    const [le] = await db.select().from(legalEntities).where(eq(legalEntities.tenantId, tenantId));
    const mk = (firstName: string, joiningDate: string) =>
      createEmployee(ctx, createEmployeeSchema.parse({ firstName, legalEntityId: le.id, employmentType: "full_time", workerType: "employee", workMode: "onsite", joiningDate, probationMonths: 0, noticePeriodDays: 30 }));
    await mk("A", "2025-01-10");
    await mk("B", "2025-02-15");
    const c = await mk("C", "2025-03-01");
    await mk("Future", "2099-01-01"); // pre-joining: never counted
    await db.update(employees).set({ status: "exited", exitDate: "2025-03-20" }).where(eq(employees.id, c.id));
  });

  it("computes workforce metrics from the definitions", async () => {
    const ctx = await contextFor(tenantId, ownerId);
    const m = await workforceMetrics(ctx, { from: "2025-02-01", to: "2025-03-31" });
    // Headcount at 2025-02-01: A only = 1; at 2025-03-31: A, B (C exited 03-20) = 2.
    expect(m.headcount).toMatchObject({ kind: "value", value: 2 });
    expect(m.newHires).toMatchObject({ value: 2 }); // B (Feb) and C (Mar)
    expect(m.exits).toMatchObject({ value: 1 });
    expect(m.turnoverRate.kind === "value" && m.turnoverRate.value).toBeCloseTo(1 / 1.5, 5);
    expect(m.headcountGrowth.kind === "value" && m.headcountGrowth.value).toBeCloseTo(1, 5);
    const trend = await headcountTrend(ctx, {}, 12);
    expect(trend?.length).toBe(12);
    expect((await departmentBreakdown(ctx, {}))?.[0]).toMatchObject({ department: "Unassigned" });
  });

  it("runs every metric query without errors and restricts what the viewer cannot see", async () => {
    const owner = await contextFor(tenantId, ownerId);
    const period = { from: "2025-01-01", to: "2025-12-31" };
    for (const fn of [recruitmentMetrics, payrollMetrics, timeMetrics, talentMetrics, serviceMetrics]) {
      await expect(fn(owner, period)).resolves.toBeDefined();
    }
    const employee = await contextFor(tenantId, (await addMember(tenantId, ["employee"])).user.id);
    expect((await workforceMetrics(employee, period)).headcount.kind).toBe("restricted");
    expect((await payrollMetrics(employee, period)).payrollCost.kind).toBe("restricted");
  });
});

describe("dashboard panels", () => {
  it("run for HR, manager and employee views without errors", async () => {
    const { hrOperationsPanel, managerPanel, employeePanel } = await import("@/server/services/analytics/dashboards");
    const t = await createOwnedTenant();
    const ctx = await contextFor(t.tenant.id, t.user.id);
    const [le] = await db.select().from(legalEntities).where(eq(legalEntities.tenantId, t.tenant.id));
    const mk = (firstName: string, managerId: string | null = null) =>
      createEmployee(ctx, createEmployeeSchema.parse({ firstName, legalEntityId: le.id, employmentType: "full_time", workerType: "employee", workMode: "onsite", joiningDate: "2025-01-10", probationMonths: 0, noticePeriodDays: 30, managerId }));
    const mgr = await mk("Manager");
    const rep = await mk("Report", mgr.id);
    const m = await addMember(t.tenant.id, ["people_manager"], { employeeId: mgr.id });
    const r = await addMember(t.tenant.id, ["employee"], { employeeId: rep.id });
    const hr = await hrOperationsPanel(ctx);
    expect(hr?.find((i) => i.key === "joiners")).toBeDefined();
    const mp = await managerPanel(await contextFor(t.tenant.id, m.user.id));
    expect(mp?.find((i) => i.key === "members")?.value).toBe(1);
    const ep = await employeePanel(await contextFor(t.tenant.id, r.user.id));
    expect(ep?.profileCompletion).toBeLessThan(1);
    expect(ep?.missing).toContain("Bank details");
  });
});
