import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/server/db/client";
import { withSystem } from "@/server/db/tx";
import { attendanceDays, attendanceEvents, employees, legalEntities, locations, regularizations } from "@/server/db/schema";
import { createEmployee } from "@/server/services/employees/mutations";
import { createEmployeeSchema } from "@/lib/validation/employees";
import { decide, pendingApprovalsFor } from "@/server/services/inbox";
import {
  attendanceSummary,
  computeAttendanceDay,
  exportMonthlySummaryCsv,
  ingestDeviceEvents,
  processAttendanceDay,
  punch,
  recomputePeriod,
  teamToday,
} from "@/server/services/time/attendance";
import { requestRegularization } from "@/server/services/time/regularizations";
import { regularizationSchema } from "@/lib/validation/time";
import { addDaysIso, weekdayOf } from "@/lib/leave-math";
import { todayIn } from "@/lib/format";
import { addMember, contextFor, createOwnedTenant } from "../helpers/fixtures";

type Ctx = Awaited<ReturnType<typeof contextFor>>;

const employeeInput = (legalEntityId: string, firstName: string): z.output<typeof createEmployeeSchema> =>
  createEmployeeSchema.parse({
    firstName,
    lastName: "Test",
    workEmail: "",
    personalEmail: "",
    phone: "",
    dateOfBirth: "",
    employeeCode: "",
    legalEntityId,
    employmentType: "full_time",
    workerType: "employee",
    workMode: "onsite",
    joiningDate: "2024-01-01",
    probationMonths: 0,
    noticePeriodDays: 30,
    annualCtc: "",
  });

/** Most recent weekday strictly before today, at least `back` days ago. */
function pastWeekday(back = 1) {
  let d = addDaysIso(todayIn(), -back);
  while (weekdayOf(d) === 0 || weekdayOf(d) === 6) d = addDaysIso(d, -1);
  return d;
}

const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);

describe("attendance", () => {
  let org: Awaited<ReturnType<typeof createOwnedTenant>>;
  let owner: Ctx;
  let emp: Ctx;
  let mgr: Ctx;
  let employeeId: string;
  let employeeCode: string;

  beforeAll(async () => {
    org = await createOwnedTenant();
    owner = await contextFor(org.tenant.id, org.user.id);
    const [{ id: le }] = await db.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.tenantId, org.tenant.id));
    const manager = await createEmployee(owner, employeeInput(le, "Lead"));
    const worker = await createEmployee(owner, employeeInput(le, "Operator"));
    employeeId = worker.id;
    employeeCode = worker.employeeCode;
    const [loc] = await db
      .insert(locations)
      .values({ tenantId: org.tenant.id, name: "Pune office", geofence: { lat: 18.5204, lng: 73.8567, radiusMeters: 200 } })
      .returning();
    await db.update(employees).set({ managerId: manager.id, locationId: loc.id }).where(eq(employees.id, worker.id));
    const m = await addMember(org.tenant.id, ["people_manager"], { employeeId: manager.id });
    const w = await addMember(org.tenant.id, ["employee"], { employeeId: worker.id });
    mgr = await contextFor(org.tenant.id, m.user.id);
    emp = await contextFor(org.tenant.id, w.user.id);
  });

  it("browser punches are self-reported unless inside the geofence; never device-verified", async () => {
    const now = new Date();
    const a = await punch(emp, { kind: "in" }, { now });
    expect(a.verification).toBe("self_reported");
    const far = await punch(emp, { kind: "out", latitude: 19.076, longitude: 72.8777, accuracyMeters: 20 }, { now: new Date(now.getTime() + 61_000) });
    expect(far.verification).toBe("self_reported");
    const near = await punch(emp, { kind: "in", latitude: 18.5206, longitude: 73.8569, accuracyMeters: 15 }, { now: new Date(now.getTime() + 122_000) });
    expect(near.verification).toBe("location_verified");
    // Double click protection.
    await expect(punch(emp, { kind: "in" }, { now: new Date(now.getTime() + 130_000) })).rejects.toThrow(/Already/);
    const rows = await db.select().from(attendanceEvents).where(eq(attendanceEvents.employeeId, employeeId));
    expect(rows.every((r) => r.source === "web" && r.verification !== "device_verified")).toBe(true);
  });

  it("device ingestion is idempotent on (source, externalId) and device-verified", async () => {
    const d = pastWeekday(3);
    const events = [
      { employeeCode, occurredAt: ist(d, "09:20").toISOString(), kind: "in" as const, externalId: `dev-${d}-1`, deviceId: "GATE-1", source: "biometric" as const },
      { employeeCode, occurredAt: ist(d, "18:40").toISOString(), kind: "out" as const, externalId: `dev-${d}-2`, deviceId: "GATE-1", source: "biometric" as const },
      { employeeCode: "NOPE", occurredAt: ist(d, "09:00").toISOString(), kind: "in" as const, externalId: `dev-${d}-x`, source: "biometric" as const },
    ];
    const first = await ingestDeviceEvents(org.tenant.id, events);
    expect(first).toMatchObject({ inserted: 2, duplicates: 0, unknownEmployees: ["NOPE"] });
    const again = await ingestDeviceEvents(org.tenant.id, events);
    expect(again).toMatchObject({ inserted: 0, duplicates: 2 });
    const [day] = await db.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, d)));
    expect([day.status, day.payableFraction, day.lateMinutes]).toEqual(["present", 1, 0]);
    const dev = await db.select().from(attendanceEvents).where(and(eq(attendanceEvents.employeeId, employeeId), eq(attendanceEvents.source, "biometric")));
    expect(dev.every((e) => e.verification === "device_verified")).toBe(true);
  });

  it("a missing punch becomes present after an approved regularization", async () => {
    const d = pastWeekday(1);
    await db.insert(attendanceEvents).values({ tenantId: org.tenant.id, employeeId, occurredAt: ist(d, "09:35"), kind: "in", source: "web" });
    await withSystem((tx) => computeAttendanceDay(tx, org.tenant.id, employeeId, d), org.tenant.id);
    let [day] = await db.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, d)));
    expect([day.status, day.payableFraction]).toEqual(["missing_punch", 0]);

    // Nightly processing raises a deduplicated exception event for it.
    const nightly = await withSystem((tx) => processAttendanceDay(tx, org.tenant.id, d), org.tenant.id);
    expect(nightly.exceptions).toBeGreaterThanOrEqual(1);

    const reg = await requestRegularization(emp, regularizationSchema.parse({ date: d, inTime: "", outTime: "18:45", reason: "Forgot to check out" }));
    const item = (await pendingApprovalsFor(mgr)).find((p) => p.subjectType === "attendance_regularization")!;
    expect(item).toBeTruthy();
    await decide(mgr, { requestId: item.requestId, decision: "approve", comment: null });
    const [r] = await db.select().from(regularizations).where(eq(regularizations.id, reg.id));
    expect(r.status).toBe("approved");
    [day] = await db.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, d)));
    expect([day.status, day.payableFraction, day.isRegularized]).toEqual(["present", 1, true]);
    const corrections = await db.select().from(attendanceEvents).where(and(eq(attendanceEvents.employeeId, employeeId), eq(attendanceEvents.verification, "approved_correction")));
    expect(corrections).toHaveLength(1);

    // Only one open correction per day, and the window is enforced.
    await expect(requestRegularization(emp, regularizationSchema.parse({ date: addDaysIso(todayIn(), -30), inTime: "09:30", outTime: "18:30", reason: "Too old to fix" }))).rejects.toThrow(/within/);
  });

  it("summarizes, recomputes and exports with permission checks", async () => {
    const from = addDaysIso(todayIn(), -10);
    const to = addDaysIso(todayIn(), -1);
    const res = await recomputePeriod(owner, { from, to, employeeId });
    expect(res.computed).toBe(10);
    const s = await attendanceSummary(emp, employeeId, from, to);
    expect(s.totalDays).toBe(10);
    expect(s.present + s.absent + s.weeklyOffs + s.halfDays + s.missingPunch + s.holidays + s.onLeave).toBe(10);
    expect(s.lopDays).toBe(Math.round((10 - s.payableDays) * 100) / 100);
    await expect(recomputePeriod(emp, { from, to, employeeId })).rejects.toThrow();
    await expect(attendanceSummary(mgr, (await db.select().from(employees).where(eq(employees.tenantId, org.tenant.id)).then((r) => r.find((e) => e.firstName === "Lead")!)).id, from, to)).resolves.toBeTruthy();
    await expect(exportMonthlySummaryCsv(emp, todayIn().slice(0, 7))).rejects.toThrow();
    const csv = await exportMonthlySummaryCsv(owner, todayIn().slice(0, 7));
    expect(csv).toContain(employeeCode);
    const team = await teamToday(mgr);
    expect(team.rows.map((r) => r.employeeId)).toContain(employeeId);
    await expect(teamToday(emp)).rejects.toThrow();
  });
});
