import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const optionalDate = z
  .union([isoDate, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));
const optionalText = (max = 500) =>
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
/** Booleans arriving from FormData ("true"/"false"/"on") or JSON. */
const formBool = (fallback: boolean) =>
  z
    .union([z.boolean(), z.enum(["true", "false", "on", "off", ""])])
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : v === true || v === "true" || v === "on"));

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

export const DOCUMENT_CATEGORIES = [
  "identity",
  "statutory",
  "contract",
  "offer_letter",
  "policy",
  "certificate",
  "education",
  "appraisal",
  "payslip",
  "tax",
  "exit",
  "letter",
  "receipt",
  "resume",
  "other",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  identity: "Identity proof",
  statutory: "Statutory",
  contract: "Contract",
  offer_letter: "Offer letter",
  policy: "Policy",
  certificate: "Certificate",
  education: "Education",
  appraisal: "Appraisal",
  payslip: "Payslip",
  tax: "Tax",
  exit: "Exit",
  letter: "Letter",
  receipt: "Receipt",
  resume: "Resume",
  other: "Other",
};

/** Categories an employee may upload to their own record. */
export const SELF_UPLOAD_CATEGORIES = ["identity", "education", "certificate", "statutory", "other", "receipt"] as const satisfies readonly DocumentCategory[];

/** Owner types this module manages directly. Other modules attach their own. */
export const DOCUMENT_OWNER_TYPES = ["employee", "company"] as const;
export type DocumentOwnerType = (typeof DOCUMENT_OWNER_TYPES)[number];

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Allow-listed file types. Extension -> canonical MIME type. */
export const ALLOWED_FILE_TYPES = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  md: "text/markdown",
} as const;
export const ACCEPT_ATTRIBUTE = Object.keys(ALLOWED_FILE_TYPES)
  .map((e) => `.${e}`)
  .join(",");

/** Metadata fields of an upload (the file itself is validated by the service). */
export const uploadDocumentSchema = z
  .object({
    ownerType: z.enum(DOCUMENT_OWNER_TYPES),
    employeeId: optionalId,
    category: z.enum(DOCUMENT_CATEGORIES),
    title: z.string().trim().min(1, "Enter a title").max(160),
    expiresOn: optionalDate,
    employeeVisible: formBool(true),
    isSensitive: formBool(false),
    supersedesId: optionalId,
  })
  .superRefine((v, ctx) => {
    if (v.ownerType === "employee" && !v.employeeId) {
      ctx.addIssue({ code: "custom", path: ["employeeId"], message: "Choose an employee" });
    }
  });
export type UploadDocumentInput = z.output<typeof uploadDocumentSchema>;

export const documentIdSchema = z.object({ id: z.uuid() });

export const retentionSchema = z.object({
  id: z.uuid(),
  retainUntil: optionalDate,
  legalHold: z.boolean(),
});

/* ------------------------------------------------------------------ */
/* Policies                                                            */
/* ------------------------------------------------------------------ */

export const POLICY_CATEGORIES = [
  "general",
  "code_of_conduct",
  "leave",
  "attendance",
  "travel",
  "expenses",
  "it_security",
  "posh",
  "health_safety",
  "benefits",
  "other",
] as const;

export const POLICY_CATEGORY_LABELS: Record<(typeof POLICY_CATEGORIES)[number], string> = {
  general: "General",
  code_of_conduct: "Code of conduct",
  leave: "Leave",
  attendance: "Attendance",
  travel: "Travel",
  expenses: "Expenses",
  it_security: "IT & security",
  posh: "POSH",
  health_safety: "Health & safety",
  benefits: "Benefits",
  other: "Other",
};

export const POLICY_STATUSES = ["draft", "published", "archived"] as const;

export const policySchema = z.object({
  title: z.string().trim().min(3, "Enter a title").max(160),
  category: z.enum(POLICY_CATEGORIES),
  summary: optionalText(500),
  body: z.string().trim().min(10, "Write the policy text").max(100_000, "Policy text is too long"),
  effectiveFrom: isoDate,
  requiresAcknowledgement: z.boolean(),
  documentId: optionalId,
});
export type PolicyInput = z.output<typeof policySchema>;

export const updatePolicySchema = policySchema.extend({ id: z.uuid() });
export const policyIdSchema = z.object({ id: z.uuid() });

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export const TEMPLATE_KINDS = [
  "offer_letter",
  "appointment_letter",
  "experience_letter",
  "relieving_letter",
  "confirmation_letter",
  "salary_revision_letter",
  "warning_letter",
  "email",
  "policy",
  "other",
] as const;

export const TEMPLATE_KIND_LABELS: Record<(typeof TEMPLATE_KINDS)[number], string> = {
  offer_letter: "Offer letter",
  appointment_letter: "Appointment letter",
  experience_letter: "Experience letter",
  relieving_letter: "Relieving letter",
  confirmation_letter: "Confirmation letter",
  salary_revision_letter: "Salary revision letter",
  warning_letter: "Warning letter",
  email: "Email",
  policy: "Policy",
  other: "Other",
};

export const templateMetaSchema = z.object({
  kind: z.enum(TEMPLATE_KINDS),
  name: z.string().trim().min(3, "Enter a name").max(120),
  description: optionalText(500),
});

export const createTemplateSchema = templateMetaSchema.extend({
  subject: optionalText(200),
  body: z.string().trim().min(10, "Write the template body").max(100_000),
});
export type CreateTemplateInput = z.output<typeof createTemplateSchema>;

export const updateTemplateSchema = createTemplateSchema.extend({ id: z.uuid() });
export const templateActiveSchema = z.object({ id: z.uuid(), isActive: z.boolean() });

/** Matches {{ placeholder.path }}. Paths are dotted identifiers. */
export const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)*)\s*\}\}/g;

/** Unique placeholders in order of first appearance. Pure; used on client and server. */
export function extractPlaceholders(...texts: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(PLACEHOLDER_PATTERN)) seen.add(m[1]);
  }
  return [...seen];
}

/** Placeholders the app knows how to fill. Shown as hints in the editor. */
export const KNOWN_PLACEHOLDERS: { key: string; label: string }[] = [
  { key: "employee.fullName", label: "Employee full name" },
  { key: "employee.firstName", label: "Employee first name" },
  { key: "employee.employeeCode", label: "Employee code" },
  { key: "employee.designation", label: "Designation" },
  { key: "employee.department", label: "Department" },
  { key: "employee.location", label: "Work location" },
  { key: "employee.joiningDate", label: "Date of joining" },
  { key: "employee.lastWorkingDate", label: "Last working day" },
  { key: "employee.manager", label: "Reporting manager" },
  { key: "offer.annualCtc", label: "Annual CTC (formatted)" },
  { key: "offer.validUntil", label: "Offer valid until" },
  { key: "company.name", label: "Company name" },
  { key: "company.legalName", label: "Company legal name" },
  { key: "company.address", label: "Registered address" },
  { key: "signatory.name", label: "Signatory name" },
  { key: "signatory.designation", label: "Signatory designation" },
  { key: "today", label: "Today's date" },
];
