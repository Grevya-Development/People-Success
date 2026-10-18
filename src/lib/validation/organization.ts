import { z } from "zod";

export const POSITION_STATUSES = ["planned", "open", "filled", "frozen", "closed"] as const;
export type PositionStatus = (typeof POSITION_STATUSES)[number];

export const POSITION_STATUS_LABELS: Record<PositionStatus, string> = {
  planned: "Planned",
  open: "Open",
  filled: "Filled",
  frozen: "Frozen",
  closed: "Closed",
};

const optionalId = z
  .union([z.uuid(), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

/** Rupees as typed in the form (empty = not budgeted); stored as paise. */
const optionalRupees = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s₹]/g, ""));
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: "custom", message: "Enter an amount in rupees" });
      return z.NEVER;
    }
    if (n < 0) {
      ctx.addIssue({ code: "custom", message: "Amount cannot be negative" });
      return z.NEVER;
    }
    if (n > 1_000_000_000) {
      ctx.addIssue({ code: "custom", message: "Amount is too large" });
      return z.NEVER;
    }
    return n;
  });

export const positionSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Enter a position code")
    .max(30)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Use letters, numbers, dots, dashes or slashes"),
  title: z.string().trim().min(2, "Enter a title").max(120),
  status: z.enum(POSITION_STATUSES),
  departmentId: optionalId,
  locationId: optionalId,
  designationId: optionalId,
  legalEntityId: optionalId,
  costCenterId: optionalId,
  reportsToPositionId: optionalId,
  employeeId: optionalId,
  /** Annual budgeted CTC in rupees. */
  budgetedAnnualCtc: optionalRupees,
});

const positionRules = (v: { status: PositionStatus; employeeId: string | null }, ctx: z.RefinementCtx) => {
  if (v.employeeId && v.status !== "filled") {
    ctx.addIssue({ code: "custom", path: ["status"], message: "A position with an incumbent must be marked filled" });
  }
  if (!v.employeeId && v.status === "filled") {
    ctx.addIssue({ code: "custom", path: ["employeeId"], message: "Choose who fills this position" });
  }
};

export const createPositionSchema = positionSchema.superRefine(positionRules);
export type PositionInput = z.output<typeof positionSchema>;
export type PositionFormValues = z.input<typeof positionSchema>;

export const updatePositionSchema = positionSchema.extend({ id: z.uuid() }).superRefine(positionRules);
