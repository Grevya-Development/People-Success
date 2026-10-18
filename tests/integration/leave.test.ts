import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { withSystem } from "@/server/db/tx";
import { attendanceDays, employees, leaveBalances, leaveRequests, leaveTransactions, leaveTypes, legalEntities } from "@/server/db/schema";
import { createEmployee } from "@/server/services/employees/mutations";
import { createEmployeeSchema } from "@/lib/validation/employees";
import { decide, pendingApprovalsFor } from "@/server/services/inbox";
import { addStandardLeaveTypes } from "@/server/services/time/leave-types";
import { adjustLeaveBalance, balancesFor } from "@/server/services/time/leave-ledger";
import { applyLeave, cancelLeave, getLeaveRequest, leaveUtilization, listLeaveRequests, previewLeave } from "@/server/services/time/leave-requests";
import { runDailyLeave } from "@/server/services/time/leave-accrual";
import { leaveApplySchema, leaveListSchema } from "@/lib/validation/time";
import { addDaysIso, weekdayOf } from "@/lib/leave-math";
import { todayIn } from "@/lib/format";
import { addMember, contextFor, createOwnedTenant } from "../helpers/fixtures";
import type { z } from "zod";

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

/** First Monday at least `minDays` from today (default Sat/Sun weekly offs, no holidays configured). */
function mondayAfter(minDays: number) {
  let d = addDaysIso(todayIn(), minDays);
  while (weekdayOf(d) !== 1) d = addDaysIso(d, 1);
  return d;
}

const apply = (ctx: Ctx, input: Record<string, unknown>) => applyLeave(ctx, leaveApplySchema.parse(input));

async function approveAs(approver: Ctx, subjectId: string, decision: "approve" | "reject" = "approve") {
  const pending = await pendingApprovalsFor(approver);
  const item = pending.find((p) => p.href.endsWith(subjectId));
  if (!item) throw new Error("approval not found for approver");
  return decide(approver, { requestId: item.requestId, decision, comment: decision === "reject" ? "Not this week" : null });
}

describe("leave", () => {
  let org: Awaited<ReturnType<typeof createOwnedTenant>>;
  let other: Awaited<ReturnType<typeof createOwnedTenant>>;
  let owner: Ctx;
  let emp: Ctx;
  let mgr: Ctx;
  let employeeId: string;
  let managerId: string;
  let types: Record<string, string>;
  const mon = mondayAfter(10);

  beforeAll(async () => {
    org = await createOwnedTenant();
    other = await createOwnedTenant();
    owner = await contextFor(org.tenant.id, org.user.id);
    const [{ id: le }] = await db.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.tenantId, org.tenant.id));
    const manager = await createEmployee(owner, employeeInput(le, "Manager"));
    const worker = await createEmployee(owner, employeeInput(le, "Worker"));
    employeeId = worker.id;
    managerId = manager.id;
    await db.update(employees).set({ managerId: manager.id }).where(eq(employees.id, worker.id));
    const m = await addMember(org.tenant.id, ["people_manager"], { employeeId: manager.id });
    const w = await addMember(org.tenant.id, ["employee"], { employeeId: worker.id });
    mgr = await contextFor(org.tenant.id, m.user.id);
    emp = await contextFor(org.tenant.id, w.user.id);

    const res = await addStandardLeaveTypes(owner);
    expect(res.created).toBe(8);
    // Idempotent: a second run adds nothing.
    expect((await addStandardLeaveTypes(owner)).created).toBe(0);
    const rows = await db.select().from(leaveTypes).where(eq(leaveTypes.tenantId, org.tenant.id));
    types = Object.fromEntries(rows.map((r) => [r.code, r.id]));
    await adjustLeaveBalance(owner, { employeeId, leaveTypeId: types.CL, kind: "grant", days: 5, effectiveOn: todayIn(), expiresOn: null, reason: "Opening balance" });
  });

  it("previews days and balance", async () => {
    const p = await previewLeave(emp, { employeeId: null, leaveTypeId: types.CL, startDate: mon, endDate: addDaysIso(mon, 1), startSession: "full", endSession: "full" });
    expect(p.days).toBe(2);
    expect(p.available).toBe(5);
    expect(p.after).toBe(3);
    expect(p.errors).toEqual([]);
  });

  it("apply → approve posts one deduction, clears pending and marks attendance paid", async () => {
    const r = await apply(emp, { leaveTypeId: types.CL, startDate: mon, endDate: addDaysIso(mon, 1), reason: "Family function" });
    expect(r.status).toBe("pending");
    let [bal] = await db.select().from(leaveBalances).where(and(eq(leaveBalances.employeeId, employeeId), eq(leaveBalances.leaveTypeId, types.CL)));
    expect(bal.pending).toBe(2);

    await approveAs(mgr, r.id);
    const [req] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, r.id));
    expect(req.status).toBe("approved");
    const txns = await db.select().from(leaveTransactions).where(eq(leaveTransactions.leaveRequestId, r.id));
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ kind: "deduction", days: -2, sourceKey: `leave:${r.id}` });
    [bal] = await db.select().from(leaveBalances).where(and(eq(leaveBalances.employeeId, employeeId), eq(leaveBalances.leaveTypeId, types.CL)));
    expect(bal.balance).toBe(3);
    expect(bal.pending).toBe(0);
    const days = await db.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.leaveRequestId, r.id)));
    expect(days.map((d) => [d.date, d.status, d.payableFraction]).sort()).toEqual([
      [mon, "on_leave", 1],
      [addDaysIso(mon, 1), "on_leave", 1],
    ]);
  });

  it("unpaid leave makes the day non-payable (half day → 0.5) without touching any balance", async () => {
    const wed = addDaysIso(mon, 2);
    const thu = addDaysIso(mon, 3);
    const full = await apply(emp, { leaveTypeId: types.LOP, startDate: wed, endDate: wed });
    const half = await apply(emp, { leaveTypeId: types.LOP, startDate: thu, endDate: thu, startSession: "first_half", endSession: "first_half" });
    await approveAs(mgr, full.id);
    await approveAs(mgr, half.id);
    const [w] = await db.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, wed)));
    expect([w.status, w.payableFraction]).toEqual(["on_leave", 0]);
    const [t] = await db.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, thu)));
    // Unpaid first half + (future, provisional) worked second half.
    expect([t.status, t.payableFraction]).toEqual(["on_leave", 0.5]);
    const lop = await db.select().from(leaveTransactions).where(and(eq(leaveTransactions.employeeId, employeeId), eq(leaveTransactions.leaveTypeId, types.LOP)));
    expect(lop).toHaveLength(0);
  });

  it("rejects overlapping requests, but allows the complementary half day", async () => {
    await expect(apply(emp, { leaveTypeId: types.CL, startDate: mon, endDate: mon, startSession: "first_half", endSession: "first_half" })).rejects.toThrow(/overlaps/);
    const thu = addDaysIso(mon, 3);
    const ok = await apply(emp, { leaveTypeId: types.CL, startDate: thu, endDate: thu, startSession: "second_half", endSession: "second_half" });
    expect(ok.days).toBe(0.5);
    await cancelLeave(emp, ok.id);
  });

  it("rejects requests above the available balance", async () => {
    await expect(apply(emp, { leaveTypeId: types.EL, startDate: addDaysIso(mon, 7), endDate: addDaysIso(mon, 7) })).rejects.toThrow(/Insufficient/);
    // CL: 3 left. Three days next week minus... a 4-day request exceeds max consecutive and balance.
    await expect(apply(emp, { leaveTypeId: types.CL, startDate: addDaysIso(mon, 7), endDate: addDaysIso(mon, 10) })).rejects.toThrow();
  });

  it("cancelling approved leave twice posts exactly one reversal and frees the days", async () => {
    const [req] = await db
      .select()
      .from(leaveRequests)
      .where(and(eq(leaveRequests.employeeId, employeeId), eq(leaveRequests.leaveTypeId, types.CL), eq(leaveRequests.status, "approved")));
    const first = await cancelLeave(emp, req.id, "Plans changed");
    const second = await cancelLeave(emp, req.id, "Again");
    expect(first.reversed).toBe(true);
    expect(second.reversed).toBe(false);
    const rev = await db.select().from(leaveTransactions).where(and(eq(leaveTransactions.leaveRequestId, req.id), eq(leaveTransactions.kind, "reversal")));
    expect(rev).toHaveLength(1);
    expect(rev[0].days).toBe(2);
    const cards = await balancesFor(emp, employeeId);
    expect(cards.find((c) => c.code === "CL")).toMatchObject({ balance: 5, pending: 0 });
    // Future working days with no leave have no attendance row any more.
    const days = await db.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, mon)));
    expect(days).toHaveLength(0);
  });

  it("rejection releases pending days", async () => {
    const r = await apply(emp, { leaveTypeId: types.CL, startDate: addDaysIso(mon, 7), endDate: addDaysIso(mon, 7) });
    await approveAs(mgr, r.id, "reject");
    const [req] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, r.id));
    expect(req.status).toBe("rejected");
    const [bal] = await db.select().from(leaveBalances).where(and(eq(leaveBalances.employeeId, employeeId), eq(leaveBalances.leaveTypeId, types.CL)));
    expect(bal.pending).toBe(0);
  });

  it("accrual job is idempotent", async () => {
    const today = todayIn();
    await withSystem((tx) => runDailyLeave(tx, org.tenant.id, today), org.tenant.id);
    await withSystem((tx) => runDailyLeave(tx, org.tenant.id, today), org.tenant.id);
    const key = `accrual:${today.slice(0, 7)}`;
    const el = await db
      .select()
      .from(leaveTransactions)
      .where(and(eq(leaveTransactions.employeeId, employeeId), eq(leaveTransactions.leaveTypeId, types.EL), eq(leaveTransactions.sourceKey, key)));
    expect(el).toHaveLength(1);
    expect(el[0].days).toBe(1.5);
    const sl = await db
      .select()
      .from(leaveTransactions)
      .where(and(eq(leaveTransactions.employeeId, employeeId), eq(leaveTransactions.leaveTypeId, types.SL), eq(leaveTransactions.sourceKey, `accrual:${today.slice(0, 4)}`)));
    expect(sl).toHaveLength(1);
    expect(sl[0].days).toBe(12);
    const [bal] = await db.select().from(leaveBalances).where(and(eq(leaveBalances.employeeId, employeeId), eq(leaveBalances.leaveTypeId, types.EL)));
    expect(bal.balance).toBe(1.5);
  });

  it("HR records leave on behalf (approved directly) and team views respect scope", async () => {
    const r = await apply(owner, { employeeId, leaveTypeId: types.SL, startDate: addDaysIso(mon, 14), endDate: addDaysIso(mon, 14) });
    expect(r.status).toBe("approved");
    // The manager sees it through team scope; the employee cannot list others.
    const team = await listLeaveRequests(mgr, leaveListSchema.parse({}));
    expect(team.rows.some((x) => x.id === r.id)).toBe(true);
    await expect(listLeaveRequests(emp, leaveListSchema.parse({}))).rejects.toThrow();
    await expect(apply(emp, { employeeId: managerId, leaveTypeId: types.CL, startDate: mon, endDate: mon })).rejects.toThrow(/on behalf/);
  });

  it("reports utilization by type and department inside the range only", async () => {
    // Approved so far: LOP full day (wed) + LOP half day (thu) + SL recorded by HR.
    const u = await leaveUtilization(owner, mon, addDaysIso(mon, 3));
    expect(u.byType.find((t) => t.code === "LOP")?.days).toBe(1.5);
    expect(u.byType.some((t) => t.code === "SL")).toBe(false); // SL was outside the range
    expect(u.totalDays).toBe(1.5);
    await expect(leaveUtilization(emp, mon, mon)).rejects.toThrow();
  });

  it("isolates tenants: another tenant cannot see or approve this leave", async () => {
    const r = await apply(emp, { leaveTypeId: types.CL, startDate: addDaysIso(mon, 21), endDate: addDaysIso(mon, 21) });
    const outsider = await contextFor(other.tenant.id, other.user.id);
    await expect(getLeaveRequest(outsider, r.id)).rejects.toThrow(/not found/i);
    const theirs = await listLeaveRequests(outsider, leaveListSchema.parse({}));
    expect(theirs.rows.some((x) => x.id === r.id)).toBe(false);
    const pending = await pendingApprovalsFor(mgr);
    const item = pending.find((p) => p.href.endsWith(r.id))!;
    await expect(decide(outsider, { requestId: item.requestId, decision: "approve", comment: null })).rejects.toThrow(/not found/i);
    await expect(cancelLeave(outsider, r.id)).rejects.toThrow(/not found/i);
    const [req] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, r.id));
    expect(req.status).toBe("pending");
  });
});
