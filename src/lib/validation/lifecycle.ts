import { z } from "zod";
import { DOCUMENT_CATEGORIES } from "./documents";

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
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
const days = z.coerce.number({ error: "Enter a number" }).int("Whole days only").min(0, "Cannot be negative").max(365, "Too many days");

/* ------------------------------------------------------------------ */
/* Catalogues                                                          */
/* ------------------------------------------------------------------ */

export const PLAN_KINDS = ["onboarding", "offboarding"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const OWNER_GROUPS = ["hr", "it", "finance", "manager", "employee", "buddy"] as const;
export type OwnerGroup = (typeof OWNER_GROUPS)[number];
export const OWNER_GROUP_LABELS: Record<OwnerGroup, string> = {
  hr: "HR",
  it: "IT",
  finance: "Finance",
  manager: "Manager",
  employee: "Employee",
  buddy: "Buddy",
};

export const TASK_KINDS = ["checklist", "document_upload", "acknowledgement", "form", "checkin"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  checklist: "Checklist item",
  document_upload: "Document upload",
  acknowledgement: "Policy acknowledgement",
  form: "Form / profile details",
  checkin: "Check-in",
};

/** Special offboarding behaviours keyed by `config.code`. */
export const TASK_CODES = [
  "handover",
  "handover_review",
  "asset_return",
  "access_revocation",
  "leave_reconciliation",
  "exit_interview",
  "settlement_inputs",
  "letters",
] as const;
export type TaskCode = (typeof TASK_CODES)[number];
export const TASK_CODE_LABELS: Record<TaskCode, string> = {
  handover: "Handover plan",
  handover_review: "Handover review",
  asset_return: "Asset return (done when all assets are returned)",
  access_revocation: "Access revocation (needs authorized confirmation)",
  leave_reconciliation: "Attendance & leave reconciliation",
  exit_interview: "Exit interview (done when recorded)",
  settlement_inputs: "Settlement inputs (done when saved)",
  letters: "Experience & relieving letters (done when generated)",
};

/** Profile sections a "form" task can point the employee to. */
export const FORM_TARGETS = ["personal", "bank", "address", "emergency"] as const;
export type FormTarget = (typeof FORM_TARGETS)[number];

export const EXIT_TYPES = ["resignation", "termination", "retirement", "end_of_contract", "absconding", "death", "mutual_separation"] as const;
export type ExitType = (typeof EXIT_TYPES)[number];
/** Exits HR can initiate (resignations are raised by the employee). */
export const HR_EXIT_TYPES = ["termination", "end_of_contract", "retirement", "absconding", "mutual_separation", "death"] as const;
export const EXIT_TYPE_LABELS: Record<ExitType, string> = {
  resignation: "Resignation",
  termination: "Termination",
  retirement: "Retirement",
  end_of_contract: "End of contract",
  absconding: "Absconding",
  death: "Death in service",
  mutual_separation: "Mutual separation",
};

export const EXIT_REASON_CATEGORIES = [
  "better_opportunity",
  "compensation",
  "career_growth",
  "manager_relationship",
  "work_life_balance",
  "relocation",
  "higher_studies",
  "health_personal",
  "performance",
  "conduct",
  "restructuring",
  "contract_end",
  "retirement",
  "other",
] as const;
export type ExitReasonCategory = (typeof EXIT_REASON_CATEGORIES)[number];
export const EXIT_REASON_LABELS: Record<ExitReasonCategory, string> = {
  better_opportunity: "Better opportunity",
  compensation: "Compensation",
  career_growth: "Career growth",
  manager_relationship: "Manager relationship",
  work_life_balance: "Work-life balance",
  relocation: "Relocation",
  higher_studies: "Higher studies",
  health_personal: "Health / personal",
  performance: "Performance",
  conduct: "Conduct",
  restructuring: "Restructuring",
  contract_end: "Contract ended",
  retirement: "Retirement",
  other: "Other",
};
/** Reasons an employee may pick when resigning. */
export const RESIGNATION_REASONS = [
  "better_opportunity",
  "compensation",
  "career_growth",
  "manager_relationship",
  "work_life_balance",
  "relocation",
  "higher_studies",
  "health_personal",
  "other",
] as const satisfies readonly ExitReasonCategory[];

export const SHORTFALL_TREATMENTS = ["none", "waived", "recover", "buyout"] as const;
export const SHORTFALL_LABELS: Record<(typeof SHORTFALL_TREATMENTS)[number], string> = {
  none: "No shortfall",
  waived: "Waived",
  recover: "Recover from settlement",
  buyout: "Bought out by employee / new employer",
};

export const SETTLEMENT_STATUSES = ["not_started", "draft", "pending_approval", "approved", "paid"] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
export const SETTLEMENT_LABELS: Record<SettlementStatus, string> = {
  not_started: "Not started",
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  paid: "Paid",
};

export const INTERVIEW_RATING_KEYS = ["role", "manager", "growth", "compensation", "culture", "workLife"] as const;
export const INTERVIEW_RATING_LABELS: Record<(typeof INTERVIEW_RATING_KEYS)[number], string> = {
  role: "Role & work",
  manager: "Manager",
  growth: "Growth & learning",
  compensation: "Pay & benefits",
  culture: "Culture & team",
  workLife: "Work-life balance",
};

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export const templateSchema = z.object({
  id: optionalId,
  kind: z.enum(PLAN_KINDS),
  name: z.string().trim().min(2, "Enter a name").max(120),
  description: optionalText(500),
  priority: z.coerce.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
  departmentId: optionalId,
  locationId: optionalId,
  legalEntityId: optionalId,
  employmentType: z
    .union([z.enum(["full_time", "part_time", "contract", "intern", "consultant", "temporary"]), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v : null)),
});
export type TemplateInput = z.input<typeof templateSchema>;

export const templateTaskSchema = z
  .object({
    id: optionalId,
    templateId: z.uuid(),
    title: z.string().trim().min(2, "Enter a title").max(160),
    description: optionalText(1000),
    ownerGroup: z.enum(OWNER_GROUPS),
    dueOffsetDays: z.coerce.number({ error: "Enter a number" }).int().min(-365).max(365),
    kind: z.enum(TASK_KINDS),
    documentCategory: z
      .union([z.enum(DOCUMENT_CATEGORIES), z.literal(""), z.null()])
      .optional()
      .transform((v) => (v ? v : null)),
    policyId: optionalId,
    checkinDay: z
      .union([z.coerce.number().int().min(1).max(730), z.literal(""), z.null()])
      .optional()
      .transform((v) => (v === "" || v == null ? null : v)),
    formTarget: z
      .union([z.enum(FORM_TARGETS), z.literal(""), z.null()])
      .optional()
      .transform((v) => (v ? v : null)),
    code: z
      .union([z.enum(TASK_CODES), z.literal(""), z.null()])
      .optional()
      .transform((v) => (v ? v : null)),
    required: z.boolean().default(true),
    sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "document_upload" && !v.documentCategory) {
      ctx.addIssue({ code: "custom", path: ["documentCategory"], message: "Choose the document category to collect" });
    }
  });
export type TemplateTaskInput = z.input<typeof templateTaskSchema>;

export const idSchema = z.object({ id: z.uuid() });

/* ------------------------------------------------------------------ */
/* Plans and tasks                                                     */
/* ------------------------------------------------------------------ */

export const startPlanSchema = z.object({
  employeeId: z.uuid({ error: "Choose an employee" }),
  templateId: optionalId,
  buddyEmployeeId: optionalId,
});
export type StartPlanInput = z.input<typeof startPlanSchema>;

export const planTaskStatusSchema = z.object({
  taskId: z.uuid(),
  status: z.enum(["open", "in_progress", "blocked", "done"]),
});

export const waiveTaskSchema = z.object({
  taskId: z.uuid(),
  reason: z.string().trim().min(5, "Explain why this task is waived").max(500),
});

export const taskIdSchema = z.object({ taskId: z.uuid() });

export const reassignTaskSchema = z.object({
  taskId: z.uuid(),
  assigneeUserId: optionalId,
});

export const setBuddySchema = z.object({
  planId: z.uuid(),
  buddyEmployeeId: optionalId,
});

export const checkinSchema = z.object({
  taskId: z.uuid(),
  settlingIn: z.coerce.number().int().min(1, "Rate 1 to 5").max(5, "Rate 1 to 5"),
  note: z.string().trim().min(3, "Add a short note").max(2000),
  followUps: optionalText(1000),
});
export type CheckinInput = z.input<typeof checkinSchema>;

export const acknowledgeForTaskSchema = z.object({ taskId: z.uuid(), policyId: z.uuid() });

export const markJoinedSchema = z.object({ employeeId: z.uuid(), joinedOn: isoDate });

export const accessRevocationSchema = z.object({
  taskId: z.uuid(),
  note: z.string().trim().min(3, "Describe what was revoked").max(1000),
  confirm: z.literal(true, { error: "Confirm that access was revoked" }),
});

/* ------------------------------------------------------------------ */
/* Exits                                                               */
/* ------------------------------------------------------------------ */

export const resignationSchema = z.object({
  requestedLastWorkingDate: isoDate,
  reasonCategory: z.enum(RESIGNATION_REASONS, { error: "Choose a reason" }),
  reasonDetail: optionalText(2000),
});
export type ResignationInput = z.input<typeof resignationSchema>;

export const hrExitSchema = z.object({
  employeeId: z.uuid({ error: "Choose an employee" }),
  type: z.enum(HR_EXIT_TYPES, { error: "Choose the exit type" }),
  lastWorkingDate: isoDate,
  reasonCategory: z.enum(EXIT_REASON_CATEGORIES, { error: "Choose a reason" }),
  reasonDetail: z.string().trim().min(5, "Describe the reason").max(2000),
  /** Typed confirmation: the employee code (required for terminations). */
  confirmation: optionalText(40),
});
export type HrExitInput = z.input<typeof hrExitSchema>;

export const exitCaseIdSchema = z.object({ exitCaseId: z.uuid() });

export const exitTermsSchema = z.object({
  exitCaseId: z.uuid(),
  approvedLastWorkingDate: isoDate,
  shortfallTreatment: z.enum(SHORTFALL_TREATMENTS),
});
export type ExitTermsInput = z.input<typeof exitTermsSchema>;

const rating = z.coerce.number().int().min(1).max(5);
export const exitInterviewSchema = z.object({
  exitCaseId: z.uuid(),
  conductedOn: isoDate,
  primaryReason: z.enum(EXIT_REASON_CATEGORIES),
  ratings: z.object({
    role: rating,
    manager: rating,
    growth: rating,
    compensation: rating,
    culture: rating,
    workLife: rating,
  }),
  wouldRecommend: z.boolean(),
  regretted: z.boolean(),
  comments: optionalText(4000),
});
export type ExitInterviewInput = z.input<typeof exitInterviewSchema>;

const rupees = z.coerce.number({ error: "Enter an amount" }).nonnegative("Cannot be negative").max(100_000_000, "Amount is too large");
export const settlementInputsSchema = z.object({
  exitCaseId: z.uuid(),
  noticeRecoveryDays: days,
  noticePayInLieuDays: days,
  leaveEncashmentDays: z.coerce.number({ error: "Enter a number" }).min(0).max(365).multipleOf(0.5, "Use half-day steps"),
  otherRecoveries: rupees,
  otherRecoveriesNote: optionalText(500),
  otherPayments: rupees,
  otherPaymentsNote: optionalText(500),
  notes: optionalText(2000),
});
export type SettlementInputsInput = z.input<typeof settlementInputsSchema>;

export const settlementStatusSchema = z.object({
  exitCaseId: z.uuid(),
  status: z.enum(["draft", "pending_approval", "approved", "paid"]),
  confirm: z.literal(true, { error: "Confirm this change" }),
});

export const generateLettersSchema = z.object({
  exitCaseId: z.uuid(),
  kinds: z.array(z.enum(["experience", "relieving"])).min(1, "Choose at least one letter"),
});

export const exitAssetReturnSchema = z.object({
  exitCaseId: z.uuid(),
  assignmentId: z.uuid(),
  condition: optionalText(200),
});

export const completeExitSchema = z.object({
  exitCaseId: z.uuid(),
  eligibleForRehire: z.boolean(),
  exitReason: optionalText(500),
  confirm: z.literal(true, { error: "Confirm the exit" }),
});

export const cancelExitSchema = z.object({
  exitCaseId: z.uuid(),
  reason: z.string().trim().min(5, "Explain why the exit is cancelled").max(500),
});

export const suspendAccessSchema = z.object({
  exitCaseId: z.uuid(),
  confirm: z.literal(true, { error: "Confirm the suspension" }),
});
