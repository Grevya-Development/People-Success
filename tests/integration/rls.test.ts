import { describe, expect, it, beforeAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, compensationRecords, employees, legalEntities, tenants } from "@/server/db/schema";
import { withTenant } from "@/server/db/tx";
import { addMember, contextFor, createOwnedTenant } from "../helpers/fixtures";

/**
 * Database-level tenant isolation. These tests bypass the service layer on
 * purpose: they prove Postgres itself refuses cross-tenant access even if
 * application code forgot a filter.
 */
describe("row level security", () => {
  let a: Awaited<ReturnType<typeof createOwnedTenant>>;
  let b: Awaited<ReturnType<typeof createOwnedTenant>>;
  let empA: string;
  let empB: string;

  beforeAll(async () => {
    a = await createOwnedTenant();
    b = await createOwnedTenant();
    for (const [t, set] of [
      [a, (id: string) => (empA = id)],
      [b, (id: string) => (empB = id)],
    ] as const) {
      const [le] = await db.select().from(legalEntities).where(eq(legalEntities.tenantId, t.tenant.id));
      const [e] = await db
        .insert(employees)
        .values({
          tenantId: t.tenant.id,
          legalEntityId: le.id,
          employeeCode: "EMP0001",
          firstName: "Asha",
          displayName: "Asha Rao",
          joiningDate: "2025-04-01",
          status: "active",
        })
        .returning();
      set(e.id);
    }
  });

  it("only returns rows of the active tenant", async () => {
    const ctx = await contextFor(a.tenant.id, a.user.id);
    const rows = await ctx.db((tx) => tx.select({ id: employees.id }).from(employees));
    expect(rows.map((r) => r.id)).toEqual([empA]);
  });

  it("filters even when the query targets another tenant's id explicitly", async () => {
    const ctx = await contextFor(a.tenant.id, a.user.id);
    const rows = await ctx.db((tx) => tx.select().from(employees).where(eq(employees.id, empB)));
    expect(rows).toHaveLength(0);
  });

  it("sees nothing when the tenant id is forged for a non-member", async () => {
    // User A claims tenant B: app.current_tenant_id() re-checks membership and returns null.
    const rows = await withTenant(
      { tenantId: b.tenant.id, userId: a.user.id, employeeId: null, perms: "employees.view:all" },
      (tx) => tx.select({ id: employees.id }).from(employees),
    );
    expect(rows).toHaveLength(0);
    const t = await withTenant(
      { tenantId: b.tenant.id, userId: a.user.id, employeeId: null, perms: "" },
      (tx) => tx.select().from(tenants),
    );
    expect(t).toHaveLength(0);
  });

  it("rejects inserts into another tenant", async () => {
    const ctx = await contextFor(a.tenant.id, a.user.id);
    const [leB] = await db.select().from(legalEntities).where(eq(legalEntities.tenantId, b.tenant.id));
    await expect(
      ctx.db((tx) =>
        tx.insert(employees).values({
          tenantId: b.tenant.id,
          legalEntityId: leB.id,
          employeeCode: "HACK1",
          firstName: "X",
          displayName: "X",
          joiningDate: "2025-01-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot update or delete another tenant's rows", async () => {
    const ctx = await contextFor(a.tenant.id, a.user.id);
    const updated = await ctx.db((tx) =>
      tx.update(employees).set({ firstName: "Hacked" }).where(eq(employees.id, empB)).returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await ctx.db((tx) => tx.delete(employees).where(eq(employees.id, empB)).returning());
    expect(deleted).toHaveLength(0);
    const [still] = await db.select().from(employees).where(eq(employees.id, empB));
    expect(still.firstName).toBe("Asha");
  });

  it("hides compensation from members without compensation.view", async () => {
    await db.insert(compensationRecords).values({
      tenantId: a.tenant.id,
      employeeId: empA,
      effectiveFrom: "2025-04-01",
      annualCtc: 1_200_000_00,
      reason: "hire",
    });
    const plain = await addMember(a.tenant.id, ["employee"]);
    const ctx = await contextFor(a.tenant.id, plain.user.id);
    const rows = await ctx.db((tx) => tx.select().from(compensationRecords));
    expect(rows).toHaveLength(0);

    const owner = await contextFor(a.tenant.id, a.user.id);
    const ownerRows = await owner.db((tx) => tx.select().from(compensationRecords));
    expect(ownerRows).toHaveLength(1);
  });

  it("applies team scope: a manager sees reports' compensation only with compensation.view:team", async () => {
    const [le] = await db.select().from(legalEntities).where(eq(legalEntities.tenantId, a.tenant.id));
    const [mgr] = await db
      .insert(employees)
      .values({ tenantId: a.tenant.id, legalEntityId: le.id, employeeCode: "EMP0050", firstName: "Mgr", displayName: "Mgr", joiningDate: "2024-01-01" })
      .returning();
    await db.update(employees).set({ managerId: mgr.id }).where(eq(employees.id, empA));
    const member = await addMember(a.tenant.id, ["people_manager"], { employeeId: mgr.id });
    const base = await contextFor(a.tenant.id, member.user.id);
    // people_manager does not grant compensation.view:team by default.
    expect(await base.db((tx) => tx.select().from(compensationRecords))).toHaveLength(0);
    const withTeam = await withTenant(
      { tenantId: a.tenant.id, userId: member.user.id, employeeId: mgr.id, perms: "compensation.view:team" },
      (tx) => tx.select().from(compensationRecords),
    );
    expect(withTeam.map((r) => r.employeeId)).toEqual([empA]);
    await db.update(employees).set({ managerId: null }).where(eq(employees.id, empA));
  });

  it("lets an employee see their own compensation only", async () => {
    const self = await addMember(a.tenant.id, ["employee"], { employeeId: empA });
    const ctx = await contextFor(a.tenant.id, self.user.id);
    const rows = await ctx.db((tx) => tx.select().from(compensationRecords));
    expect(rows.every((r) => r.employeeId === empA)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("keeps the audit log append-only, even for the database owner", async () => {
    const [row] = await db
      .insert(auditLogs)
      .values({ tenantId: a.tenant.id, action: "test", entityType: "test" })
      .returning();
    await expect(db.update(auditLogs).set({ action: "tampered" }).where(eq(auditLogs.id, row.id))).rejects.toThrow();
    await expect(db.delete(auditLogs).where(eq(auditLogs.id, row.id))).rejects.toThrow();
  });

  it("prevents reporting loops", async () => {
    const [le] = await db.select().from(legalEntities).where(eq(legalEntities.tenantId, a.tenant.id));
    const [m] = await db
      .insert(employees)
      .values({ tenantId: a.tenant.id, legalEntityId: le.id, employeeCode: "EMP0099", firstName: "M", displayName: "M", joiningDate: "2025-01-01", managerId: empA })
      .returning();
    const err = await db
      .update(employees)
      .set({ managerId: m.id })
      .where(eq(employees.id, empA))
      .catch((e: { cause?: Error }) => e.cause);
    expect(String((err as Error)?.message)).toMatch(/loop/i);
  });

  it("has RLS enabled on every public table", async () => {
    const rows = await db.execute<{ relname: string }>(sql`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows.map((r) => r.relname)).toEqual([]);
  });
});
