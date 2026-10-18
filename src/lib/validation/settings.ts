import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Helpers. Transforms are idempotent so the server can re-parse the   */
/* client's parsed output with the same schema.                        */
/* ------------------------------------------------------------------ */

const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .optional()
    .transform((v) => (v ? v : undefined));

const requiredText = (label: string, max = 120) =>
  z.string().trim().min(1, `Enter ${label}`).max(max, `Use at most ${max} characters`);

/** Optional identifier: empty is allowed, otherwise upper-cased and checked against `re`. */
const optionalCode = (re: RegExp, message: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || re.test(v), message)
    .optional()
    .transform((v) => (v ? v : undefined));

const optionalId = z.uuid().nullable().optional().transform((v) => v ?? null);

export const stateCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => v === "" || /^[A-Z]{2}$/.test(v), "Choose a state")
  .nullable()
  .optional()
  .transform((v) => (v ? v : null));

/* ------------------------------------------------------------------ */
/* General                                                             */
/* ------------------------------------------------------------------ */

export const DATE_FORMATS = ["dd MMM yyyy", "dd/MM/yyyy", "dd-MM-yyyy", "MM/dd/yyyy", "yyyy-MM-dd"] as const;

export const COMMON_TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Kathmandu",
  "Asia/Dhaka",
  "Asia/Colombo",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "UTC",
] as const;

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const timezone = z.string().trim().min(1, "Choose a time zone").refine(isValidTimeZone, "Unknown time zone");

export const generalSettingsSchema = z.object({
  name: requiredText("the company name", 120).min(2, "Enter the company name"),
  timezone,
  dateFormat: z.enum(DATE_FORMATS),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
  employeeIdPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .max(10, "Use at most 10 characters")
    .regex(/^[A-Z0-9/-]*$/, "Use letters, digits, / or -"),
  employeeIdPadding: z.coerce.number().int().min(1, "At least 1 digit").max(10, "At most 10 digits"),
  weekStartsOn: z.coerce.number().int().min(0).max(1),
});
export type GeneralSettingsInput = z.input<typeof generalSettingsSchema>;

export function previewEmployeeCode(prefix: string, padding: number, n = 42) {
  const p = Number.isFinite(padding) ? Math.min(Math.max(Math.trunc(padding), 1), 10) : 4;
  return `${prefix}${String(n).padStart(p, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Legal entities                                                      */
/* ------------------------------------------------------------------ */

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/;
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const CIN_RE = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;

export const addressSchema = z.object({
  line1: optionalText(200),
  line2: optionalText(200),
  city: optionalText(100),
  postalCode: z
    .string()
    .trim()
    .refine((v) => v === "" || /^[1-9][0-9]{5}$/.test(v), "Enter a 6-digit PIN code")
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type AddressInput = z.input<typeof addressSchema>;

export const legalEntitySchema = z.object({
  id: z.uuid().optional(),
  name: requiredText("a display name", 120),
  legalName: requiredText("the registered legal name", 200),
  stateCode: stateCodeSchema,
  registrations: z.object({
    pan: optionalCode(PAN_RE, "PAN must look like AAAAA9999A"),
    tan: optionalCode(TAN_RE, "TAN must look like AAAA99999A"),
    gstin: optionalCode(GSTIN_RE, "GSTIN must be 15 characters, e.g. 29AAAAA9999A1Z5"),
    cin: optionalCode(CIN_RE, "CIN must be 21 characters, e.g. U72200KA2020PTC123456"),
    pfEstablishmentCode: optionalCode(/^[A-Z0-9/]{5,30}$/, "Use 5-30 letters, digits or /"),
    esiEmployerCode: optionalCode(/^[0-9]{17}$/, "ESI employer code is 17 digits"),
    ptRegistration: optionalCode(/^[A-Z0-9/-]{3,30}$/, "Use 3-30 letters, digits, / or -"),
    lwfRegistration: optionalCode(/^[A-Z0-9/-]{3,30}$/, "Use 3-30 letters, digits, / or -"),
  }),
  address: addressSchema,
  isDefault: z.boolean(),
  isActive: z.boolean(),
});
export type LegalEntityInput = z.input<typeof legalEntitySchema>;

/* ------------------------------------------------------------------ */
/* Locations                                                           */
/* ------------------------------------------------------------------ */

export const LOCATION_TYPES = ["office", "branch", "site", "remote"] as const;

const optionalNumber = (min: number, max: number, label: string) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (v === undefined || v === null || v === "") return null;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `${label} must be between ${min} and ${max}` });
        return z.NEVER;
      }
      return n;
    });

export const locationSchema = z
  .object({
    id: z.uuid().optional(),
    name: requiredText("a location name", 120),
    code: optionalText(20),
    type: z.enum(LOCATION_TYPES),
    legalEntityId: optionalId,
    stateCode: stateCodeSchema,
    timezone,
    address: addressSchema,
    geofenceEnabled: z.boolean(),
    lat: optionalNumber(-90, 90, "Latitude"),
    lng: optionalNumber(-180, 180, "Longitude"),
    radiusMeters: optionalNumber(10, 100_000, "Radius"),
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (!v.geofenceEnabled) return;
    if (v.lat == null) ctx.addIssue({ code: "custom", path: ["lat"], message: "Enter a latitude" });
    if (v.lng == null) ctx.addIssue({ code: "custom", path: ["lng"], message: "Enter a longitude" });
    if (v.radiusMeters == null) ctx.addIssue({ code: "custom", path: ["radiusMeters"], message: "Enter a radius" });
  });
export type LocationInput = z.input<typeof locationSchema>;

/* ------------------------------------------------------------------ */
/* Structure                                                           */
/* ------------------------------------------------------------------ */

export const STRUCTURE_KINDS = [
  "departments",
  "designations",
  "grades",
  "job_families",
  "cost_centers",
  "business_units",
  "teams",
] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];

export const STRUCTURE_LABELS: Record<StructureKind, { plural: string; singular: string }> = {
  departments: { plural: "Departments", singular: "department" },
  designations: { plural: "Designations", singular: "designation" },
  grades: { plural: "Grades", singular: "grade" },
  job_families: { plural: "Job families", singular: "job family" },
  cost_centers: { plural: "Cost centers", singular: "cost center" },
  business_units: { plural: "Business units", singular: "business unit" },
  teams: { plural: "Teams", singular: "team" },
};

export const departmentSchema = z.object({
  id: z.uuid().optional(),
  name: requiredText("a department name"),
  code: optionalText(20),
  parentId: optionalId,
  headEmployeeId: optionalId,
  businessUnitId: optionalId,
  costCenterId: optionalId,
  isActive: z.boolean(),
});
export type DepartmentInput = z.input<typeof departmentSchema>;

export const designationSchema = z.object({
  id: z.uuid().optional(),
  title: requiredText("a title"),
  jobFamilyId: optionalId,
  gradeId: optionalId,
  description: optionalText(500),
  isActive: z.boolean(),
});
export type DesignationInput = z.input<typeof designationSchema>;

/** Whole rupees (no paise) for CTC bands; stored as paise by the service. */
const optionalRupees = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (v === undefined || v === null || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000_000) {
      ctx.addIssue({ code: "custom", message: "Enter whole rupees between 0 and 1,00,00,00,000" });
      return z.NEVER;
    }
    return n;
  });

export const gradeSchema = z
  .object({
    id: z.uuid().optional(),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(1, "Enter a code")
      .max(20)
      .regex(/^[A-Z0-9_-]+$/, "Use letters, digits, - or _"),
    name: requiredText("a name"),
    rank: z.coerce.number().int().min(0).max(1000),
    minAnnualCtcRupees: optionalRupees,
    maxAnnualCtcRupees: optionalRupees,
  })
  .refine((v) => v.minAnnualCtcRupees == null || v.maxAnnualCtcRupees == null || v.maxAnnualCtcRupees >= v.minAnnualCtcRupees, {
    path: ["maxAnnualCtcRupees"],
    message: "Maximum must be at least the minimum",
  });
export type GradeInput = z.input<typeof gradeSchema>;

export const jobFamilySchema = z.object({
  id: z.uuid().optional(),
  name: requiredText("a name"),
  description: optionalText(500),
});
export type JobFamilyInput = z.input<typeof jobFamilySchema>;

export const costCenterSchema = z.object({
  id: z.uuid().optional(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, "Enter a code")
    .max(20)
    .regex(/^[A-Z0-9_/-]+$/, "Use letters, digits, -, _ or /"),
  name: requiredText("a name"),
  legalEntityId: optionalId,
  isActive: z.boolean(),
});
export type CostCenterInput = z.input<typeof costCenterSchema>;

export const businessUnitSchema = z.object({
  id: z.uuid().optional(),
  name: requiredText("a name"),
  code: optionalText(20),
  headEmployeeId: optionalId,
  isActive: z.boolean(),
});
export type BusinessUnitInput = z.input<typeof businessUnitSchema>;

export const teamSchema = z.object({
  id: z.uuid().optional(),
  name: requiredText("a name"),
  departmentId: optionalId,
  leadEmployeeId: optionalId,
  isActive: z.boolean(),
});
export type TeamInput = z.input<typeof teamSchema>;

export const structureRefSchema = z.object({ kind: z.enum(STRUCTURE_KINDS), id: z.uuid() });

/* ------------------------------------------------------------------ */
/* Approval policies                                                   */
/* ------------------------------------------------------------------ */

export const APPROVER_KINDS = ["manager", "manager_of_manager", "department_head", "role", "user"] as const;
export const APPROVER_LABELS: Record<(typeof APPROVER_KINDS)[number], string> = {
  manager: "Reporting manager",
  manager_of_manager: "Manager's manager",
  department_head: "Department head",
  role: "Anyone with a role",
  user: "A specific person",
};

export const CONDITION_OPS = ["eq", "gte", "lte", "in"] as const;
export const CONDITION_OP_LABELS: Record<(typeof CONDITION_OPS)[number], string> = {
  eq: "equals",
  gte: "is at least",
  lte: "is at most",
  in: "is one of",
};
export const CONDITION_FIELD_SUGGESTIONS = ["departmentId", "locationId", "legalEntityId", "amount", "days", "leaveTypeCode"];

export const approvalStepSchema = z
  .object({
    name: requiredText("a step name", 80),
    kind: z.enum(APPROVER_KINDS),
    roleKey: z.string().trim().optional().transform((v) => (v ? v : undefined)),
    userId: z.uuid().nullable().optional().transform((v) => v ?? undefined),
    escalateAfterHours: z
      .union([z.string(), z.number()])
      .optional()
      .nullable()
      .transform((v, ctx) => {
        if (v === undefined || v === null || v === "") return undefined;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 720) {
          ctx.addIssue({ code: "custom", message: "Use 1 to 720 hours" });
          return z.NEVER;
        }
        return n;
      }),
  })
  .superRefine((s, ctx) => {
    if (s.kind === "role" && !s.roleKey) ctx.addIssue({ code: "custom", path: ["roleKey"], message: "Choose a role" });
    if (s.kind === "user" && !s.userId) ctx.addIssue({ code: "custom", path: ["userId"], message: "Choose a person" });
  });

export const approvalConditionSchema = z
  .object({
    field: z
      .string()
      .trim()
      .min(1, "Enter a field")
      .max(60)
      .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Use letters, digits and _"),
    op: z.enum(CONDITION_OPS),
    value: z.string().trim().min(1, "Enter a value").max(400),
  })
  .superRefine((c, ctx) => {
    if ((c.op === "gte" || c.op === "lte") && !Number.isFinite(Number(c.value))) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a number" });
    }
  });
export type ApprovalConditionInput = z.input<typeof approvalConditionSchema>;

export const approvalPolicySchema = z
  .object({
    id: z.uuid().optional(),
    subjectType: z.string().trim().min(1).max(60).regex(/^[a-z_]+$/),
    name: requiredText("a policy name", 120),
    priority: z.coerce.number().int().min(-1000).max(1000),
    isActive: z.boolean(),
    conditions: z.array(approvalConditionSchema).max(10),
    steps: z.array(approvalStepSchema).min(1, "Add at least one step").max(10, "Use at most 10 steps"),
  })
  .superRefine((p, ctx) => {
    const seen = new Map<string, Set<string>>();
    p.conditions.forEach((c, i) => {
      const ops = seen.get(c.field) ?? new Set<string>();
      const clash = ops.has(c.op) || (c.op === "eq" && ops.size > 0) || ops.has("eq") || (c.op === "in" && ops.size > 0) || ops.has("in");
      if (clash) ctx.addIssue({ code: "custom", path: ["conditions", i, "field"], message: "This field already has a condition" });
      ops.add(c.op);
      seen.set(c.field, ops);
    });
  });
export type ApprovalPolicyInput = z.input<typeof approvalPolicySchema>;
export type ApprovalPolicyValues = z.output<typeof approvalPolicySchema>;

/** Convert form condition rows to the JSON evaluated by the approvals engine. */
export function conditionsToJson(rows: z.output<typeof approvalConditionSchema>[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const scalar = (v: string): string | number | boolean => {
    if (v === "true") return true;
    if (v === "false") return false;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  };
  for (const r of rows) {
    if (r.op === "eq") out[r.field] = scalar(r.value);
    else if (r.op === "in") {
      out[r.field] = { in: r.value.split(",").map((s) => s.trim()).filter(Boolean).map(scalar) };
    } else {
      const prev = (out[r.field] as Record<string, unknown> | undefined) ?? {};
      out[r.field] = { ...prev, [r.op]: Number(r.value) };
    }
  }
  return out;
}

/** Inverse of conditionsToJson for editing existing policies. */
export function conditionsFromJson(json: Record<string, unknown>): ApprovalConditionInput[] {
  const rows: ApprovalConditionInput[] = [];
  for (const [field, v] of Object.entries(json ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const c = v as { gte?: number; lte?: number; in?: unknown[] };
      if (c.in) rows.push({ field, op: "in", value: c.in.map(String).join(", ") });
      if (c.gte != null) rows.push({ field, op: "gte", value: String(c.gte) });
      if (c.lte != null) rows.push({ field, op: "lte", value: String(c.lte) });
    } else {
      rows.push({ field, op: "eq", value: String(v) });
    }
  }
  return rows;
}

export const approvalPolicyIdSchema = z.object({ id: z.uuid() });

/* ------------------------------------------------------------------ */
/* Audit log filters                                                   */
/* ------------------------------------------------------------------ */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

export const auditFilterSchema = z.object({
  entityType: z.string().trim().max(60).optional().catch(undefined),
  action: z.string().trim().max(80).optional().catch(undefined),
  actor: z.uuid().optional().catch(undefined),
  from: isoDate,
  to: isoDate,
  cursor: z.coerce.number().int().positive().optional().catch(undefined),
});
export type AuditFilter = z.infer<typeof auditFilterSchema>;

/* ------------------------------------------------------------------ */
/* Setup wizard                                                        */
/* ------------------------------------------------------------------ */

export const setupStepSchema = z.object({
  step: z.enum(["organization", "legal_entity", "locations", "structure", "time", "payroll", "admins", "import", "integrations", "review"]),
});
