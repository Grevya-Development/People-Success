"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/server/lib/action";
import { requestMeta } from "@/server/auth/context";
import { parseCsv } from "@/lib/csv";
import {
  assignCalendarSchema,
  attendancePolicySchema,
  copyCalendarSchema,
  deviceCsvSchema,
  deviceEventSchema,
  holidayCalendarSchema,
  holidaySchema,
  projectSchema,
  punchSchema,
  recomputeSchema,
  regularizationSchema,
  saveTimesheetSchema,
  shiftAssignmentSchema,
  shiftSchema,
  type DeviceEventInput,
} from "@/lib/validation/time";
import { importDeviceEvents, punch, recomputePeriod } from "@/server/services/time/attendance";
import { saveAttendancePolicy } from "@/server/services/time/attendance-policies";
import {
  assignCalendarToLocation,
  copyHolidayCalendar,
  deleteHoliday,
  deleteHolidayCalendar,
  saveHoliday,
  saveHolidayCalendar,
} from "@/server/services/time/holidays";
import { requestRegularization, withdrawRegularization } from "@/server/services/time/regularizations";
import { assignShift, removeShiftAssignment, saveShift, setDefaultShift } from "@/server/services/time/shifts";
import { recallTimesheet, saveProject, saveTimesheet, submitTimesheet } from "@/server/services/time/timesheets";
import { validation } from "@/server/lib/errors";

const idInput = z.object({ id: z.uuid() });
const done = () => {
  refresh();
  return null;
};

/* Attendance */

export const punchAction = defineAction({ input: punchSchema, permission: "attendance.view", scope: "self" }, async (ctx, input) => {
  const meta = await requestMeta();
  const r = await punch(ctx, input, { ip: meta.ip });
  refresh();
  return r;
});

export const requestRegularizationAction = defineAction({ input: regularizationSchema, permission: "attendance.view", scope: "self" }, async (ctx, input) => {
  const r = await requestRegularization(ctx, input);
  refresh();
  return r;
});

export const withdrawRegularizationAction = defineAction({ input: idInput }, async (ctx, { id }) => {
  await withdrawRegularization(ctx, id);
  return done();
});

export const recomputePeriodAction = defineAction({ input: recomputeSchema, permission: "attendance.manage", scope: "all" }, async (ctx, input) => {
  const r = await recomputePeriod(ctx, input);
  refresh();
  return r;
});

/** Parse a device export: employee_code, occurred_at (ISO 8601 with offset), kind (in/out), external_id, device_id. */
export const importDeviceCsvAction = defineAction({ input: deviceCsvSchema, permission: "attendance.manage", scope: "all" }, async (ctx, input) => {
  const rows = parseCsv(input.csv);
  if (!rows.length) throw validation("The file is empty.", { csv: ["No rows"] });
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const need = ["employee_code", "occurred_at", "kind", "external_id"];
  const missing = need.filter((n) => idx(n) === -1);
  if (missing.length) throw validation(`Missing column(s): ${missing.join(", ")}.`, { csv: [`Header must include ${need.join(", ")}`] });
  if (rows.length > 5001) throw validation("Import at most 5,000 punches at a time.", { csv: ["Too many rows"] });
  const events: DeviceEventInput[] = [];
  const errors: string[] = [];
  rows.slice(1).forEach((r, i) => {
    const parsed = deviceEventSchema.safeParse({
      employeeCode: r[idx("employee_code")],
      occurredAt: r[idx("occurred_at")],
      kind: r[idx("kind")]?.trim().toLowerCase(),
      externalId: r[idx("external_id")],
      deviceId: idx("device_id") >= 0 ? r[idx("device_id")] || null : null,
      source: input.source,
    });
    if (parsed.success) events.push(parsed.data);
    else if (errors.length < 5) errors.push(`Row ${i + 2}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  });
  if (errors.length) throw validation(`Fix these rows and try again. ${errors.join(" ")}`, { csv: errors });
  const r = await importDeviceEvents(ctx, events);
  refresh();
  return r;
});

/* Holidays */

export const saveHolidayCalendarAction = defineAction({ input: holidayCalendarSchema }, async (ctx, input) => {
  const r = await saveHolidayCalendar(ctx, input);
  refresh();
  return { id: r.id };
});

export const deleteHolidayCalendarAction = defineAction({ input: idInput }, async (ctx, { id }) => {
  const r = await deleteHolidayCalendar(ctx, id);
  refresh();
  return r;
});

export const copyHolidayCalendarAction = defineAction({ input: copyCalendarSchema }, async (ctx, input) => {
  const r = await copyHolidayCalendar(ctx, input);
  refresh();
  return { id: r.id };
});

export const saveHolidayAction = defineAction({ input: holidaySchema }, async (ctx, input) => {
  await saveHoliday(ctx, input);
  return done();
});

export const deleteHolidayAction = defineAction({ input: idInput }, async (ctx, { id }) => {
  const r = await deleteHoliday(ctx, id);
  refresh();
  return r;
});

export const assignCalendarAction = defineAction({ input: assignCalendarSchema }, async (ctx, input) => {
  await assignCalendarToLocation(ctx, input);
  return done();
});

/* Shifts and policies */

export const saveShiftAction = defineAction({ input: shiftSchema, permission: "attendance.manage", scope: "all" }, async (ctx, input) => {
  const r = await saveShift(ctx, input);
  refresh();
  return { id: r.id };
});

export const setDefaultShiftAction = defineAction({ input: idInput, permission: "attendance.manage", scope: "all" }, async (ctx, { id }) => {
  await setDefaultShift(ctx, id);
  return done();
});

export const assignShiftAction = defineAction({ input: shiftAssignmentSchema, permission: "attendance.manage", scope: "all" }, async (ctx, input) => {
  await assignShift(ctx, input);
  return done();
});

export const removeShiftAssignmentAction = defineAction({ input: idInput, permission: "attendance.manage", scope: "all" }, async (ctx, { id }) => {
  const r = await removeShiftAssignment(ctx, id);
  refresh();
  return r;
});

export const saveAttendancePolicyAction = defineAction({ input: attendancePolicySchema, permission: "attendance.manage", scope: "all" }, async (ctx, input) => {
  const r = await saveAttendancePolicy(ctx, input);
  refresh();
  return { id: r.id };
});

/* Timesheets */

export const saveProjectAction = defineAction({ input: projectSchema, permission: "attendance.manage", scope: "all" }, async (ctx, input) => {
  const r = await saveProject(ctx, input);
  refresh();
  return { id: r.id };
});

export const saveTimesheetAction = defineAction({ input: saveTimesheetSchema }, async (ctx, input) => {
  const r = await saveTimesheet(ctx, input);
  refresh();
  return r;
});

export const submitTimesheetAction = defineAction({ input: idInput }, async (ctx, { id }) => {
  await submitTimesheet(ctx, id);
  return done();
});

export const recallTimesheetAction = defineAction({ input: idInput }, async (ctx, { id }) => {
  await recallTimesheet(ctx, id);
  return done();
});
