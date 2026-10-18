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
/** Booleans arriving from FormData ("true"/"false"/"on") or JSON. */
const formBool = (fallback: boolean) =>
  z
    .union([z.boolean(), z.enum(["true", "false", "on", "off", ""])])
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : v === true || v === "true" || v === "on"));

/**
 * Rupee amount as typed ("1,250.50") → number of rupees with at most two
 * decimals. Idempotent (the client resolver's output is parsed again on the
 * server); services convert to integer paise with `toPaise`.
 */
export const rupees = z
  .union([z.string(), z.number()])
  .transform((v, c) => {
    const s = String(v).replace(/[,\s₹]/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(s)) {
      c.addIssue({ code: "custom", message: "Enter an amount in rupees, e.g. 1250.50" });
      return z.NEVER;
    }
    const n = Number(s);
    if (n > 100_000_000) {
      c.addIssue({ code: "custom", message: "Amount is too large" });
      return z.NEVER;
    }
    return n;
  });

const positiveRupees = rupees.refine((r) => r > 0, "Enter an amount greater than zero");

/** Optional amount in rupees: blank means "not set" (null). */
const optionalRupees = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, c) => {
    if (v === null || v === undefined || String(v).trim() === "") return null;
    const r = rupees.safeParse(v);
    if (!r.success) {
      c.addIssue({ code: "custom", message: "Enter an amount in rupees or leave blank" });
      return z.NEVER;
    }
    return r.data;
  });

/** Rupees (≤ 2 decimals) → integer paise. */
export const toPaise = (r: number) => Math.round(r * 100);
export const toPaiseOrNull = (r: number | null) => (r == null ? null : toPaise(r));
/** Paise → rupees for form defaults. */
export const paiseToRupees = (paise: number | null | undefined) => (paise == null ? null : paise / 100);

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

export const expenseCategorySchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(80),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,24}$/, "Use 2–24 letters, digits or underscores"),
  maxPerItem: optionalRupees,
  maxPerMonth: optionalRupees,
  receiptRequiredAbove: optionalRupees.transform((v) => v ?? 0),
  glCode: optionalText(40),
  isTaxable: formBool(false),
  isActive: formBool(true),
});
export type ExpenseCategoryInput = z.output<typeof expenseCategorySchema>;
export type ExpenseCategoryFormValues = z.input<typeof expenseCategorySchema>;

export const updateExpenseCategorySchema = expenseCategorySchema.extend({ id: z.uuid() });

/* ------------------------------------------------------------------ */
/* Claims and items                                                    */
/* ------------------------------------------------------------------ */

export const REIMBURSEMENT_METHODS = ["payroll", "bank_transfer"] as const;
export type ReimbursementMethod = (typeof REIMBURSEMENT_METHODS)[number];
export const REIMBURSEMENT_METHOD_LABELS: Record<ReimbursementMethod, string> = {
  payroll: "With salary (payroll)",
  bank_transfer: "Bank transfer by finance",
};

export const CLAIM_STATUSES = ["draft", "submitted", "approved", "rejected", "reimbursed", "cancelled"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const createClaimSchema = z.object({
  title: z.string().trim().min(3, "Describe the claim, e.g. “Client visit to Pune”").max(120),
  reimbursementMethod: z.enum(REIMBURSEMENT_METHODS).default("payroll"),
});
export type CreateClaimInput = z.output<typeof createClaimSchema>;

export const updateClaimSchema = createClaimSchema.extend({ id: z.uuid() });

export const claimIdSchema = z.object({ id: z.uuid() });

/** Item fields as they arrive from the item form (FormData strings). */
export const expenseItemSchema = z.object({
  claimId: z.uuid(),
  categoryId: z.uuid({ message: "Choose a category" }),
  spentOn: isoDate,
  merchant: optionalText(120),
  description: z.string().trim().min(2, "Describe the expense").max(300),
  amount: positiveRupees,
});
export type ExpenseItemInput = z.output<typeof expenseItemSchema>;

export const itemIdSchema = z.object({ id: z.uuid() });

export const markReimbursedSchema = z.object({
  id: z.uuid(),
  paymentReference: z.string().trim().min(3, "Enter the UTR or payment reference").max(80),
});

export const claimFilterSchema = z.object({
  status: z.enum(CLAIM_STATUSES).optional(),
  q: z.string().trim().max(80).optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});
export type ClaimFilter = z.output<typeof claimFilterSchema>;

/* ------------------------------------------------------------------ */
/* Benefits                                                            */
/* ------------------------------------------------------------------ */

export const BENEFIT_KINDS = ["health_insurance", "life_insurance", "nps", "meal", "wellness", "other"] as const;
export type BenefitKind = (typeof BENEFIT_KINDS)[number];
export const BENEFIT_KIND_LABELS: Record<BenefitKind, string> = {
  health_insurance: "Health insurance",
  life_insurance: "Life insurance",
  nps: "National Pension System",
  meal: "Meal card",
  wellness: "Wellness",
  other: "Other",
};

export const COVERAGE_OPTIONS = ["self", "self_spouse", "self_spouse_children", "family", "self_parents"] as const;
export type CoverageOption = (typeof COVERAGE_OPTIONS)[number];
export const COVERAGE_LABELS: Record<CoverageOption, string> = {
  self: "Self only",
  self_spouse: "Self + spouse",
  self_spouse_children: "Self + spouse + children",
  family: "Family (incl. parents)",
  self_parents: "Self + parents",
};

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern", "consultant", "temporary"] as const;

const idList = z
  .array(z.uuid())
  .max(200)
  .optional()
  .transform((v) => v ?? []);

export const benefitPlanSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a plan name").max(120),
    kind: z.enum(BENEFIT_KINDS),
    description: optionalText(1000),
    provider: optionalText(120),
    eligibleEmploymentTypes: z
      .array(z.enum(EMPLOYMENT_TYPES))
      .optional()
      .transform((v) => v ?? []),
    eligibleLocationIds: idList,
    eligibleLegalEntityIds: idList,
    eligibleGradeIds: idList,
    employerContribution: optionalRupees.transform((v) => v ?? 0),
    employeeContribution: optionalRupees.transform((v) => v ?? 0),
    deductFromSalary: formBool(false),
    coverageOptions: z.array(z.enum(COVERAGE_OPTIONS)).min(1, "Choose at least one coverage option"),
    enrollmentOpensOn: optionalDate,
    enrollmentClosesOn: optionalDate,
    isActive: formBool(true),
  })
  .refine((p) => !p.enrollmentOpensOn || !p.enrollmentClosesOn || p.enrollmentClosesOn >= p.enrollmentOpensOn, {
    message: "The window must close on or after it opens",
    path: ["enrollmentClosesOn"],
  })
  .refine((p) => !p.deductFromSalary || p.employeeContribution > 0, {
    message: "Set the employee contribution to deduct it from salary",
    path: ["employeeContribution"],
  });
export type BenefitPlanInput = z.output<typeof benefitPlanSchema>;
export type BenefitPlanFormValues = z.input<typeof benefitPlanSchema>;

export const updateBenefitPlanSchema = z.intersection(benefitPlanSchema, z.object({ id: z.uuid() }));

export const enrollSchema = z.object({
  planId: z.uuid(),
  coverage: z.enum(COVERAGE_OPTIONS),
  dependentIds: idList,
});
export type EnrollInput = z.output<typeof enrollSchema>;

export const waiveSchema = z.object({ planId: z.uuid() });
