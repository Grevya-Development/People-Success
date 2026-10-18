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
const email = z.string().trim().toLowerCase().email("Enter a valid email").max(200);
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number")
  .nullish()
  .or(z.literal("").transform(() => null));
const url = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "Enter a full link starting with https://")
  .nullish()
  .transform((v) => (v ? v : null));

/** Rupees as typed in a form; empty means "not set". Converted to paise on the server. */
const optionalRupees = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 0) {
      ctx.addIssue({ code: "custom", message: "Enter a valid amount" });
      return z.NEVER;
    }
    if (n > 1_000_000_000) {
      ctx.addIssue({ code: "custom", message: "Amount is too large" });
      return z.NEVER;
    }
    return n;
  });
const optionalInt = (min: number, max: number) =>
  z
    .union([z.number(), z.string()])
    .nullish()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `Enter a whole number from ${min} to ${max}` });
        return z.NEVER;
      }
      return n;
    });

/** Booleans arriving from FormData ("true"/"on") or JSON. */
const formBool = (fallback: boolean) =>
  z
    .union([z.boolean(), z.enum(["true", "false", "on", "off", ""])])
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : v === true || v === "true" || v === "on"));

export const idSchema = z.object({ id: z.uuid() });

/* ------------------------------------------------------------------ */
/* Enumerations and labels (mirrors the database enums)                */
/* ------------------------------------------------------------------ */

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern", "consultant", "temporary"] as const;
export const WORK_MODES = ["onsite", "remote", "hybrid"] as const;
export const STAGE_KINDS = ["applied", "screening", "review", "assessment", "interview", "final", "offer", "hired"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];
export const STAGE_KIND_LABELS: Record<StageKind, string> = {
  applied: "Applied",
  screening: "Screening",
  review: "Review",
  assessment: "Assessment",
  interview: "Interview",
  final: "Final review",
  offer: "Offer",
  hired: "Hired",
};

/** Default pipeline seeded for every tenant on first use. */
export const DEFAULT_STAGES: { name: string; kind: StageKind }[] = [
  { name: "Applied", kind: "applied" },
  { name: "Screening", kind: "screening" },
  { name: "Recruiter Review", kind: "review" },
  { name: "Assessment", kind: "assessment" },
  { name: "Interview", kind: "interview" },
  { name: "Final Review", kind: "final" },
  { name: "Offer", kind: "offer" },
  { name: "Hired", kind: "hired" },
];

export const REQUISITION_STATUSES = ["draft", "pending_approval", "approved", "rejected", "on_hold", "filled", "cancelled"] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];
export const OPENING_STATUSES = ["draft", "published", "paused", "closed"] as const;
export type OpeningStatus = (typeof OPENING_STATUSES)[number];
export const APPLICATION_STATUSES = ["active", "rejected", "withdrawn", "hired"] as const;
export const OFFER_STATUSES = ["draft", "pending_approval", "approved", "sent", "accepted", "declined", "expired", "rescinded"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];
export const INTERVIEW_MODES = ["video", "phone", "onsite", "assessment"] as const;
export const INTERVIEW_STATUSES = ["scheduled", "completed", "cancelled", "no_show"] as const;
export const RECOMMENDATIONS = ["strong_yes", "yes", "no", "strong_no"] as const;
export const RECOMMENDATION_LABELS: Record<(typeof RECOMMENDATIONS)[number], string> = {
  strong_yes: "Strong yes",
  yes: "Yes",
  no: "No",
  strong_no: "Strong no",
};
export const CANDIDATE_SOURCES = ["career_page", "referral", "agency", "job_board", "sourced", "internal"] as const;
export const SOURCE_LABELS: Record<string, string> = {
  career_page: "Careers page",
  referral: "Referral",
  agency: "Agency",
  job_board: "Job board",
  sourced: "Sourced",
  internal: "Internal",
};
export const REFERRAL_STATUSES = ["submitted", "in_review", "interviewing", "hired", "rejected", "duplicate", "withdrawn"] as const;
export const REWARD_STATUSES = ["not_applicable", "pending", "eligible", "approved", "paid", "cancelled"] as const;

/** Resumes on the careers page and referral form. */
export const RESUME_MAX_BYTES = 5 * 1024 * 1024;
export const RESUME_EXTENSIONS = ["pdf", "docx"] as const;
export const RESUME_ACCEPT = ".pdf,.docx";

/** How long candidate data is kept after the last application (DPDP retention). */
export const CANDIDATE_RETENTION_MONTHS = 12;

export const consentText = (company: string) =>
  `I consent to ${company} processing the personal data in this application (contact details, resume and answers) for the purpose of evaluating me for this and similar roles. ` +
  `The data is kept for ${CANDIDATE_RETENTION_MONTHS} months after my last application and then deleted, unless I join. ` +
  `I can ask for access, correction or deletion at any time by replying to the confirmation email.`;

/* ------------------------------------------------------------------ */
/* Stages and scorecards                                               */
/* ------------------------------------------------------------------ */

export const stageSchema = z.object({
  name: z.string().trim().min(2, "Enter a stage name").max(40),
  kind: z.enum(STAGE_KINDS),
});
export const renameStageSchema = z.object({ id: z.uuid(), name: z.string().trim().min(2, "Enter a stage name").max(40) });
export const moveStageOrderSchema = z.object({ id: z.uuid(), direction: z.enum(["up", "down"]) });
export const stageActiveSchema = z.object({ id: z.uuid(), isActive: z.boolean() });

export const scorecardSchema = z.object({
  id: optionalId,
  name: z.string().trim().min(2, "Enter a name").max(80),
  /** One criterion per line: "Label" or "Label: description". */
  criteriaText: z.string().trim().min(2, "Add at least one criterion").max(4000),
});
export type ScorecardInput = z.output<typeof scorecardSchema>;

export function parseCriteria(text: string) {
  const seen = new Set<string>();
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((line) => {
      const [label, ...rest] = line.split(":");
      const base =
        label
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 40) || "criterion";
      let key = base;
      for (let i = 2; seen.has(key); i++) key = `${base}_${i}`;
      seen.add(key);
      const description = rest.join(":").trim();
      return { key, label: label.trim().slice(0, 80), ...(description ? { description: description.slice(0, 200) } : {}) };
    });
}

/* ------------------------------------------------------------------ */
/* Requisitions                                                        */
/* ------------------------------------------------------------------ */

export const requisitionSchema = z
  .object({
    title: z.string().trim().min(2, "Enter a job title").max(120),
    departmentId: optionalId,
    designationId: optionalId,
    locationId: optionalId,
    legalEntityId: optionalId,
    positionId: optionalId,
    headcount: z.coerce.number().int("Whole number").min(1, "At least 1").max(500),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    reason: z.enum(["new", "backfill"]),
    backfillForEmployeeId: optionalId,
    budgetMinAnnual: optionalRupees,
    budgetMaxAnnual: optionalRupees,
    justification: z.string().trim().min(10, "Explain why this role is needed (at least 10 characters)").max(4000),
    hiringManagerEmployeeId: optionalId,
    recruiterUserId: optionalId,
    targetStartDate: optionalDate,
  })
  .superRefine((v, ctx) => {
    if (v.reason === "backfill" && !v.backfillForEmployeeId) {
      ctx.addIssue({ code: "custom", path: ["backfillForEmployeeId"], message: "Choose who this replaces" });
    }
    if (v.budgetMinAnnual != null && v.budgetMaxAnnual != null && v.budgetMaxAnnual < v.budgetMinAnnual) {
      ctx.addIssue({ code: "custom", path: ["budgetMaxAnnual"], message: "Maximum must be at least the minimum" });
    }
  });
export type RequisitionInput = z.output<typeof requisitionSchema>;
export type RequisitionFormValues = z.input<typeof requisitionSchema>;

export const updateRequisitionSchema = z.object({ id: z.uuid(), data: requisitionSchema });
export const requisitionTransitionSchema = z.object({
  id: z.uuid(),
  to: z.enum(["on_hold", "approved", "cancelled", "draft"]),
  reason: optionalText(500),
});

/* ------------------------------------------------------------------ */
/* Openings                                                            */
/* ------------------------------------------------------------------ */

export const QUESTION_TYPES = ["text", "yes_no", "number"] as const;

export const screeningQuestionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(3, "Write the question").max(200),
  type: z.enum(QUESTION_TYPES),
  required: z.boolean(),
});

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

export const openingSchema = z
  .object({
    requisitionId: optionalId,
    title: z.string().trim().min(2, "Enter a job title").max(120),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .max(60)
      .refine((v) => v === "" || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v), "Use lowercase letters, numbers and hyphens")
      .optional()
      .transform((v) => v || ""),
    description: z.string().trim().min(20, "Describe the role (at least 20 characters)").max(20_000),
    requirements: optionalText(10_000),
    /** Comma-separated in forms. */
    skills: z
      .union([z.array(z.string()), z.string()])
      .transform((v) =>
        [...new Set((Array.isArray(v) ? v : v.split(",")).map((s) => s.trim()).filter(Boolean).map((s) => s.slice(0, 40)))].slice(0, 30),
      ),
    experienceMinYears: optionalInt(0, 50),
    experienceMaxYears: optionalInt(0, 50),
    departmentId: optionalId,
    locationId: optionalId,
    workMode: z.enum(WORK_MODES),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    salaryMinAnnual: optionalRupees,
    salaryMaxAnnual: optionalRupees,
    showSalary: z.boolean(),
    openings: z.coerce.number().int("Whole number").min(1, "At least 1").max(500),
    closesOn: optionalDate,
    hiringManagerEmployeeId: optionalId,
    recruiterUserId: optionalId,
    questions: z.array(screeningQuestionSchema).max(10, "Up to 10 questions"),
  })
  .superRefine((v, ctx) => {
    if (v.experienceMinYears != null && v.experienceMaxYears != null && v.experienceMaxYears < v.experienceMinYears) {
      ctx.addIssue({ code: "custom", path: ["experienceMaxYears"], message: "Maximum must be at least the minimum" });
    }
    if (v.salaryMinAnnual != null && v.salaryMaxAnnual != null && v.salaryMaxAnnual < v.salaryMinAnnual) {
      ctx.addIssue({ code: "custom", path: ["salaryMaxAnnual"], message: "Maximum must be at least the minimum" });
    }
    if (v.showSalary && v.salaryMinAnnual == null && v.salaryMaxAnnual == null) {
      ctx.addIssue({ code: "custom", path: ["showSalary"], message: "Enter a salary range to show it" });
    }
  });
export type OpeningInput = z.output<typeof openingSchema>;
export type OpeningFormValues = z.input<typeof openingSchema>;
export const updateOpeningSchema = z.object({ id: z.uuid(), data: openingSchema });
export const openingTransitionSchema = z.object({ id: z.uuid(), to: z.enum(["published", "paused", "closed"]) });

/* ------------------------------------------------------------------ */
/* Public application (careers site)                                   */
/* ------------------------------------------------------------------ */

export const publicApplicationSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(80),
  jobSlug: z.string().trim().min(1).max(80),
  firstName: z.string().trim().min(1, "Enter your first name").max(80),
  lastName: optionalText(80),
  email,
  phone,
  currentCompany: optionalText(120),
  currentTitle: optionalText(120),
  experienceYears: optionalInt(0, 60),
  linkedinUrl: url,
  coverNote: optionalText(3000),
  answers: z.record(z.string(), z.string().trim().max(2000)).default({}),
  consent: z.literal(true, { error: "Please give consent so we can process your application" }),
  /** Honeypot: real people never fill this hidden field. */
  website: z.string().max(500).optional(),
});
export type PublicApplicationInput = z.output<typeof publicApplicationSchema>;

/* ------------------------------------------------------------------ */
/* Candidates and pipeline                                             */
/* ------------------------------------------------------------------ */

export const candidateListSchema = z.object({
  q: z.string().trim().max(100).optional().default(""),
  source: z.enum(CANDIDATE_SOURCES).optional().catch(undefined),
  tag: z.string().trim().max(40).optional().catch(undefined),
  poolId: z.uuid().optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1).catch(1),
});
export type CandidateListQuery = z.output<typeof candidateListSchema>;

export const manualCandidateSchema = z.object({
  firstName: z.string().trim().min(1, "Enter a first name").max(80),
  lastName: optionalText(80),
  email,
  phone,
  currentCompany: optionalText(120),
  currentTitle: optionalText(120),
  experienceYears: optionalInt(0, 60),
  linkedinUrl: url,
  source: z.enum(["agency", "job_board", "sourced", "internal"]),
  sourceDetail: optionalText(120),
  openingId: optionalId,
  consentConfirmed: z.literal(true, { error: "Confirm the candidate agreed to be considered" }),
});
export type ManualCandidateInput = z.output<typeof manualCandidateSchema>;

export const candidateTagsSchema = z.object({
  candidateId: z.uuid(),
  tags: z
    .union([z.array(z.string()), z.string()])
    .transform((v) =>
      [...new Set((Array.isArray(v) ? v : v.split(",")).map((t) => t.trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 20),
    ),
});
export const talentPoolSchema = z.object({ name: z.string().trim().min(2, "Enter a name").max(80), description: optionalText(300) });
export const poolMemberSchema = z.object({ poolId: z.uuid(), candidateId: z.uuid(), remove: z.boolean().optional() });

export const moveStageSchema = z.object({ applicationId: z.uuid(), stageId: z.uuid(), note: optionalText(500) });
export const rejectApplicationSchema = z.object({
  applicationId: z.uuid(),
  reason: z.string().trim().min(3, "Give a reason (kept internal)").max(500),
  sendEmail: z.boolean(),
  emailBody: optionalText(4000),
});
export const withdrawApplicationSchema = z.object({ applicationId: z.uuid(), reason: optionalText(500) });
export const noteSchema = z.object({ applicationId: z.uuid(), body: z.string().trim().min(1, "Write a note").max(4000) });
export const candidateEmailSchema = z.object({
  applicationId: z.uuid(),
  subject: z.string().trim().min(3, "Enter a subject").max(200),
  body: z.string().trim().min(10, "Write the message").max(6000),
});
export const applyToOpeningSchema = z.object({ candidateId: z.uuid(), openingId: z.uuid() });

/* ------------------------------------------------------------------ */
/* AI assistance                                                       */
/* ------------------------------------------------------------------ */

export const parseResumeSchema = z.object({ candidateId: z.uuid(), pastedText: optionalText(60_000) });
export const matchSchema = z.object({ applicationId: z.uuid(), pastedText: optionalText(60_000) });
export const questionsSchema = z.object({ openingId: z.uuid(), roundName: z.string().trim().min(2).max(80) });
export const EMAIL_DRAFT_KINDS = ["interview_invite", "status_update", "rejection", "offer_follow_up"] as const;
export const EMAIL_DRAFT_LABELS: Record<(typeof EMAIL_DRAFT_KINDS)[number], string> = {
  interview_invite: "Interview invitation",
  status_update: "Status update",
  rejection: "Rejection",
  offer_follow_up: "Offer follow-up",
};
export const emailDraftSchema = z.object({ applicationId: z.uuid(), kind: z.enum(EMAIL_DRAFT_KINDS) });

/* ------------------------------------------------------------------ */
/* Interviews and feedback                                             */
/* ------------------------------------------------------------------ */

/** "yyyy-MM-ddTHH:mm" from <input type="datetime-local">, interpreted in IST. */
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Choose a date and time");

export const scheduleInterviewSchema = z
  .object({
    applicationId: z.uuid(),
    roundName: z.string().trim().min(2, "Name the round").max(80),
    mode: z.enum(INTERVIEW_MODES),
    start: localDateTime,
    durationMinutes: z.coerce.number().int().min(15, "At least 15 minutes").max(480),
    location: optionalText(200),
    meetingUrl: url,
    panelUserIds: z.array(z.uuid()).min(1, "Add at least one interviewer").max(10),
    scorecardTemplateId: optionalId,
    notifyCandidate: z.boolean(),
    allowConflicts: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "video" && !v.meetingUrl) {
      ctx.addIssue({ code: "custom", path: ["meetingUrl"], message: "Add the meeting link" });
    }
    if (v.mode === "onsite" && !v.location) ctx.addIssue({ code: "custom", path: ["location"], message: "Add the venue" });
  });
export type ScheduleInterviewInput = z.output<typeof scheduleInterviewSchema>;

export const interviewStatusSchema = z.object({ interviewId: z.uuid(), status: z.enum(["completed", "cancelled", "no_show"]), reason: optionalText(300) });

export const feedbackSchema = z.object({
  interviewId: z.uuid(),
  recommendation: z.enum(RECOMMENDATIONS),
  overallRating: z.coerce.number().int().min(1, "Rate 1 to 5").max(5, "Rate 1 to 5"),
  scores: z
    .array(z.object({ key: z.string().min(1).max(60), rating: z.coerce.number().int().min(1).max(5), notes: optionalText(1000) }))
    .max(20),
  strengths: optionalText(4000),
  concerns: optionalText(4000),
});
export type FeedbackInput = z.output<typeof feedbackSchema>;

/** IST wall-clock "yyyy-MM-ddTHH:mm" → Date. */
export function istLocalToDate(local: string) {
  return new Date(`${local}:00+05:30`);
}

/** Format an instant in IST for display, e.g. "18 Oct 2026, 14:30 IST". */
export function formatIst(d: string | Date | null | undefined, opts: { withZone?: boolean } = {}) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const s = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return opts.withZone === false ? s : `${s} IST`;
}

/* ------------------------------------------------------------------ */
/* Offers                                                              */
/* ------------------------------------------------------------------ */

export const offerSchema = z.object({
  applicationId: z.uuid(),
  designationId: optionalId,
  departmentId: optionalId,
  locationId: optionalId,
  legalEntityId: z.uuid("Choose a legal entity"),
  reportingManagerId: optionalId,
  employmentType: z.enum(EMPLOYMENT_TYPES),
  joiningDate: isoDate,
  annualCtc: z.coerce.number({ error: "Enter the annual CTC" }).positive("Enter the annual CTC").max(1_000_000_000, "Amount is too large"),
  probationMonths: z.coerce.number().int().min(0).max(24),
  noticePeriodDays: z.coerce.number().int().min(0).max(365),
  expiresOn: isoDate,
});
export type OfferInput = z.output<typeof offerSchema>;
export type OfferFormValues = z.input<typeof offerSchema>;
export const updateOfferSchema = z.object({ offerId: z.uuid(), data: offerSchema.omit({ applicationId: true }) });
export const rescindOfferSchema = z.object({ offerId: z.uuid(), reason: z.string().trim().min(3, "Give a reason").max(500) });

export const offerResponseSchema = z.object({
  token: z.string().trim().min(20).max(200),
  decision: z.enum(["accept", "decline"]),
  note: optionalText(1000),
  confirm: z.literal(true, { error: "Please confirm" }),
});

/* ------------------------------------------------------------------ */
/* Referrals                                                           */
/* ------------------------------------------------------------------ */

export const referralSchema = z.object({
  openingId: z.uuid("Choose a job"),
  firstName: z.string().trim().min(1, "Enter a first name").max(80),
  lastName: optionalText(80),
  email,
  phone,
  linkedinUrl: url,
  relationship: z.enum(["former_colleague", "friend", "classmate", "family", "professional_network", "other"]),
  note: optionalText(2000),
  consentConfirmed: formBool(false).refine((v) => v, "Confirm the candidate agreed to be referred"),
});
export type ReferralInput = z.output<typeof referralSchema>;
export const RELATIONSHIP_LABELS: Record<string, string> = {
  former_colleague: "Former colleague",
  friend: "Friend",
  classmate: "Classmate",
  family: "Family",
  professional_network: "Professional network",
  other: "Other",
};

export const rewardPolicySchema = z.object({
  id: optionalId,
  name: z.string().trim().min(2, "Enter a name").max(80),
  amount: z.coerce.number({ error: "Enter an amount" }).positive("Enter an amount").max(10_000_000),
  eligibleAfterDays: z.coerce.number().int().min(0).max(730),
  isActive: z.boolean(),
});
export const rewardDecisionSchema = z.object({ referralId: z.uuid(), action: z.enum(["approve", "post_to_payroll", "mark_paid", "cancel"]) });
