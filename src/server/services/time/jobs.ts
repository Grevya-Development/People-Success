import { withSystem } from "../../db/tx";
import { registerJobHandler, registerSchedule } from "../../jobs/registry";
import { todayIn } from "@/lib/format";
import { addDaysIso, eachDate } from "@/lib/leave-math";
import { MAX_RECOMPUTE_DAYS } from "@/lib/validation/time";
import { computeAttendanceRange, processAttendanceDay } from "./attendance";
import { runDailyLeave } from "./leave-accrual";

/** Leave: year-end close (January), accrual for the current period, expiries. Idempotent. */
registerJobHandler("time.leave_daily", async (job) => {
  if (!job.tenantId) return { skipped: "no tenant" };
  const today = (job.payload.date as string | undefined) ?? todayIn();
  return withSystem((tx) => runDailyLeave(tx, job.tenantId!, today), job.tenantId);
});
registerSchedule({ name: "time.leave_daily", every: { dailyAtIst: "00:30" }, perTenant: true, jobType: "time.leave_daily" });

/** Attendance: finalize yesterday for every employee and raise missing-punch exceptions. */
registerJobHandler("time.attendance_nightly", async (job) => {
  if (!job.tenantId) return { skipped: "no tenant" };
  const date = (job.payload.date as string | undefined) ?? addDaysIso(todayIn(), -1);
  return withSystem((tx) => processAttendanceDay(tx, job.tenantId!, date), job.tenantId);
});
registerSchedule({ name: "time.attendance_nightly", every: { dailyAtIst: "01:30" }, perTenant: true, jobType: "time.attendance_nightly" });

/** Queued "Recompute period" chunks for large organizations. */
registerJobHandler("time.attendance_recompute", async (job) => {
  if (!job.tenantId) return { skipped: "no tenant" };
  const { from, to, employeeIds } = job.payload as { from: string; to: string; employeeIds: string[] };
  if (!from || !to || !Array.isArray(employeeIds) || eachDate(from, to).length > MAX_RECOMPUTE_DAYS) return { skipped: "invalid payload" };
  let computed = 0;
  for (const id of employeeIds) {
    computed += (await withSystem((tx) => computeAttendanceRange(tx, job.tenantId!, id, from, to), job.tenantId)).computed;
  }
  return { employees: employeeIds.length, computed };
});
