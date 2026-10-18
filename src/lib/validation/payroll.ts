import { z } from "zod";
import { RULE_KINDS } from "@/lib/payroll/params";
import { DECLARATION_FIELDS } from "@/lib/payroll/tax";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** Rupees as entered in forms (up to two decimals); converted to paise on the server. */
export const rupeeAmount = z.coerce
  .number({ error: "Enter an amount" })
  .nonnegative("Amount cannot be negative")
  .max(1_000_000_000, "Amount is too large")
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, "Use at most two decimals");

export const toPaise = (rupees: number) => Math.round(rupees * 100);

export const COMPONENT_KINDS = ["earning", "deduction", "employer_contribution", "reimbursement", "statutory_deduction"] as const;
export const COMPONENT_CALCS = ["fixed", "percent_of_ctc", "percent_of_basic", "percent_of_gross", "balancing", "statutory", "input"] as const;
export const STRUCTURE_CALCS = ["fixed", "percent_of_ctc", "percent_of_basic", "percent_of_gross", "balancing"] as const;
export const INPUT_KINDS = [
  "bonus",
  "incentive",
  "commission",
  "arrear",
  "overtime",
  "reimbursement",
  "deduction",
  "recovery",
  "referral_reward",
  "leave_encashment",
  "other_earning",
] as const;
export const DISBURSEMENT_FORMATS = ["generic_csv", "neft_bulk"] as const;

export const openPeriodSchema = z
  .object({
    legalEntityId: z.uuid("Choose a legal entity"),
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12),
    payDate: isoDate,
    inputCutoffDate: isoDate,
  })
  .refine((v) => v.inputCutoffDate <= v.payDate, { message: "The input cutoff must be on or before the pay date", path: ["inputCutoffDate"] });

export const componentSchema = z
  .object({
    id: z.uuid().optional(),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9_]{1,19}$/, "2–20 characters: letters, digits and underscores, starting with a letter"),
    name: z.string().trim().min(2, "Enter a name").max(80),
    kind: z.enum(COMPONENT_KINDS),
    calculation: z.enum(COMPONENT_CALCS),
    /** Percent, or for "fixed" an annual amount in rupees. */
    value: z.coerce.number().nonnegative().max(1_000_000_000).nullish(),
    isTaxable: z.boolean(),
    isPartOfCtc: z.boolean(),
    pfWage: z.boolean(),
    esiWage: z.boolean(),
    ptWage: z.boolean(),
    prorate: z.boolean(),
    payslipLabel: optionalText(60),
    sortOrder: z.coerce.number().int().min(0).max(9999),
    isActive: z.boolean(),
  })
  .refine((v) => v.calculation === "fixed" || v.value == null || v.value <= 100, { message: "Percentages cannot exceed 100", path: ["value"] });

export const structureLineSchema = z.object({
  componentCode: z.string().trim().min(1, "Choose a component"),
  calculation: z.enum(STRUCTURE_CALCS),
  /** Percent, or for "fixed" an annual amount in rupees. Empty for balancing. */
  value: z.coerce.number().nonnegative("Cannot be negative").max(1_000_000_000).nullish(),
});

export const structureSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Enter a name").max(80),
  description: optionalText(300),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  lines: z.array(structureLineSchema).min(1, "Add at least one line").max(30),
});

export const structurePreviewSchema = z.object({
  lines: z.array(structureLineSchema).min(1).max(30),
  annualCtc: rupeeAmount.refine((v) => v > 0, "Enter a CTC"),
});

export const assignStructureSchema = z.object({
  employeeId: z.uuid("Choose an employee"),
  structureId: z.uuid("Choose a structure"),
  effectiveFrom: isoDate,
});

export const ruleSetVersionSchema = z
  .object({
    baseId: z.uuid().optional(),
    kind: z.enum(RULE_KINDS),
    jurisdiction: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^IN(-[A-Z]{2})?$/, 'Use "IN" or a state such as "IN-KA"'),
    name: z.string().trim().min(3, "Enter a name").max(120),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullish().or(z.literal("").transform(() => null)),
    parametersJson: z.string().trim().min(2, "Enter the parameters as JSON").max(50_000),
    sourceReference: z.string().trim().min(5, "Name the statute or notification these values come from").max(500),
    notes: optionalText(2000),
  })
  .refine((v) => !v.effectiveTo || v.effectiveTo > v.effectiveFrom, { message: "Must be after the effective-from date", path: ["effectiveTo"] });

export const markVerifiedSchema = z.object({
  id: z.uuid(),
  attest: z.literal(true, { error: "Confirm that a qualified payroll professional verified these values" }),
});

export const payrollInputSchema = z.object({
  periodId: z.uuid(),
  employeeId: z.uuid("Choose an employee"),
  kind: z.enum(INPUT_KINDS),
  componentCode: z.string().trim().min(1, "Choose a component"),
  amount: rupeeAmount.refine((v) => v > 0, "Enter an amount above zero"),
  isTaxable: z.boolean(),
  note: optionalText(300),
});

export const importInputsSchema = z.object({
  periodId: z.uuid(),
  csv: z.string().min(1, "Choose a CSV file").max(2_000_000, "The file is too large (2 MB maximum)"),
  commit: z.boolean(),
});

export const runIdSchema = z.object({ runId: z.uuid() });
export const periodIdSchema = z.object({ periodId: z.uuid() });

export const calculateRunSchema = z.object({
  runId: z.uuid(),
  idempotencyKey: z.uuid(),
  varianceThresholdPct: z.coerce.number().min(1).max(100).default(10),
});

export const fnfRunSchema = z.object({
  periodId: z.uuid(),
  employeeId: z.uuid("Choose the exiting employee"),
  leaveEncashmentDays: z.coerce.number().min(0).max(365).multipleOf(0.5, "Use whole or half days"),
  encashmentDivisor: z.coerce.number().int().refine((v) => v === 26 || v === 30, "Use 26 or 30"),
  noticePayDays: z.coerce.number().min(0).max(365).multipleOf(0.5, "Use whole or half days"),
  noticeRecoveryDays: z.coerce.number().min(0).max(365).multipleOf(0.5, "Use whole or half days"),
  includeGratuity: z.boolean(),
});

export const adjustmentRunSchema = z.object({
  parentRunId: z.uuid(),
  employeeIds: z.array(z.uuid()).min(1, "Choose at least one employee").max(500),
  notes: optionalText(500),
});

export const LOCK_CONFIRMATION = "LOCK WITH UNVERIFIED RULES";

export const lockRunSchema = z
  .object({
    runId: z.uuid(),
    overrideUnverified: z.boolean(),
    confirmation: z.string().trim().max(60).optional(),
  })
  .refine((v) => !v.overrideUnverified || v.confirmation === LOCK_CONFIRMATION, {
    message: `Type ${LOCK_CONFIRMATION} to confirm`,
    path: ["confirmation"],
  });

export const disbursementSchema = z.object({ runId: z.uuid(), format: z.enum(DISBURSEMENT_FORMATS) });

export const bankResponseSchema = z.object({
  batchId: z.uuid(),
  csv: z.string().min(1, "Choose the bank response file").max(2_000_000, "The file is too large (2 MB maximum)"),
});

export const loanSchema = z
  .object({
    employeeId: z.uuid("Choose an employee"),
    kind: z.enum(["loan", "advance"]),
    principal: rupeeAmount.refine((v) => v > 0, "Enter the amount"),
    monthlyInstallment: rupeeAmount.refine((v) => v > 0, "Enter the installment"),
    startYear: z.coerce.number().int().min(2000).max(2100),
    startMonth: z.coerce.number().int().min(1).max(12),
    notes: optionalText(300),
  })
  .refine((v) => v.monthlyInstallment <= v.principal, { message: "The installment cannot exceed the amount", path: ["monthlyInstallment"] });

const declarationAmount = rupeeAmount.default(0);
const declarationShape = {
  "80C": declarationAmount,
  "80CCD1B": declarationAmount,
  "80D": declarationAmount,
  "24b": declarationAmount,
  "80E": declarationAmount,
  "80TTA": declarationAmount,
  rentPaid: declarationAmount,
} satisfies Record<(typeof DECLARATION_FIELDS)[number]["key"], typeof declarationAmount>;

export const taxDeclarationSchema = z.object({
  fyStartYear: z.coerce.number().int().min(2000).max(2100),
  regime: z.enum(["new", "old"]),
  declarations: z.object(declarationShape),
  metroCity: z.boolean(),
  previousEmployerIncome: rupeeAmount.default(0),
  previousEmployerTds: rupeeAmount.default(0),
  submit: z.boolean(),
});

export const verifyDeclarationSchema = z.object({ id: z.uuid() });
