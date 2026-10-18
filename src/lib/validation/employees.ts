import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const optionalDate = isoDate.nullish().or(z.literal("").transform(() => null));
const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const optionalId = z
  .union([z.uuid(), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number")
  .nullish()
  .or(z.literal("").transform(() => null));
const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email")
  .nullish()
  .or(z.literal("").transform(() => null));

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern", "consultant", "temporary"] as const;
export const WORKER_TYPES = ["employee", "contractor"] as const;
export const WORK_MODES = ["onsite", "remote", "hybrid"] as const;
export const EMPLOYEE_STATUSES = ["pending", "active", "on_notice", "exited"] as const;
export const GENDERS = ["female", "male", "non_binary", "prefer_not_to_say"] as const;

/** Rupees as entered in forms; converted to paise on the server. */
export const rupees = z.coerce
  .number({ error: "Enter an amount" })
  .nonnegative("Amount cannot be negative")
  .max(1_000_000_000, "Amount is too large");

export const createEmployeeSchema = z.object({
  firstName: z.string().trim().min(1, "Enter a first name").max(80),
  middleName: optionalText(80),
  lastName: optionalText(80),
  workEmail: email,
  personalEmail: email,
  phone,
  dateOfBirth: optionalDate,
  gender: z.enum(GENDERS).nullish(),
  employeeCode: optionalText(30),
  legalEntityId: z.uuid("Choose a legal entity"),
  departmentId: optionalId,
  designationId: optionalId,
  locationId: optionalId,
  managerId: optionalId,
  gradeId: optionalId,
  costCenterId: optionalId,
  employmentType: z.enum(EMPLOYMENT_TYPES),
  workerType: z.enum(WORKER_TYPES),
  workMode: z.enum(WORK_MODES),
  joiningDate: isoDate,
  probationMonths: z.coerce.number().int().min(0).max(24),
  noticePeriodDays: z.coerce.number().int().min(0).max(365),
  annualCtc: rupees.nullish().or(z.literal("").transform(() => null)),
});
export type CreateEmployeeInput = z.input<typeof createEmployeeSchema>;

export const updatePersonalSchema = z.object({
  employeeId: z.uuid(),
  firstName: z.string().trim().min(1, "Enter a first name").max(80),
  middleName: optionalText(80),
  lastName: optionalText(80),
  workEmail: email,
  personalEmail: email,
  phone,
  dateOfBirth: optionalDate,
  gender: z.enum(GENDERS).nullish(),
  maritalStatus: optionalText(30),
  nationality: optionalText(60),
  bloodGroup: optionalText(5),
  workMode: z.enum(WORK_MODES),
  noticePeriodDays: z.coerce.number().int().min(0).max(365),
});

/** Fields an employee may change on their own profile without approval. */
export const SELF_EDITABLE_FIELDS = ["phone", "personalEmail", "bloodGroup", "maritalStatus"] as const;

export const selfUpdateSchema = z.object({
  employeeId: z.uuid(),
  phone,
  personalEmail: email,
  bloodGroup: optionalText(5),
  maritalStatus: optionalText(30),
});

export const CHANGE_TYPES = [
  "transfer",
  "promotion",
  "demotion",
  "manager_change",
  "designation_change",
  "correction",
] as const;

export const jobChangeSchema = z.object({
  employeeId: z.uuid(),
  changeType: z.enum(CHANGE_TYPES),
  effectiveFrom: isoDate,
  legalEntityId: z.uuid(),
  departmentId: optionalId,
  designationId: optionalId,
  locationId: optionalId,
  managerId: optionalId,
  gradeId: optionalId,
  costCenterId: optionalId,
  employmentType: z.enum(EMPLOYMENT_TYPES),
  reason: z.string().trim().min(3, "Add a short reason").max(500),
});

export const compensationSchema = z.object({
  employeeId: z.uuid(),
  effectiveFrom: isoDate,
  annualCtc: rupees.refine((v) => v > 0, "Enter the annual CTC"),
  reason: z.enum(["hire", "revision", "promotion", "correction", "market_adjustment"]),
  notes: optionalText(500),
});

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR = /^[2-9][0-9]{11}$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UAN = /^[0-9]{12}$/;
const ESIC = /^[0-9]{10,17}$/;

const upperOptional = (re: RegExp, msg: string) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, "").toUpperCase())
    .refine((v) => v === "" || re.test(v), msg)
    .transform((v) => (v === "" ? null : v))
    .nullish();

/**
 * Statutory & bank details. Empty strings mean "leave unchanged" for
 * encrypted fields, because their current values are never sent to the client.
 */
export const sensitiveSchema = z.object({
  employeeId: z.uuid(),
  pan: upperOptional(PAN, "PAN looks like ABCDE1234F"),
  aadhaar: upperOptional(AADHAAR, "Aadhaar is 12 digits"),
  passport: upperOptional(/^[A-Z][0-9]{7}$/, "Passport looks like A1234567"),
  uan: upperOptional(UAN, "UAN is 12 digits"),
  esicNumber: upperOptional(ESIC, "Enter a valid ESIC number"),
  bankAccount: upperOptional(/^[0-9]{6,18}$/, "Account number is 6–18 digits"),
  bankIfsc: upperOptional(IFSC, "IFSC looks like HDFC0001234"),
  bankName: optionalText(80),
  accountHolderName: optionalText(120),
  taxRegime: z.enum(["old", "new"]),
});
export type SensitiveInput = z.input<typeof sensitiveSchema>;

export const addressSchema = z.object({
  employeeId: z.uuid(),
  type: z.enum(["current", "permanent"]),
  line1: z.string().trim().min(3, "Enter the address").max(200),
  line2: optionalText(200),
  city: z.string().trim().min(2, "Enter the city").max(80),
  stateCode: optionalText(2),
  postalCode: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{5}$/, "PIN code is 6 digits")
    .nullish()
    .or(z.literal("").transform(() => null)),
  countryCode: z.string().trim().length(2),
});

export const emergencyContactSchema = z.object({
  employeeId: z.uuid(),
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Enter a name").max(120),
  relationship: z.string().trim().min(2, "Enter the relationship").max(40),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number"),
  email,
  isPrimary: z.boolean(),
});

export const dependentSchema = z.object({
  employeeId: z.uuid(),
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Enter a name").max(120),
  relationship: z.string().trim().min(2, "Enter the relationship").max(40),
  dateOfBirth: optionalDate,
  isNominee: z.boolean(),
  nominationPercent: z.coerce.number().int().min(0).max(100).nullish(),
});

export const qualificationSchema = z.object({
  employeeId: z.uuid(),
  id: z.uuid().optional(),
  kind: z.enum(["education", "certification"]),
  title: z.string().trim().min(2, "Enter the qualification").max(160),
  institution: optionalText(160),
  fieldOfStudy: optionalText(120),
  startYear: z.coerce.number().int().min(1950).max(2100).nullish().or(z.literal("").transform(() => null)),
  endYear: z.coerce.number().int().min(1950).max(2100).nullish().or(z.literal("").transform(() => null)),
  grade: optionalText(40),
  issuedOn: optionalDate,
  expiresOn: optionalDate,
  credentialId: optionalText(80),
});

export const skillSchema = z.object({
  employeeId: z.uuid(),
  name: z.string().trim().min(1, "Enter a skill").max(60),
  proficiency: z.coerce.number().int().min(1).max(5),
});

export const changeRequestSchema = z.object({
  employeeId: z.uuid(),
  reason: z.string().trim().min(3, "Explain the change").max(500),
  changes: z
    .object({
      firstName: z.string().trim().min(1).max(80).optional(),
      middleName: z.string().trim().max(80).optional(),
      lastName: z.string().trim().max(80).optional(),
      dateOfBirth: isoDate.optional(),
      gender: z.enum(GENDERS).optional(),
      nationality: z.string().trim().max(60).optional(),
      pan: upperOptional(PAN, "PAN looks like ABCDE1234F").optional(),
      aadhaar: upperOptional(AADHAAR, "Aadhaar is 12 digits").optional(),
      bankAccount: upperOptional(/^[0-9]{6,18}$/, "Account number is 6–18 digits").optional(),
      bankIfsc: upperOptional(IFSC, "IFSC looks like HDFC0001234").optional(),
      bankName: z.string().trim().max(80).optional(),
      accountHolderName: z.string().trim().max(120).optional(),
      uan: upperOptional(UAN, "UAN is 12 digits").optional(),
    })
    .refine((c) => Object.values(c).some((v) => v !== undefined && v !== null && v !== ""), "Change at least one field"),
});

export const employeeListSchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(["current", "all", ...EMPLOYEE_STATUSES]).default("current"),
  departmentId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  joined: z.enum(["this-month", "last-30-days"]).optional(),
  sort: z.enum(["name", "code", "joining", "department"]).default("name"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type EmployeeListQuery = z.infer<typeof employeeListSchema>;
