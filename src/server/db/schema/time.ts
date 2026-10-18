import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pk, tenantRef, timestamps } from "./_helpers";
import { tenants } from "./identity";

/* ------------------------------------------------------------------ */
/* Holidays                                                            */
/* ------------------------------------------------------------------ */

export const holidayCalendars = pgTable(
  "holiday_calendars",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text().notNull(),
    year: smallint().notNull(),
    isDefault: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("holiday_calendars_name_key").on(t.tenantId, t.name, t.year)],
);

export const holidays = pgTable(
  "holidays",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    calendarId: uuid()
      .notNull()
      .references(() => holidayCalendars.id, { onDelete: "cascade" }),
    date: date().notNull(),
    name: text().notNull(),
    /** "public" | "restricted" (optional holiday employees may choose) */
    type: text().notNull().default("public"),
    ...timestamps,
  },
  (t) => [uniqueIndex("holidays_calendar_date_key").on(t.calendarId, t.date)],
);

/* ------------------------------------------------------------------ */
/* Shifts and policies                                                 */
/* ------------------------------------------------------------------ */

export const shifts = pgTable(
  "shifts",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text().notNull(),
    code: text().notNull(),
    startTime: time().notNull(),
    endTime: time().notNull(),
    breakMinutes: smallint().notNull().default(60),
    graceInMinutes: smallint().notNull().default(10),
    graceOutMinutes: smallint().notNull().default(10),
    /** Minimum worked minutes for a half / full day. */
    halfDayMinutes: smallint().notNull().default(240),
    fullDayMinutes: smallint().notNull().default(480),
    /** 0 = Sunday ... 6 = Saturday */
    weeklyOffs: smallint().array().notNull().default(sql`'{0,6}'::smallint[]`),
    isFlexible: boolean().notNull().default(false),
    isNight: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("shifts_code_key").on(t.tenantId, t.code)],
);

export const shiftAssignments = pgTable(
  "shift_assignments",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid().notNull(),
    shiftId: uuid()
      .notNull()
      .references(() => shifts.id),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),
    ...timestamps,
  },
  (t) => [index("shift_assignments_employee_idx").on(t.employeeId, t.effectiveFrom)],
);

export type AttendanceRules = {
  allowWebCheckIn: boolean;
  requireGeofence: boolean;
  /** Count late arrivals beyond grace; every N late marks deduct a half day. */
  lateMarksPerHalfDay: number | null;
  overtimeEnabled: boolean;
  overtimeMinMinutes: number;
  regularizationWindowDays: number;
  maxRegularizationsPerMonth: number | null;
  autoMarkAbsentWithoutPunch: boolean;
};

export const attendancePolicies = pgTable("attendance_policies", {
  id: pk(),
  tenantId: tenantRef().references(() => tenants.id),
  name: text().notNull(),
  conditions: jsonb().$type<Record<string, string | string[]>>().notNull().default({}),
  rules: jsonb().$type<AttendanceRules>().notNull(),
  priority: integer().notNull().default(0),
  version: integer().notNull().default(1),
  isActive: boolean().notNull().default(true),
  ...timestamps,
});

/* ------------------------------------------------------------------ */
/* Attendance events and daily summaries                               */
/* ------------------------------------------------------------------ */

export const punchKind = pgEnum("punch_kind", ["in", "out"]);
export const punchSource = pgEnum("punch_source", ["web", "mobile", "biometric", "import", "regularization", "system"]);
/** Browser punches are self-reported unless location or a device verified them. */
export const punchVerification = pgEnum("punch_verification", ["self_reported", "location_verified", "device_verified", "approved_correction"]);

export const attendanceEvents = pgTable(
  "attendance_events",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    kind: punchKind().notNull(),
    source: punchSource().notNull(),
    verification: punchVerification().notNull().default("self_reported"),
    latitude: doublePrecision(),
    longitude: doublePrecision(),
    accuracyMeters: doublePrecision(),
    deviceId: text(),
    externalId: text(),
    ip: text(),
    note: text(),
    createdBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("attendance_events_employee_idx").on(t.employeeId, t.occurredAt),
    uniqueIndex("attendance_events_external_key")
      .on(t.tenantId, t.source, t.externalId)
      .where(sql`${t.externalId} is not null`),
  ],
);

export const dayStatus = pgEnum("day_status", [
  "present",
  "absent",
  "half_day",
  "on_leave",
  "holiday",
  "weekly_off",
  "missing_punch",
  "not_joined",
]);

export const attendanceDays = pgTable(
  "attendance_days",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid().notNull(),
    date: date().notNull(),
    shiftId: uuid(),
    firstIn: timestamp({ withTimezone: true }),
    lastOut: timestamp({ withTimezone: true }),
    workedMinutes: integer().notNull().default(0),
    lateMinutes: integer().notNull().default(0),
    earlyLeaveMinutes: integer().notNull().default(0),
    overtimeMinutes: integer().notNull().default(0),
    status: dayStatus().notNull(),
    /** Payable fraction for payroll: 1, 0.5 or 0. */
    payableFraction: numeric({ precision: 3, scale: 2, mode: "number" }).notNull().default(1),
    leaveRequestId: uuid(),
    isRegularized: boolean().notNull().default(false),
    lockedByRunId: uuid(),
    computedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("attendance_days_key").on(t.employeeId, t.date),
    index("attendance_days_tenant_date_idx").on(t.tenantId, t.date, t.status),
  ],
);

export const requestStatus = pgEnum("request_status", ["pending", "approved", "rejected", "cancelled"]);

export const regularizations = pgTable(
  "regularizations",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid().notNull(),
    date: date().notNull(),
    requestedIn: timestamp({ withTimezone: true }),
    requestedOut: timestamp({ withTimezone: true }),
    reason: text().notNull(),
    status: requestStatus().notNull().default("pending"),
    decidedBy: uuid(),
    decidedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("regularizations_open_key")
      .on(t.employeeId, t.date)
      .where(sql`${t.status} = 'pending'`),
    index("regularizations_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

/* ------------------------------------------------------------------ */
/* Timesheets                                                          */
/* ------------------------------------------------------------------ */

export const projects = pgTable(
  "projects",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    code: text().notNull(),
    name: text().notNull(),
    client: text(),
    costCenterId: uuid(),
    isBillable: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("projects_code_key").on(t.tenantId, t.code)],
);

export const timesheetStatus = pgEnum("timesheet_status", ["draft", "submitted", "approved", "rejected"]);

export const timesheets = pgTable(
  "timesheets",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid().notNull(),
    weekStart: date().notNull(),
    status: timesheetStatus().notNull().default("draft"),
    totalMinutes: integer().notNull().default(0),
    submittedAt: timestamp({ withTimezone: true }),
    decidedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("timesheets_week_key").on(t.employeeId, t.weekStart)],
);

export const timesheetEntries = pgTable(
  "timesheet_entries",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    timesheetId: uuid()
      .notNull()
      .references(() => timesheets.id, { onDelete: "cascade" }),
    date: date().notNull(),
    projectId: uuid().references(() => projects.id),
    task: text(),
    minutes: integer().notNull(),
    isBillable: boolean().notNull().default(false),
    note: text(),
    ...timestamps,
  },
  (t) => [index("timesheet_entries_sheet_idx").on(t.timesheetId, t.date)],
);

/* ------------------------------------------------------------------ */
/* Leave                                                               */
/* ------------------------------------------------------------------ */

export const leaveCategory = pgEnum("leave_category", [
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
]);

export const leaveTypes = pgTable(
  "leave_types",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    code: text().notNull(),
    name: text().notNull(),
    category: leaveCategory().notNull(),
    isPaid: boolean().notNull().default(true),
    /** "day" | "hour" */
    unit: text().notNull().default("day"),
    allowHalfDay: boolean().notNull().default(true),
    allowNegative: boolean().notNull().default(false),
    maxNegativeDays: numeric({ precision: 6, scale: 2, mode: "number" }).notNull().default(0),
    requiresDocumentAfterDays: numeric({ precision: 6, scale: 2, mode: "number" }),
    color: text().notNull().default("blue"),
    isActive: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("leave_types_code_key").on(t.tenantId, t.code)],
);

export type LeavePolicyRules = {
  accrual: { method: "none" | "monthly" | "quarterly" | "annual_upfront"; daysPerYear: number; prorateOnJoining: boolean };
  /** Days after joining before leave can be used (e.g. probation). */
  waitingPeriodDays: number;
  carryForward: { enabled: boolean; maxDays: number; expiresAfterMonths: number | null };
  encashment: { enabled: boolean; maxDaysPerYear: number };
  maxBalance: number | null;
  minNoticeDays: number;
  maxConsecutiveDays: number | null;
  /** Count weekly offs and holidays between leave days as leave. */
  sandwich: boolean;
  blackouts: { from: string; to: string; reason: string }[];
};

/** Versioned policy per leave type and employee group. Changes apply prospectively. */
export const leavePolicies = pgTable(
  "leave_policies",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    leaveTypeId: uuid()
      .notNull()
      .references(() => leaveTypes.id),
    name: text().notNull(),
    /** e.g. { employmentType: ["full_time"], locationId: "..." }; empty = everyone. */
    conditions: jsonb().$type<Record<string, string | string[]>>().notNull().default({}),
    rules: jsonb().$type<LeavePolicyRules>().notNull(),
    priority: integer().notNull().default(0),
    version: integer().notNull().default(1),
    effectiveFrom: date().notNull(),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [index("leave_policies_type_idx").on(t.tenantId, t.leaveTypeId)],
);

export const leaveTxnKind = pgEnum("leave_txn_kind", [
  "opening",
  "accrual",
  "grant",
  "deduction",
  "reversal",
  "carry_forward",
  "expiry",
  "encashment",
  "adjustment",
]);

/**
 * Append-only leave ledger. Balance = sum(days). `sourceKey` makes every
 * posting idempotent (e.g. "accrual:2026-10", "leave:<requestId>").
 */
export const leaveTransactions = pgTable(
  "leave_transactions",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid().notNull(),
    leaveTypeId: uuid()
      .notNull()
      .references(() => leaveTypes.id),
    kind: leaveTxnKind().notNull(),
    days: numeric({ precision: 7, scale: 2, mode: "number" }).notNull(),
    effectiveOn: date().notNull(),
    expiresOn: date(),
    sourceKey: text().notNull(),
    leaveRequestId: uuid(),
    note: text(),
    createdBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("leave_transactions_source_key").on(t.employeeId, t.leaveTypeId, t.sourceKey),
    index("leave_transactions_employee_idx").on(t.employeeId, t.leaveTypeId, t.effectiveOn),
  ],
);

/** Materialized balance per employee and type, updated in the same transaction as the ledger. */
export const leaveBalances = pgTable(
  "leave_balances",
  {
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid().notNull(),
    leaveTypeId: uuid()
      .notNull()
      .references(() => leaveTypes.id),
    balance: numeric({ precision: 7, scale: 2, mode: "number" }).notNull().default(0),
    pending: numeric({ precision: 7, scale: 2, mode: "number" }).notNull().default(0),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.employeeId, t.leaveTypeId] })],
);

export const leaveStatus = pgEnum("leave_status", ["pending", "approved", "rejected", "cancelled"]);

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid().notNull(),
    leaveTypeId: uuid()
      .notNull()
      .references(() => leaveTypes.id),
    startDate: date().notNull(),
    endDate: date().notNull(),
    /** "full" | "first_half" | "second_half" for the first and last day. */
    startSession: text().notNull().default("full"),
    endSession: text().notNull().default("full"),
    hours: numeric({ precision: 5, scale: 2, mode: "number" }),
    days: numeric({ precision: 6, scale: 2, mode: "number" }).notNull(),
    reason: text(),
    status: leaveStatus().notNull().default("pending"),
    appliedBy: uuid().notNull(),
    documentId: uuid(),
    policyVersion: integer(),
    decidedAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("leave_requests_employee_idx").on(t.employeeId, t.startDate),
    index("leave_requests_tenant_dates_idx").on(t.tenantId, t.startDate, t.endDate),
  ],
);
