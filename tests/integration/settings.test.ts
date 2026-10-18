import { describe, expect, it, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, employees, grades, legalEntities, tenants } from "@/server/db/schema";
import { withTenant } from "@/server/db/tx";
import { serializeGrants, mergeGrants, ALL_PERMISSIONS } from "@/lib/permissions";
import type { RequestContext } from "@/server/auth/context";
import { getGeneralSettings, updateGeneralSettings } from "@/server/services/settings/general";
import { listLegalEntities, saveLegalEntity } from "@/server/services/settings/legal-entities";
import { saveLocation, removeLocation } from "@/server/services/settings/locations";
import { removeStructureItem, saveDepartment, saveDesignation, saveGrade } from "@/server/services/settings/structure";
import { completeSetup, getSetupStatus, markSetupStep } from "@/server/services/settings/setup";
import { listAuditLogs } from "@/server/services/settings/audit-log";
import { saveApprovalPolicy, listApprovalPolicies } from "@/server/services/settings/approval-policies";
import type { LegalEntityInput } from "@/lib/validation/settings";
import { addMember, contextFor, createOwnedTenant } from "../helpers/fixtures";

const entity = (over: Partial<LegalEntityInput> = {}): LegalEntityInput => ({
  name: `Entity ${Math.random().toString(36).slice(2, 7)}`,
  legalName: "Entity Private Limited",
  stateCode: "KA",
  registrations: {},
  address: {},
  isDefault: false,
  isActive: true,
  ...over,
});

const generalInput = {
  name: "Renamed Org",
  timezone: "Asia/Kolkata",
  dateFormat: "dd/MM/yyyy" as const,
  fiscalYearStartMonth: 4,
  employeeIdPrefix: "acme-",
  employeeIdPadding: 5,
  weekStartsOn: 1,
};

describe("settings services", () => {
  let a: Awaited<ReturnType<typeof createOwnedTenant>>;
  let b: Awaited<ReturnType<typeof createOwnedTenant>>;
  let ctxA: RequestContext;
  let ctxB: RequestContext;

  beforeAll(async () => {
    a = await createOwnedTenant();
    b = await createOwnedTenant();
    ctxA = await contextFor(a.tenant.id, a.user.id);
    ctxB = await contextFor(b.tenant.id, b.user.id);
  });

  describe("general", () => {
    it("updates settings, keeps the setup sub-document and audits", async () => {
      await markSetupStep(ctxA, "time");
      const res = await updateGeneralSettings(ctxA, generalInput);
      expect(res.nameChanged).toBe(true);
      const s = await getGeneralSettings(ctxA);
      expect(s.name).toBe("Renamed Org");
      expect(s.settings.employeeIdFormat).toEqual({ prefix: "ACME-", padding: 5 });
      expect(s.settings.currency).toBe("INR");
      expect(s.settings.setup.completedSteps).toEqual(expect.arrayContaining(["organization", "time"]));
      const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.tenantId, a.tenant.id), eq(auditLogs.action, "settings.general_updated")));
      expect(logs).toHaveLength(1);
      expect(logs[0].changes).toHaveProperty("name");
    });

    it("forbids members without settings.manage", async () => {
      const emp = await addMember(a.tenant.id, ["employee"]);
      const ctx = await contextFor(a.tenant.id, emp.user.id);
      await expect(updateGeneralSettings(ctx, generalInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("legal entities", () => {
    it("keeps exactly one default when switching", async () => {
      const [first] = await listLegalEntities(ctxA);
      expect(first.isDefault).toBe(true);
      const second = await saveLegalEntity(ctxA, entity({ isDefault: true, registrations: { pan: "abcde1234f", tan: "ABCD12345E" } }));
      const rows = await db.select().from(legalEntities).where(eq(legalEntities.tenantId, a.tenant.id));
      expect(rows.filter((r) => r.isDefault).map((r) => r.id)).toEqual([second.id]);
      expect(second.registrations.pan).toBe("ABCDE1234F");

      // The current default cannot simply be unset.
      await expect(saveLegalEntity(ctxA, { ...entity({ name: second.name }), id: second.id, isDefault: false })).rejects.toMatchObject({ code: "INVALID_STATE" });
      // Switching back moves the flag in one transaction.
      await saveLegalEntity(ctxA, { ...entity({ name: first.name, legalName: first.legalName }), id: first.id, isDefault: true });
      const after = await db.select().from(legalEntities).where(and(eq(legalEntities.tenantId, a.tenant.id), eq(legalEntities.isDefault, true)));
      expect(after.map((r) => r.id)).toEqual([first.id]);
    });

    it("validates statutory identifiers", async () => {
      await expect(saveLegalEntity(ctxA, entity({ registrations: { pan: "ABC123" } }))).rejects.toThrow(/PAN/);
      await expect(saveLegalEntity(ctxA, entity({ registrations: { tan: "ABCDE1234F" } }))).rejects.toThrow(/TAN/);
      await expect(saveLegalEntity(ctxA, entity({ registrations: { gstin: "29ABCDE1234F1Y5" } }))).rejects.toThrow(/GSTIN/);
      const ok = await saveLegalEntity(ctxA, entity({ registrations: { gstin: "29abcde1234f1z5", pan: "", cin: "" } }));
      expect(ok.registrations).toEqual({ gstin: "29ABCDE1234F1Z5" });
    });

    it("rejects duplicate names with a friendly conflict", async () => {
      const e = await saveLegalEntity(ctxA, entity());
      await expect(saveLegalEntity(ctxA, entity({ name: e.name }))).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/name/) });
    });

    it("cannot deactivate an entity with active employees, or the default", async () => {
      const e = await saveLegalEntity(ctxA, entity());
      await db.insert(employees).values({
        tenantId: a.tenant.id,
        legalEntityId: e.id,
        employeeCode: `LE${Date.now()}`,
        firstName: "Ravi",
        displayName: "Ravi Kumar",
        joiningDate: "2025-04-01",
        status: "active",
      });
      await expect(saveLegalEntity(ctxA, { ...entity({ name: e.name }), id: e.id, isActive: false })).rejects.toMatchObject({
        code: "INVALID_STATE",
        message: expect.stringMatching(/1 active employee/),
      });
      const [def] = await db.select().from(legalEntities).where(and(eq(legalEntities.tenantId, a.tenant.id), eq(legalEntities.isDefault, true)));
      await expect(saveLegalEntity(ctxA, { ...entity({ name: def.name }), id: def.id, isDefault: true, isActive: false })).rejects.toMatchObject({ code: "INVALID_STATE" });
    });
  });

  describe("cross-tenant isolation", () => {
    it("a user from tenant B cannot edit tenant A records through services", async () => {
      const [entA] = await db.select().from(legalEntities).where(eq(legalEntities.tenantId, a.tenant.id));
      await expect(saveLegalEntity(ctxB, { ...entity(), id: entA.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      const unchanged = await db.select().from(legalEntities).where(eq(legalEntities.id, entA.id));
      expect(unchanged[0].name).toBe(entA.name);
    });

    it("RLS hides tenant A even when B forges A's tenant id with full grants", async () => {
      const grants = mergeGrants([ALL_PERMISSIONS.map((p) => `${p}:all`)]);
      const scope = { tenantId: a.tenant.id, userId: b.user.id, employeeId: null, perms: serializeGrants(grants) };
      const forged: RequestContext = { ...ctxB, tenantId: a.tenant.id, grants, perms: scope.perms, db: (fn) => withTenant(scope, fn) };
      await expect(getGeneralSettings(forged)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(updateGeneralSettings(forged, { ...generalInput, name: "Hacked" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await listLegalEntities(forged)).toEqual([]);
      const [t] = await db.select().from(tenants).where(eq(tenants.id, a.tenant.id));
      expect(t.name).not.toBe("Hacked");
    });
  });

  describe("locations and structure", () => {
    it("validates geofences and deletes unreferenced locations", async () => {
      const base = {
        name: "Bengaluru HQ",
        type: "office" as const,
        legalEntityId: null,
        stateCode: "KA",
        timezone: "Asia/Kolkata",
        address: { city: "Bengaluru", postalCode: "560001" },
        geofenceEnabled: true,
        lat: "12.97",
        lng: "77.59",
        radiusMeters: "200",
        isActive: true,
      };
      await expect(saveLocation(ctxA, { ...base, lat: "123", lng: "77.59" } as never)).rejects.toThrow(/Latitude/);
      await expect(saveLocation(ctxA, { ...base, radiusMeters: "" } as never)).rejects.toThrow(/radius/i);
      const loc = await saveLocation(ctxA, base as never);
      expect(loc.geofence).toEqual({ lat: 12.97, lng: 77.59, radiusMeters: 200 });
      expect((await removeLocation(ctxA, loc.id)).outcome).toBe("deleted");
    });

    it("maps department loops to a friendly error and deactivates referenced items", async () => {
      const parent = await saveDepartment(ctxA, { name: "Engineering", parentId: null, headEmployeeId: null, businessUnitId: null, costCenterId: null, isActive: true });
      const child = await saveDepartment(ctxA, { name: "Platform", parentId: parent.id, headEmployeeId: null, businessUnitId: null, costCenterId: null, isActive: true });
      await expect(
        saveDepartment(ctxA, { id: parent.id, name: "Engineering", parentId: child.id, headEmployeeId: null, businessUnitId: null, costCenterId: null, isActive: true }),
      ).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringMatching(/loop/) });
      // Parent is referenced by its child: deactivated, not deleted.
      expect((await removeStructureItem(ctxA, "departments", parent.id)).outcome).toBe("deactivated");
      expect((await removeStructureItem(ctxA, "departments", child.id)).outcome).toBe("deleted");
    });

    it("stores grade bands in paise and validates max >= min", async () => {
      await expect(saveGrade(ctxA, { code: "L1", name: "Associate", rank: 1, minAnnualCtcRupees: 500000, maxAnnualCtcRupees: 400000 })).rejects.toThrow(/Maximum/);
      const g = await saveGrade(ctxA, { code: "l2", name: "Engineer", rank: 2, minAnnualCtcRupees: "6,00,000" as never, maxAnnualCtcRupees: 1200000 });
      const [row] = await db.select().from(grades).where(eq(grades.id, g.id));
      expect(row.code).toBe("L2");
      expect(row.minAnnualCtc).toBe(60_000_000);
      expect(row.maxAnnualCtc).toBe(120_000_000);
      // Referenced by a designation: grades cannot be deactivated, so deletion is refused.
      await saveDesignation(ctxA, { title: "Software Engineer", jobFamilyId: null, gradeId: g.id, isActive: true });
      await expect(removeStructureItem(ctxA, "grades", g.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    });
  });

  describe("setup wizard", () => {
    it("computes readiness live and completes setup", async () => {
      const before = await getSetupStatus(ctxA);
      expect(before.steps.find((s) => s.key === "structure")!.done).toBe(false); // only an inactive department so far
      await saveDepartment(ctxA, { name: "Finance", parentId: null, headEmployeeId: null, businessUnitId: null, costCenterId: null, isActive: true });
      const status = await getSetupStatus(ctxA);
      const step = (k: string) => status.steps.find((s) => s.key === k)!;
      expect(step("organization").done).toBe(true);
      expect(step("legal_entity").done).toBe(true); // second entity above has PAN + TAN
      expect(step("structure").done).toBe(true);
      expect(step("review").done).toBe(false);
      expect(status.readiness.find((r) => r.key === "employees")?.status).toBe("pass");

      expect((await markSetupStep(ctxA, "payroll")).changed).toBe(true);
      expect((await markSetupStep(ctxA, "payroll")).changed).toBe(false);

      expect((await completeSetup(ctxA)).statusChanged).toBe(true);
      const [t] = await db.select().from(tenants).where(eq(tenants.id, a.tenant.id));
      expect(t.status).toBe("active");
      expect(t.settings.setup.completedAt).toBeTruthy();
      expect(t.settings.setup.completedSteps).toEqual(expect.arrayContaining(["payroll", "review", "structure", "time"]));
      expect((await completeSetup(ctxA)).statusChanged).toBe(false);
    });

    it("lets non-admins read but not mutate", async () => {
      const emp = await addMember(b.tenant.id, ["employee"]);
      const ctx = await contextFor(b.tenant.id, emp.user.id);
      const status = await getSetupStatus(ctx);
      expect(status.canManage).toBe(false);
      await expect(markSetupStep(ctx, "time")).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(completeSetup(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("approval policies and audit log", () => {
    it("increments the version on every save", async () => {
      const groups = await listApprovalPolicies(ctxB);
      const leave = groups.find((g) => g.subjectType === "leave_request")!.policies[0];
      const saved = await saveApprovalPolicy(ctxB, {
        id: leave.id,
        subjectType: "leave_request",
        name: "Long leave: manager then HR",
        priority: 10,
        isActive: true,
        conditions: [{ field: "days", op: "gte", value: "5" }],
        steps: [
          { name: "Manager", kind: "manager" },
          { name: "HR", kind: "role", roleKey: "hr_admin", escalateAfterHours: 24 },
        ],
      });
      expect(saved.version).toBe(leave.version + 1);
      const again = await listApprovalPolicies(ctxB);
      const p = again.find((g) => g.subjectType === "leave_request")!.policies.find((x) => x.id === leave.id)!;
      expect(p.conditions).toEqual({ days: { gte: 5 } });
      expect(p.steps[1]).toEqual({ name: "HR", approver: { kind: "role", roleKey: "hr_admin" }, escalateAfterHours: 24 });
      await expect(
        saveApprovalPolicy(ctxB, { subjectType: "leave_request", name: "Bad", priority: 0, isActive: true, conditions: [], steps: [{ name: "X", kind: "role", roleKey: "nope" }] }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    });

    it("paginates the audit trail by id", async () => {
      const first = await listAuditLogs(ctxA, {});
      expect(first.rows.length).toBeGreaterThan(0);
      const ids = first.rows.map((r) => r.id);
      expect([...ids].sort((x, y) => y - x)).toEqual(ids);
      const filtered = await listAuditLogs(ctxA, { action: "legal_entity" });
      expect(filtered.rows.every((r) => r.action.includes("legal_entity"))).toBe(true);
      const older = await listAuditLogs(ctxA, { cursor: ids[0] });
      expect(older.rows.every((r) => r.id < ids[0])).toBe(true);
      const emp = await addMember(a.tenant.id, ["employee"]);
      await expect(listAuditLogs(await contextFor(a.tenant.id, emp.user.id), {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
