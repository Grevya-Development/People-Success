import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Helpers (transforms are idempotent: the server re-parses the        */
/* client's parsed output with the same schema).                       */
/* ------------------------------------------------------------------ */

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");
const optionalHhmm = z
  .string()
  .trim()
  .refine((v) => v === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), "Use HH:mm")
  .nullish()
  .transform((v) => (v ? v : null));
const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Choose a date")
  .nullish()
  .transform((v) => (v ? v : null));
const requiredText = (label: string, max = 120) => z.string().trim().min(1, `Enter ${label}`).max(max, `Use at most ${max} characters`);
const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : null));
const optionalId = z
  .union([z.uuid(), z.literal("")])
  .nullish()
  .transform((v) => (v ? v : null));
const minutes = (label: string, max = 1440) => z.coerce.number({ error: `Enter ${label}` }).int("Use whole minutes").min(0).max(max);
const halfDays = z.coerce
  .number({ error: "Enter a number" })
  .refine((v) => Number.isFinite(v) && Math.abs(v * 2 - Math.round(v * 2)) < 1e-9, "Use multiples of 0.5");
const optionalNumber = z
  .union([z.coerce.number(), z.literal("")])
  .nullish()
  .transform((v) => (v === "" || v == null ? null : Number(v)));

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month");

/* ------------------------------------------------------------------ */
/* Holidays                                                            */
/* ------------------------------------------------------------------ */

export const HOLIDAY_TYPES = ["public", "restricted"] as const;

export const holidayCalendarSchema = z.object({
  id: z.uuid().optional(),
  name: requiredText("a calendar name", 80),
  year: z.coerce.number().int().min(2000, "Choose a year").max(2100, "Choose a year"),
  isDefault: z.boolean().default(false),
});

export const holidaySchema = z.object({
  id: z.uuid().optional(),
  calendarId: z.uuid(),
  date: isoDate,
  name: requiredText("the holiday name", 80),
  type: z.enum(HOLIDAY_TYPES).default("public"),
});

export const assignCalendarSchema = z.object({ locationId: z.uuid(), calendarId: optionalId });

export const copyCalendarSchema = z.object({ calendarId: z.uuid(), year: z.coerce.number().int().min(2000).max(2100) });

/* ------------------------------------------------------------------ */
/* Shifts                                                              */
/* ------------------------------------------------------------------ */

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const shiftSchema = z
  .object({
    id: z.uuid().optional(),
    name: requiredText("a shift name", 60),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{1,12}$/, "Use up to 12 letters, digits, - or _"),
    startTime: hhmm,
    endTime: hhmm,
    breakMinutes: minutes("break minutes", 240),
    graceInMinutes: minutes("grace minutes", 180),
    graceOutMinutes: minutes("grace minutes", 180),
    halfDayMinutes: minutes("half-day minutes"),
    fullDayMinutes: minutes("full-day minutes"),
    weeklyOffs: z.array(z.coerce.number().int().min(0).max(6)).max(6, "Leave at least one working day"),
    isFlexible: z.boolean().default(false),
    isNight: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .refine((s) => s.halfDayMinutes <= s.fullDayMinutes, { path: ["halfDayMinutes"], message: "Must not exceed the full-day minutes" })
  .refine((s) => s.isNight || s.endTime > s.startTime, { path: ["endTime"], message: "End after the start, or mark it a night shift" });

export const shiftAssignmentSchema = z
  .object({
    employeeId: z.uuid({ error: "Choose an employee" }),
    shiftId: z.uuid({ error: "Choose a shift" }),
    effectiveFrom: isoDate,
    effectiveTo: optionalDate,
  })
  .refine((a) => !a.effectiveTo || a.effectiveTo > a.effectiveFrom, { path: ["effectiveTo"], message: "Must be after the start date" });

/* ------------------------------------------------------------------ */
/* Policy conditions (shared by attendance and leave policies)         */
/* ------------------------------------------------------------------ */

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern", "consultant", "temporary"] as const;

export const policyConditionsSchema = z.object({
  employmentType: z.array(z.enum(EMPLOYMENT_TYPES)).default([]),
  locationId: z.array(z.uuid()).default([]),
  legalEntityId: z.array(z.uuid()).default([]),
  departmentId: z.array(z.uuid()).default([]),
});
export type PolicyConditionsInput = z.output<typeof policyConditionsSchema>;

/* ------------------------------------------------------------------ */
/* Attendance                                                          */
/* ------------------------------------------------------------------ */

export const punchSchema = z.object({
  kind: z.enum(["in", "out"]),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  accuracyMeters: z.number().min(0).max(100_000).nullish(),
  note: optionalText(200),
});

export const attendancePolicySchema = z.object({
  id: z.uuid().optional(),
  name: requiredText("a policy name", 80),
  priority: z.coerce.number().int().min(0).max(1000).default(0),
  conditions: policyConditionsSchema,
  defaultShiftId: optionalId,
  allowWebCheckIn: z.boolean(),
  requireGeofence: z.boolean(),
  lateMarksPerHalfDay: optionalNumber.refine((v) => v == null || (Number.isInteger(v) && v >= 1 && v <= 31), "Use a whole number from 1 to 31"),
  overtimeEnabled: z.boolean(),
  overtimeMinMinutes: minutes("minimum overtime minutes", 600),
  regularizationWindowDays: z.coerce.number().int().min(0).max(90),
  maxRegularizationsPerMonth: optionalNumber.refine((v) => v == null || (Number.isInteger(v) && v >= 0 && v <= 31), "Use a whole number up to 31"),
  autoMarkAbsentWithoutPunch: z.boolean(),
  isActive: z.boolean().default(true),
});

export const regularizationSchema = z
  .object({
    date: isoDate,
    inTime: optionalHhmm,
    outTime: optionalHhmm,
    reason: requiredText("a reason", 500).min(5, "Explain briefly (at least 5 characters)"),
  })
  .refine((r) => r.inTime || r.outTime, { path: ["inTime"], message: "Enter the check-in or check-out time" })
  .refine((r) => !r.inTime || !r.outTime || r.outTime > r.inTime, { path: ["outTime"], message: "Check-out must be after check-in" });

export const MAX_RECOMPUTE_DAYS = 62;

export const recomputeSchema = z
  .object({ from: isoDate, to: isoDate, employeeId: optionalId })
  .refine((r) => r.to >= r.from, { path: ["to"], message: "Must be on or after the start date" })
  .refine((r) => (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 < MAX_RECOMPUTE_DAYS, {
    path: ["to"],
    message: `Recompute at most ${MAX_RECOMPUTE_DAYS} days at a time`,
  });

export const deviceEventSchema = z.object({
  employeeCode: z.string().trim().min(1).max(40),
  occurredAt: z.iso.datetime({ offset: true }),
  kind: z.enum(["in", "out"]),
  deviceId: z.string().trim().max(80).nullish(),
  externalId: z.string().trim().min(1, "Each event needs an external id").max(120),
  source: z.enum(["biometric", "import"]).default("biometric"),
});
export type DeviceEventInput = z.output<typeof deviceEventSchema>;

export const deviceCsvSchema = z.object({
  csv: z.string().min(1, "Paste the exported punches").max(1_000_000, "Import at most about 1 MB at a time"),
  source: z.enum(["biometric", "import"]).default("biometric"),
});

export const attendanceDayQuery = z.object({ date: isoDate });

/* ------------------------------------------------------------------ */
/* Timesheets                                                          */
/* ------------------------------------------------------------------ */

export const projectSchema = z.object({
  id: z.uuid().optional(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{1,20}$/, "Use up to 20 letters, digits, - or _"),
  name: requiredText("a project name", 120),
  client: optionalText(120),
  isBillable: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const timesheetEntrySchema = z.object({
  date: isoDate,
  projectId: optionalId,
  task: optionalText(200),
  minutes: z.coerce.number().int().min(1).max(1440),
  isBillable: z.boolean().default(false),
  note: optionalText(300),
});

export const saveTimesheetSchema = z.object({
  /** Existing sheet, or omitted to create the week's draft on first save. */
  timesheetId: z.uuid().nullish(),
  weekStart: isoDate,
  entries: z.array(timesheetEntrySchema).max(300),
});

export const timesheetWeekSchema = z.object({ weekStart: isoDate, employeeId: optionalId });

/* ------------------------------------------------------------------ */
/* Leave types and policies                                            */
/* ------------------------------------------------------------------ */

export const LEAVE_CATEGORIES = [
  "annual",
  "earned",
  "casual",
  "sick",
  "comp_off",
  "unpaid",
  "maternity",
  "paternity",
  "bereavement",
  "marriage",
  "custom",
] as const;

/** Leave type colours map onto the existing status tones (no new colours). */
export const LEAVE_TONES = ["info", "success", "warning", "danger", "brand", "neutral"] as const;
export type LeaveTone = (typeof LEAVE_TONES)[number];
export const toneOf = (color: string): LeaveTone => ((LEAVE_TONES as readonly string[]).includes(color) ? (color as LeaveTone) : "info");

export const leaveTypeSchema = z.object({
  id: z.uuid().optional(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{1,10}$/, "Use up to 10 letters, digits or _"),
  name: requiredText("a name", 60),
  category: z.enum(LEAVE_CATEGORIES),
  isPaid: z.boolean(),
  allowHalfDay: z.boolean(),
  allowNegative: z.boolean(),
  maxNegativeDays: halfDays.refine((v) => v >= 0 && v <= 60, "Use 0 to 60"),
  requiresDocumentAfterDays: optionalNumber.refine((v) => v == null || (v >= 0 && v <= 365), "Use 0 to 365"),
  color: z.enum(LEAVE_TONES).default("info"),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
});

export const ACCRUAL_METHODS = ["none", "monthly", "quarterly", "annual_upfront"] as const;

export const blackoutSchema = z
  .object({ from: isoDate, to: isoDate, reason: requiredText("a reason", 120) })
  .refine((b) => b.to >= b.from, { path: ["to"], message: "Must be on or after the start" });

export const leavePolicySchema = z.object({
  id: z.uuid().optional(),
  leaveTypeId: z.uuid({ error: "Choose a leave type" }),
  name: requiredText("a policy name", 80),
  priority: z.coerce.number().int().min(0).max(1000).default(0),
  effectiveFrom: isoDate,
  conditions: policyConditionsSchema,
  accrualMethod: z.enum(ACCRUAL_METHODS),
  daysPerYear: halfDays.refine((v) => v >= 0 && v <= 365, "Use 0 to 365"),
  prorateOnJoining: z.boolean(),
  waitingPeriodDays: z.coerce.number().int().min(0).max(730),
  carryForwardEnabled: z.boolean(),
  carryForwardMaxDays: halfDays.refine((v) => v >= 0 && v <= 365, "Use 0 to 365"),
  carryForwardExpiresAfterMonths: optionalNumber.refine((v) => v == null || (Number.isInteger(v) && v >= 1 && v <= 24), "Use 1 to 24 months"),
  encashmentEnabled: z.boolean(),
  encashmentMaxDaysPerYear: halfDays.refine((v) => v >= 0 && v <= 365, "Use 0 to 365"),
  maxBalance: optionalNumber.refine((v) => v == null || (v >= 0 && v <= 730), "Use 0 to 730"),
  minNoticeDays: z.coerce.number().int().min(0).max(180),
  maxConsecutiveDays: optionalNumber.refine((v) => v == null || (v >= 0.5 && v <= 365), "Use 0.5 to 365"),
  sandwich: z.boolean(),
  blackouts: z.array(blackoutSchema).max(50).default([]),
});

/* ------------------------------------------------------------------ */
/* Leave requests and balances                                         */
/* ------------------------------------------------------------------ */

export const SESSIONS = ["full", "first_half", "second_half"] as const;
export const SESSION_LABELS: Record<(typeof SESSIONS)[number], string> = {
  full: "Full day",
  first_half: "First half",
  second_half: "Second half",
};

export const leaveApplySchema = z.object({
  employeeId: optionalId,
  leaveTypeId: z.uuid({ error: "Choose a leave type" }),
  startDate: isoDate,
  endDate: isoDate,
  startSession: z.enum(SESSIONS).default("full"),
  endSession: z.enum(SESSIONS).default("full"),
  reason: optionalText(1000),
  documentId: optionalId,
});
export type LeaveApplyInput = z.output<typeof leaveApplySchema>;

export const leavePreviewSchema = leaveApplySchema.pick({
  employeeId: true,
  leaveTypeId: true,
  startDate: true,
  endDate: true,
  startSession: true,
  endSession: true,
});

export const leaveCancelSchema = z.object({ requestId: z.uuid(), reason: optionalText(500) });

export const LEAVE_ADJUST_KINDS = ["grant", "adjustment"] as const;

export const leaveAdjustSchema = z.object({
  employeeId: z.uuid({ error: "Choose an employee" }),
  leaveTypeId: z.uuid({ error: "Choose a leave type" }),
  kind: z.enum(LEAVE_ADJUST_KINDS),
  days: halfDays.refine((v) => v !== 0 && Math.abs(v) <= 365, "Use a non-zero number of days"),
  effectiveOn: isoDate,
  expiresOn: optionalDate,
  reason: requiredText("a reason", 300).min(5, "Explain briefly (at least 5 characters)"),
});

export const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;

export const leaveListSchema = z.object({
  status: z.enum(LEAVE_STATUSES).optional().catch(undefined),
  leaveTypeId: z.uuid().optional().catch(undefined),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
});
export type LeaveListQuery = z.output<typeof leaveListSchema>;

export const dateRangeSchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((r) => r.to >= r.from, { path: ["to"], message: "Must be on or after the start date" });
