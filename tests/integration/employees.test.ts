import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { employeeSensitive, employees, employmentRecords, jobs, legalEntities } from "@/server/db/schema";
import {
  addCompensation,
  changeJob,
  createEmployee,
  deleteDraftEmployee,
} from "@/server/services/employees/mutations";
import { getCompensationHistory, getSensitive, listEmployees, profileAccess } from "@/server/services/employees/queries";
import { updateSensitive } from "@/server/services/employees/sensitive";
import { submitChangeRequest } from "@/server/services/employees/change-requests";
import { commitImport, previewImport } from "@/server/services/employees/import";
import { decide, pendingApprovalsFor } from "@/server/services/inbox";
import { createEmployeeSchema, employeeListSchema } from "@/lib/validation/employees";
import { decryptField } from "@/server/lib/crypto";
import { todayIn } from "@/lib/format";
import { addMember, contextFor, createOwnedTenant } from "../helpers/fixtures";

const base = (over: Record<string, unknown> = {}) =>
  createEmployeeSchema.parse({
    firstName: "Asha",
    lastName: "Rao",
    workEmail: "",
    personalEmail: "",
    phone: "",
    dateOfBirth: "",
    employeeCode: "",
    legalEntityId: over.legalEntityId,
    employmentType: "full_time",
    workerType: "employee",
    workMode: "onsite",
    joiningDate: "2024-04-01",
    probationMonths: 6,
    noticePeriodDays: 30,
    annualCtc: "",
    ...over,
  });

describe("employees service", () => {
  let org: Awaited<ReturnType<typeof createOwnedTenant>>;
  let other: Awaited<ReturnType<typeof createOwnedTenant>>;
  let le: string;

  beforeAll(async () => {
    org = await createOwnedTenant();
    other = await createOwnedTenant();
    [{ id: le }] = await db.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.tenantId, org.tenant.id));
  });

  it("creates an employee with a generated code, hire record and domain event", async () => {
    const ctx = await contextFor(org.tenant.id, org.user.id);
    const e = await createEmployee(ctx, base({ legalEntityId: le, annualCtc: 1200000 }));
    expect(e.employeeCode).toMatch(/^EMP\d{4}$/);
    expect(e.status).toBe("active");
    expect(e.probationEndDate).toBe("2024-09-30");
    const records = await db.select().from(employmentRecords).where(eq(employmentRecords.employeeId, e.id));
    expect(records).toHaveLength(1);
    expect(records[0].changeType).toBe("hire");
    const events = await db.select().from(jobs).where(eq(jobs.tenantId, org.tenant.id));
    expect(events.some((j) => (j.payload as { event: string }).event === "employee.created")).toBe(true);
    const comp = await getCompensationHistory(ctx, e.id);
    expect(comp[0].annualCtc).toBe(1_200_000_00);
  });

  it("future joining dates create a pre-joining record", async () => {
    const ctx = await contextFor(org.tenant.id, org.user.id);
    const e = await createEmployee(ctx, base({ legalEntityId: le, joiningDate: "2099-01-01" }));
    expect(e.status).toBe("pending");
    await deleteDraftEmployee(ctx, e.id);
    const [row] = await db.select().from(employees).where(eq(employees.id, e.id));
    expect(row.deletedAt).not.toBeNull();
  });

  it("applies job changes effective-dated and schedules future ones", async () => {
    const ctx = await contextFor(org.tenant.id, org.user.id);
    const mgr = await createEmployee(ctx, base({ legalEntityId: le, firstName: "Manager" }));
    const e = await createEmployee(ctx, base({ legalEntityId: le, firstName: "Ravi" }));
    await changeJob(ctx, {
      employeeId: e.id,
      changeType: "manager_change",
      effectiveFrom: "2025-01-01",
      legalEntityId: le,
      departmentId: null,
      designationId: null,
      locationId: null,
      managerId: mgr.id,
      gradeId: null,
      costCenterId: null,
      employmentType: "full_time",
      reason: "Team restructure",
    });
    let [row] = await db.select().from(employees).where(eq(employees.id, e.id));
    expect(row.managerId).toBe(mgr.id);

    await changeJob(ctx, {
      employeeId: e.id,
      changeType: "transfer",
      effectiveFrom: "2099-06-01",
      legalEntityId: le,
      departmentId: null,
      designationId: null,
      locationId: null,
      managerId: null,
      gradeId: null,
      costCenterId: null,
      employmentType: "contract",
      reason: "Planned move",
    });
    [row] = await db.select().from(employees).where(eq(employees.id, e.id));
    expect(row.managerId).toBe(mgr.id); // not yet effective
    expect(row.employmentType).toBe("full_time");
    const history = await db.select().from(employmentRecords).where(eq(employmentRecords.employeeId, e.id));
    expect(history).toHaveLength(3);
    expect(history.filter((h) => h.effectiveTo === null)).toHaveLength(1);

    // A change dated before the current assignment is rejected.
    await expect(
      changeJob(ctx, {
        employeeId: e.id,
        changeType: "transfer",
        effectiveFrom: "2024-06-01",
        legalEntityId: le,
        departmentId: null,
        designationId: null,
        locationId: null,
        managerId: null,
        gradeId: null,
        costCenterId: null,
        employmentType: "full_time",
        reason: "Backdated",
      }),
    ).rejects.toThrow(/after/);
  });

  it("enforces compensation effective dates", async () => {
    const ctx = await contextFor(org.tenant.id, org.user.id);
    const e = await createEmployee(ctx, base({ legalEntityId: le, annualCtc: 1000000 }));
    await addCompensation(ctx, { employeeId: e.id, effectiveFrom: "2025-04-01", annualCtc: 1100000, reason: "revision", notes: null });
    await expect(
      addCompensation(ctx, { employeeId: e.id, effectiveFrom: "2025-01-01", annualCtc: 1200000, reason: "revision", notes: null }),
    ).rejects.toThrow();
    const rows = await getCompensationHistory(ctx, e.id);
    expect(rows.map((r) => r.annualCtc)).toEqual([1_100_000_00, 1_000_000_00]);
  });

  it("encrypts statutory data and masks it on read", async () => {
    const ctx = await contextFor(org.tenant.id, org.user.id);
    const e = await createEmployee(ctx, base({ legalEntityId: le }));
    await updateSensitive(ctx, {
      employeeId: e.id,
      pan: "ABCDE1234F",
      aadhaar: null,
      passport: null,
      uan: null,
      esicNumber: null,
      bankAccount: "50100123456789",
      bankIfsc: "HDFC0001234",
      bankName: "HDFC",
      accountHolderName: "Asha Rao",
      taxRegime: "new",
    });
    const [raw] = await db.select().from(employeeSensitive).where(eq(employeeSensitive.employeeId, e.id));
    expect(raw.panEnc).not.toContain("ABCDE1234F");
    expect(decryptField(raw.panEnc!)).toBe("ABCDE1234F");
    const view = await getSensitive(ctx, e.id);
    expect(view?.pan).toMatch(/•+234F$/);
    expect(JSON.stringify(view)).not.toContain("50100123456789");
  });

  it("scopes visibility: self, team and directory", async () => {
    const owner = await contextFor(org.tenant.id, org.user.id);
    const mgr = await createEmployee(owner, base({ legalEntityId: le, firstName: "Meera" }));
    const report = await createEmployee(owner, base({ legalEntityId: le, firstName: "Kiran", managerId: mgr.id }));
    const stranger = await createEmployee(owner, base({ legalEntityId: le, firstName: "Zed" }));

    const m = await addMember(org.tenant.id, ["people_manager"], { employeeId: mgr.id });
    const mctx = await contextFor(org.tenant.id, m.user.id);
    expect((await profileAccess(mctx, report.id))?.full).toBe(true);
    expect((await profileAccess(mctx, stranger.id))?.full).toBe(false); // directory only
    await expect(getCompensationHistory(mctx, report.id)).rejects.toThrow(); // no compensation.view:team

    const s = await addMember(org.tenant.id, ["contractor"], { employeeId: stranger.id });
    const sctx = await contextFor(org.tenant.id, s.user.id);
    // Contractors get the directory (current employees only), never alumni.
    const directory = await listEmployees(sctx, employeeListSchema.parse({}));
    expect(directory.rows.length).toBeGreaterThan(1);
    await expect(listEmployees(sctx, employeeListSchema.parse({ status: "exited" }))).rejects.toThrow();
    // Without directory access, only the employee's own record is listed.
    const selfOnly = { ...sctx, grants: { "employees.view": "self" as const } };
    const list = await listEmployees(selfOnly, employeeListSchema.parse({}));
    expect(list.rows.map((r) => r.id)).toEqual([stranger.id]);
  });

  it("routes a self-service correction through approval and applies it encrypted", async () => {
    const owner = await contextFor(org.tenant.id, org.user.id);
    const e = await createEmployee(owner, base({ legalEntityId: le, firstName: "Nisha" }));
    const member = await addMember(org.tenant.id, ["employee"], { employeeId: e.id });
    const self = await contextFor(org.tenant.id, member.user.id);
    await submitChangeRequest(self, { employeeId: e.id, reason: "Typo", changes: { lastName: "Iyer", bankAccount: "99887766554433" } });
    await expect(
      submitChangeRequest(self, { employeeId: e.id, reason: "Again", changes: { lastName: "X" } }),
    ).rejects.toThrow(/pending/);

    const pending = await pendingApprovalsFor(owner);
    const req = pending.find((p) => p.subjectType === "data_change_request" && p.title.includes("Nisha"));
    expect(req).toBeDefined();
    await decide(owner, { requestId: req!.requestId, decision: "approve", comment: null });

    const [row] = await db.select().from(employees).where(eq(employees.id, e.id));
    expect(row.lastName).toBe("Iyer");
    expect(row.displayName).toBe("Nisha Iyer");
    const [sens] = await db.select().from(employeeSensitive).where(eq(employeeSensitive.employeeId, e.id));
    expect(decryptField(sens.bankAccountEnc!)).toBe("99887766554433");
  });

  it("imports a CSV atomically and rejects invalid files", async () => {
    const ctx = await contextFor(org.tenant.id, org.user.id);
    const csv = [
      "first_name,last_name,employee_code,work_email,joining_date,department,designation,manager_code",
      "Anil,Kumar,IMP001,anil@x.test,2024-01-15,Engineering,Engineer,",
      "Bela,Shah,IMP002,bela@x.test,2024-02-01,Engineering,Engineer,IMP001",
    ].join("\n");
    const strict = await previewImport(ctx, csv, false);
    expect(strict.invalid).toBe(2); // department/designation missing
    const lenient = await previewImport(ctx, csv, true);
    expect(lenient.invalid).toBe(0);
    expect(lenient.willCreate.departments).toEqual(["Engineering"]);
    await commitImport(ctx, csv, true);
    const imported = await db.select().from(employees).where(eq(employees.tenantId, org.tenant.id));
    const bela = imported.find((r) => r.employeeCode === "IMP002")!;
    const anil = imported.find((r) => r.employeeCode === "IMP001")!;
    expect(bela.managerId).toBe(anil.id);

    const dup = await previewImport(ctx, csv, true);
    expect(dup.rows.every((r) => r.errors.some((e) => e.includes("already exists")))).toBe(true);
    await expect(commitImport(ctx, csv, true)).rejects.toThrow(/errors/);
  });

  it("cannot read or modify another tenant's employees", async () => {
    const ctx = await contextFor(org.tenant.id, org.user.id);
    const target = await createEmployee(ctx, base({ legalEntityId: le, firstName: "Private" }));
    const outsider = await contextFor(other.tenant.id, other.user.id);
    const [otherLe] = await db.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.tenantId, other.tenant.id));
    const list = await listEmployees(outsider, employeeListSchema.parse({ status: "all" }));
    expect(list.rows.find((r) => r.id === target.id)).toBeUndefined();
    await expect(getSensitive(outsider, target.id)).resolves.toBeNull();
    await expect(
      changeJob(outsider, {
        employeeId: target.id,
        changeType: "transfer",
        effectiveFrom: todayIn(),
        legalEntityId: otherLe.id,
        departmentId: null,
        designationId: null,
        locationId: null,
        managerId: null,
        gradeId: null,
        costCenterId: null,
        employmentType: "full_time",
        reason: "Hijack",
      }),
    ).rejects.toThrow(/not found/i);
    // Referencing a foreign legal entity is rejected even for an otherwise valid request.
    await expect(createEmployee(outsider, base({ legalEntityId: le }))).rejects.toThrow(/no longer valid/);
  });
});
