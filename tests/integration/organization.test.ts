import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { departments, designations, employees, employmentRecords, legalEntities, positions } from "@/server/db/schema";
import type { RequestContext } from "@/server/auth/context";
import { listDepartments, orgChart, recentOrgChanges, spanOfControl } from "@/server/services/organization/structure";
import { createPosition, listPositions, updatePosition, workforcePlan } from "@/server/services/organization/positions";
import { createPositionSchema, updatePositionSchema } from "@/lib/validation/organization";
import { addMember, contextFor, createOwnedTenant } from "../helpers/fixtures";

type Tenant = Awaited<ReturnType<typeof createOwnedTenant>>;

describe("organization", () => {
  let t: Tenant;
  let other: Tenant;
  let owner: RequestContext;
  let employee: RequestContext;
  let otherOwner: RequestContext;
  let le: string;
  let eng: string;
  let sales: string;
  let ceo: string;
  let cto: string;
  let dev1: string;
  let dev2: string;
  let solo: string;

  beforeAll(async () => {
    t = await createOwnedTenant();
    other = await createOwnedTenant();
    [{ id: le }] = await db.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.tenantId, t.tenant.id));
    [{ id: eng }, { id: sales }] = await db
      .insert(departments)
      .values([
        { tenantId: t.tenant.id, name: "Engineering", code: "ENG" },
        { tenantId: t.tenant.id, name: "Sales", code: "SAL" },
      ])
      .returning({ id: departments.id });
    const [{ id: desig }] = await db
      .insert(designations)
      .values({ tenantId: t.tenant.id, title: "Engineer" })
      .returning({ id: designations.id });
    const mk = async (code: string, name: string, managerId: string | null, departmentId: string | null, status: "active" | "exited" | "pending" = "active") => {
      const [e] = await db
        .insert(employees)
        .values({
          tenantId: t.tenant.id,
          legalEntityId: le,
          employeeCode: code,
          firstName: name,
          displayName: name,
          joiningDate: "2025-04-01",
          status,
          managerId,
          departmentId,
          designationId: desig,
        })
        .returning();
      return e.id;
    };
    ceo = await mk("E1", "Chitra CEO", null, null);
    cto = await mk("E2", "Tarun CTO", ceo, eng);
    dev1 = await mk("E3", "Dev One", cto, eng);
    dev2 = await mk("E4", "Dev Two", cto, eng, "pending");
    solo = await mk("E5", "Sam Solo", null, sales);
    await mk("E6", "Ex Employee", cto, eng, "exited");
    // A manager link to an exited person surfaces as a root.
    const exitedBoss = await mk("E7", "Gone Boss", null, null, "exited");
    await db.update(employees).set({ managerId: exitedBoss }).where(eq(employees.id, solo));

    await db.insert(employmentRecords).values([
      { tenantId: t.tenant.id, employeeId: dev1, effectiveFrom: "2025-04-01", effectiveTo: "2026-01-01", changeType: "hire", status: "active", employmentType: "full_time", legalEntityId: le, departmentId: sales, managerId: ceo },
      { tenantId: t.tenant.id, employeeId: dev1, effectiveFrom: "2026-01-01", changeType: "transfer", status: "active", employmentType: "full_time", legalEntityId: le, departmentId: eng, managerId: cto },
    ]);

    const empUser = await addMember(t.tenant.id, ["employee"], { employeeId: dev1 });
    owner = await contextFor(t.tenant.id, t.user.id);
    employee = await contextFor(t.tenant.id, empUser.user.id);
    otherOwner = await contextFor(other.tenant.id, other.user.id);
  });

  it("returns the org chart with correct manager links", async () => {
    const nodes = await orgChart(owner);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(nodes).toHaveLength(5); // exited people excluded
    expect(byId.get(cto)).toMatchObject({ managerId: ceo, department: "Engineering", designation: "Engineer", directReports: 2 });
    expect(byId.get(dev1)?.managerId).toBe(cto);
    expect(byId.get(dev2)).toMatchObject({ managerId: cto, status: "pending" });
    expect(byId.get(ceo)).toMatchObject({ managerId: null, directReports: 1 });
    expect(byId.get(solo)?.managerId).toBeNull();
    // Self-service employees hold org.view.
    expect(await orgChart(employee)).toHaveLength(5);
    expect(await orgChart(otherOwner)).toHaveLength(0);
  });

  it("lists departments with headcount and span of control", async () => {
    await db.update(departments).set({ headEmployeeId: cto }).where(eq(departments.id, eng));
    const deps = await listDepartments(owner);
    // dev2 is pending, so Engineering counts CTO + Dev One.
    expect(deps.find((d) => d.id === eng)).toMatchObject({ headcount: 2, headName: "Tarun CTO" });
    expect(deps.find((d) => d.id === sales)).toMatchObject({ headcount: 1, headName: null });

    const span = await spanOfControl(owner);
    expect(span.find((s) => s.managerId === cto)).toMatchObject({ directReports: 2, flag: null });
    expect(span.find((s) => s.managerId === ceo)).toMatchObject({ directReports: 1, flag: "narrow" });
  });

  it("shows recent changes with before and after values to authorized users", async () => {
    const changes = await recentOrgChanges(owner);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      employeeId: dev1,
      changeType: "transfer",
      fromDepartment: "Sales",
      toDepartment: "Engineering",
      fromManager: "Chitra CEO",
      toManager: "Tarun CTO",
    });
    expect(await recentOrgChanges(employee)).toEqual([]);
  });

  it("creates and updates positions with validation", async () => {
    await expect(
      createPosition(employee, createPositionSchema.parse({ code: "P-1", title: "Engineer", status: "open" })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const lead = await createPosition(
      owner,
      createPositionSchema.parse({ code: "eng-lead", title: "Engineering lead", status: "filled", employeeId: cto, departmentId: eng, budgetedAnnualCtc: "45,00,000" }),
    );
    const [stored] = await db.select().from(positions).where(eq(positions.id, lead.id));
    expect(stored).toMatchObject({ code: "ENG-LEAD", budgetedAnnualCtc: 450_000_000, employeeId: cto });

    const dev = await createPosition(
      owner,
      createPositionSchema.parse({ code: "ENG-DEV-1", title: "Developer", status: "open", departmentId: eng, reportsToPositionId: lead.id, budgetedAnnualCtc: 1_200_000 }),
    );
    await createPosition(owner, createPositionSchema.parse({ code: "ENG-DEV-2", title: "Developer", status: "planned", departmentId: eng }));

    // Schema rules.
    expect(createPositionSchema.safeParse({ code: "X", title: "Xx", status: "open", employeeId: dev1 }).success).toBe(false);
    expect(createPositionSchema.safeParse({ code: "X", title: "Xx", status: "filled" }).success).toBe(false);
    expect(createPositionSchema.safeParse({ code: "bad code!", title: "Xx", status: "open" }).success).toBe(false);
    expect(createPositionSchema.safeParse({ code: "X", title: "Xx", status: "open", budgetedAnnualCtc: "-5" }).success).toBe(false);

    // Duplicate code (case-insensitive via normalisation).
    await expect(
      createPosition(owner, createPositionSchema.parse({ code: "eng-dev-1", title: "Dup", status: "open" })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    // Same incumbent twice.
    await expect(
      createPosition(owner, createPositionSchema.parse({ code: "ENG-X", title: "Dup holder", status: "filled", employeeId: cto })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    // Cross-tenant reference.
    const [otherDept] = await db.insert(departments).values({ tenantId: other.tenant.id, name: "Foreign" }).returning();
    await expect(
      createPosition(owner, createPositionSchema.parse({ code: "ENG-Y", title: "Foreign", status: "open", departmentId: otherDept.id })),
    ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { departmentId: ["Not found"] } });
    // Reporting loop: lead -> dev -> lead.
    await expect(
      updatePosition(owner, updatePositionSchema.parse({ id: lead.id, code: "ENG-LEAD", title: "Engineering lead", status: "filled", employeeId: cto, reportsToPositionId: dev.id })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      updatePosition(owner, updatePositionSchema.parse({ id: lead.id, code: "ENG-LEAD", title: "Lead", status: "filled", employeeId: cto, reportsToPositionId: lead.id })),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await updatePosition(owner, updatePositionSchema.parse({ id: dev.id, code: "ENG-DEV-1", title: "Senior developer", status: "frozen", departmentId: eng, reportsToPositionId: lead.id, budgetedAnnualCtc: 1_500_000 }));

    const list = await listPositions(owner);
    expect(list.find((p) => p.id === dev.id)).toMatchObject({ title: "Senior developer", status: "frozen", reportsTo: "ENG-LEAD · Engineering lead", budgetedAnnualCtc: 150_000_000 });
    expect(list.find((p) => p.id === lead.id)).toMatchObject({ incumbent: "Tarun CTO", department: "Engineering" });

    // Budgets are hidden from people without org.manage / compensation.view:all.
    const seen = await listPositions(employee);
    expect(seen).toHaveLength(3);
    expect(seen.every((p) => p.budgetedAnnualCtc === null)).toBe(true);
    expect(await listPositions(otherOwner)).toHaveLength(0);

    const plan = await workforcePlan(owner);
    const engPlan = plan.find((p) => p.departmentId === eng)!;
    // lead (filled) + dev-2 (planned) are approved; dev-1 is frozen.
    expect(engPlan).toMatchObject({ approved: 2, filled: 1, open: 0, planned: 1, frozen: 1, headcount: 2, budgetTotal: 450_000_000 });
    expect((await workforcePlan(employee)).find((p) => p.departmentId === eng)?.budgetTotal).toBeNull();
  });
});
