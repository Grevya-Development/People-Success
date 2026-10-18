import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const optionalDate = z
  .union([isoDate, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));
const optionalText = (max = 2000) =>
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
const optionalNumber = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: "custom", message: "Enter a number" });
      return z.NEVER;
    }
    return n;
  });
const intIn = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const idList = (max = 200) => z.array(z.uuid()).max(max).default([]);

export const idSchema = z.object({ id: z.uuid() });

/* ------------------------------------------------------------------ */
/* Performance setup                                                   */
/* ------------------------------------------------------------------ */

export const ratingScaleSchema = z
  .object({
    id: optionalId,
    name: z.string().trim().min(1, "Enter a name").max(80),
    levels: z
      .array(
        z.object({
          value: intIn(0, 10),
          label: z.string().trim().min(1, "Enter a label").max(60),
          description: optionalText(200).transform((v) => v ?? undefined),
        }),
      )
      .min(2, "Add at least two levels")
      .max(10),
  })
  .refine((v) => new Set(v.levels.map((l) => l.value)).size === v.levels.length, { message: "Level values must be unique", path: ["levels"] });

export const competencySchema = z.object({
  id: optionalId,
  name: z.string().trim().min(1, "Enter a name").max(80),
  description: optionalText(500),
  category: optionalText(60),
  isActive: z.boolean().default(true),
});

export const REVIEW_KINDS = ["self", "manager", "peer", "upward"] as const;
export type ReviewKindValue = (typeof REVIEW_KINDS)[number];
export const REVIEW_KIND_LABELS: Record<ReviewKindValue, string> = {
  self: "Self review",
  manager: "Manager review",
  peer: "Peer review",
  upward: "Upward feedback",
};

export const reviewQuestionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1, "Enter the question").max(300),
  type: z.enum(["rating", "text", "competency"]),
  competencyId: optionalId.transform((v) => v ?? undefined),
  required: z.boolean().default(true),
  forKinds: z.array(z.enum(REVIEW_KINDS)).min(1, "Choose who answers"),
});

export const reviewTemplateSchema = z
  .object({
    id: optionalId,
    name: z.string().trim().min(1, "Enter a name").max(100),
    questions: z.array(reviewQuestionSchema).min(1, "Add at least one question").max(40),
    includeGoals: z.boolean().default(true),
    goalsWeightPercent: intIn(0, 100).default(50),
  })
  .refine((v) => new Set(v.questions.map((q) => q.id)).size === v.questions.length, { message: "Question ids must be unique", path: ["questions"] })
  .refine((v) => v.questions.every((q) => q.type !== "competency" || q.competencyId), { message: "Pick a competency for competency questions", path: ["questions"] });

/* ------------------------------------------------------------------ */
/* Goals                                                               */
/* ------------------------------------------------------------------ */

export const GOAL_VISIBILITIES = ["private", "team", "company"] as const;
export const GOAL_KINDS = ["goal", "okr", "kpi"] as const;
export const GOAL_STATUSES = ["draft", "active", "achieved", "partially_achieved", "missed", "cancelled"] as const;

export const goalSchema = z.object({
  id: optionalId,
  /** Null for company / department goals. */
  employeeId: optionalId,
  departmentId: optionalId,
  cycleId: optionalId,
  parentGoalId: optionalId,
  kind: z.enum(GOAL_KINDS).default("goal"),
  title: z.string().trim().min(1, "Enter a title").max(200),
  description: optionalText(2000),
  metricUnit: optionalText(30),
  startValue: optionalNumber,
  targetValue: optionalNumber,
  weight: intIn(0, 100).default(0),
  dueOn: optionalDate,
  visibility: z.enum(GOAL_VISIBILITIES).default("private"),
});
export type GoalInput = z.input<typeof goalSchema>;

export const goalCheckinSchema = z.object({
  goalId: z.uuid(),
  value: optionalNumber,
  progressPercent: z.union([intIn(0, 100), z.literal(""), z.null()]).optional().transform((v) => (v === "" || v == null ? null : v)),
  status: z.enum(GOAL_STATUSES).optional(),
  note: optionalText(1000),
});

/* ------------------------------------------------------------------ */
/* Cycles and reviews                                                  */
/* ------------------------------------------------------------------ */

export const CYCLE_KINDS = ["annual", "half_yearly", "quarterly", "probation"] as const;

export const reviewCycleSchema = z
  .object({
    id: optionalId,
    name: z.string().trim().min(1, "Enter a name").max(120),
    kind: z.enum(CYCLE_KINDS).default("annual"),
    periodStart: isoDate,
    periodEnd: isoDate,
    templateId: z.uuid("Choose a template"),
    ratingScaleId: optionalId,
    selfDueOn: optionalDate,
    peerDueOn: optionalDate,
    managerDueOn: optionalDate,
    calibrationDueOn: optionalDate,
    includePeers: z.boolean().default(false),
    includeUpward: z.boolean().default(false),
    departmentIds: idList(),
    locationIds: idList(),
    /** Joined on or before this date; defaults to periodEnd − 30 days. */
    joinedOnOrBefore: optionalDate,
  })
  .refine((v) => v.periodEnd >= v.periodStart, { message: "Period end must be after the start", path: ["periodEnd"] });
export type ReviewCycleInput = z.input<typeof reviewCycleSchema>;

export const assignPeersSchema = z.object({
  cycleId: z.uuid(),
  employeeId: z.uuid(),
  peerIds: z.array(z.uuid()).max(3, "Choose up to 3 peers"),
});

export const saveReviewSchema = z.object({
  reviewId: z.uuid(),
  responses: z.record(
    z.string().max(40),
    z.object({ rating: z.number().int().min(0).max(10).optional(), text: z.string().max(5000).optional() }),
  ),
  /** Manager reviews: chosen overall rating (may differ from the suggestion). */
  overallRating: z.number().min(0).max(10).nullish(),
  overrideJustification: optionalText(2000),
  developmentAreas: optionalText(2000),
  submit: z.boolean().default(false),
});
export type SaveReviewInput = z.input<typeof saveReviewSchema>;

export const calibrateSchema = z.object({
  reviewId: z.uuid(),
  calibratedRating: z.number().min(0).max(10),
  note: z.string().trim().min(3, "Explain the calibration").max(1000),
});

export const promotionSchema = z.object({
  cycleId: optionalId,
  employeeId: z.uuid(),
  toDesignationId: optionalId,
  toGradeId: optionalId,
  /** Rupees; stored as paise. */
  proposedAnnualCtc: optionalNumber,
  justification: z.string().trim().min(10, "Add a justification").max(3000),
});

export const promotionDecisionSchema = z.object({ id: z.uuid(), decision: z.enum(["approved", "rejected", "deferred"]) });

export const pipSchema = z
  .object({
    employeeId: z.uuid(),
    startsOn: isoDate,
    endsOn: isoDate,
    objectives: z
      .array(z.object({ title: z.string().trim().min(1, "Enter an objective").max(300), measure: z.string().trim().min(1, "How will it be measured?").max(300) }))
      .min(1, "Add at least one objective")
      .max(10),
  })
  .refine((v) => v.endsOn > v.startsOn, { message: "End date must be after the start", path: ["endsOn"] });

export const PIP_OUTCOMES = ["successful", "extended", "unsuccessful", "cancelled"] as const;
export const pipUpdateSchema = z.object({
  id: z.uuid(),
  objectiveStatuses: z.array(z.enum(["open", "met", "not_met"])).max(10).optional(),
  outcome: z.enum(PIP_OUTCOMES).nullish(),
  outcomeNote: optionalText(2000),
});

/* ------------------------------------------------------------------ */
/* Learning                                                            */
/* ------------------------------------------------------------------ */

export const COURSE_FORMATS = ["link", "video", "document", "classroom", "external"] as const;
export const COURSE_FORMAT_LABELS: Record<(typeof COURSE_FORMATS)[number], string> = {
  link: "Link",
  video: "Video",
  document: "Document",
  classroom: "Classroom",
  external: "External",
};

export const quizSchema = z.object({
  passMark: intIn(1, 100),
  questions: z
    .array(
      z
        .object({
          id: z.string().trim().min(1).max(40),
          prompt: z.string().trim().min(1, "Enter the question").max(500),
          options: z.array(z.string().trim().min(1, "Enter the option").max(200)).min(2, "Add at least two options").max(6),
          answer: z.coerce.number().int().min(0),
        })
        .refine((q) => q.answer < q.options.length, { message: "Pick the correct option", path: ["answer"] }),
    )
    .min(1, "Add at least one question")
    .max(50),
});

export const courseSchema = z.object({
  id: optionalId,
  title: z.string().trim().min(1, "Enter a title").max(200),
  description: optionalText(4000),
  format: z.enum(COURSE_FORMATS).default("link"),
  provider: optionalText(120),
  url: z
    .union([z.url("Enter a valid URL").max(1000), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v : null)),
  durationMinutes: z.union([intIn(1, 100000), z.literal(""), z.null()]).optional().transform((v) => (v === "" || v == null ? null : v)),
  skills: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  isMandatory: z.boolean().default(false),
  certificateValidityMonths: z.union([intIn(1, 120), z.literal(""), z.null()]).optional().transform((v) => (v === "" || v == null ? null : v)),
  quiz: quizSchema.nullish().transform((v) => v ?? null),
  isActive: z.boolean().default(true),
});
export type CourseInput = z.input<typeof courseSchema>;

export const learningPathSchema = z.object({
  id: optionalId,
  title: z.string().trim().min(1, "Enter a title").max(200),
  description: optionalText(2000),
  courseIds: z.array(z.uuid()).min(1, "Add at least one course").max(50),
  isActive: z.boolean().default(true),
});

export const learningAssignmentSchema = z
  .object({
    courseId: optionalId,
    pathId: optionalId,
    all: z.boolean().default(false),
    newJoiners: z.boolean().default(false),
    departmentIds: idList(),
    designationIds: idList(),
    dueInDays: intIn(1, 365).default(30),
  })
  .refine((v) => !!v.courseId !== !!v.pathId, { message: "Choose a course or a learning path", path: ["courseId"] })
  .refine((v) => v.all || v.newJoiners || v.departmentIds.length > 0 || v.designationIds.length > 0, {
    message: "Choose who should take it",
    path: ["all"],
  });

export const enrollSelfSchema = z.object({ courseId: z.uuid() });
export const progressSchema = z.object({ enrollmentId: z.uuid(), progressPercent: intIn(0, 100) });
export const quizAttemptSchema = z.object({ enrollmentId: z.uuid(), answers: z.record(z.string().max(40), z.number().int().min(0).max(10)) });

/* ------------------------------------------------------------------ */
/* Engagement                                                          */
/* ------------------------------------------------------------------ */

export const SURVEY_KINDS = ["pulse", "engagement", "onboarding", "exit", "custom"] as const;
export const SURVEY_QUESTION_TYPES = ["scale", "enps", "choice", "text"] as const;
export const SURVEY_QUESTION_TYPE_LABELS: Record<(typeof SURVEY_QUESTION_TYPES)[number], string> = {
  scale: "Scale 1–5",
  enps: "eNPS 0–10",
  choice: "Multiple choice",
  text: "Free text",
};

export const surveyQuestionSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    label: z.string().trim().min(1, "Enter the question").max(300),
    type: z.enum(SURVEY_QUESTION_TYPES),
    options: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
    driver: optionalText(60).transform((v) => v ?? undefined),
    required: z.boolean().default(true),
  })
  .refine((q) => q.type !== "choice" || (q.options?.length ?? 0) >= 2, { message: "Add at least two options", path: ["options"] });

export const surveySchema = z
  .object({
    id: optionalId,
    title: z.string().trim().min(1, "Enter a title").max(200),
    kind: z.enum(SURVEY_KINDS).default("pulse"),
    description: optionalText(2000),
    isAnonymous: z.boolean().default(true),
    minGroupSize: intIn(3, 50).default(5),
    questions: z.array(surveyQuestionSchema).min(1, "Add at least one question").max(60),
    audienceAll: z.boolean().default(true),
    departmentIds: idList(),
    locationIds: idList(),
    opensOn: optionalDate,
    closesOn: optionalDate,
  })
  .refine((v) => new Set(v.questions.map((q) => q.id)).size === v.questions.length, { message: "Question ids must be unique", path: ["questions"] })
  .refine((v) => v.questions.filter((q) => q.type === "enps").length <= 1, { message: "Use at most one eNPS question", path: ["questions"] })
  .refine((v) => v.audienceAll || v.departmentIds.length > 0 || v.locationIds.length > 0, { message: "Choose an audience", path: ["audienceAll"] })
  .refine((v) => !v.opensOn || !v.closesOn || v.closesOn >= v.opensOn, { message: "Close date must be after the open date", path: ["closesOn"] });
export type SurveyInput = z.input<typeof surveySchema>;

export const surveyResponseSchema = z.object({
  surveyId: z.uuid(),
  answers: z.record(z.string().max(40), z.union([z.number(), z.string().max(2000)])),
});

export const actionPlanSchema = z.object({
  id: optionalId,
  surveyId: optionalId,
  departmentId: optionalId,
  ownerEmployeeId: z.uuid("Choose an owner"),
  focusArea: z.string().trim().min(1, "Enter a focus area").max(200),
  actions: z.array(z.object({ title: z.string().trim().min(1).max(300), dueOn: optionalDate.transform((v) => v ?? undefined), done: z.boolean().default(false) })).max(20).default([]),
  status: z.enum(["open", "in_progress", "done"]).default("open"),
});

export const RECOGNITION_BADGES = ["Team player", "Customer hero", "Above and beyond", "Innovator", "Mentor", "Problem solver", "Thank you"] as const;
export const recognitionSchema = z.object({
  toEmployeeId: z.uuid("Choose a colleague"),
  badge: z.enum(RECOGNITION_BADGES),
  message: z.string().trim().min(5, "Say a little more").max(1000),
  isPublic: z.boolean().default(true),
});

const actionItem = z.object({ text: z.string().trim().min(1).max(300), owner: z.enum(["manager", "employee"]), done: z.boolean().default(false) });
export const oneOnOneSchema = z.object({
  id: optionalId,
  /** The other participant: a direct report (if you are the manager) or your manager. */
  withEmployeeId: z.uuid("Choose who the 1:1 is with"),
  heldOn: isoDate,
  agenda: optionalText(4000),
  notes: optionalText(8000),
  actionItems: z.array(actionItem).max(30).default([]),
});

export const careerPlanSchema = z.object({
  employeeId: z.uuid(),
  aspirations: optionalText(4000),
  targetRoles: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
  interestedInMobility: z.boolean().default(false),
  actions: z
    .array(z.object({ title: z.string().trim().min(1).max(300), kind: z.enum(["course", "project", "mentoring", "other"]), dueOn: optionalDate.transform((v) => v ?? undefined), done: z.boolean().default(false) }))
    .max(40)
    .default([]),
});

export const careerManagerNotesSchema = z.object({ employeeId: z.uuid(), managerNotes: optionalText(4000) });

export const READINESS = ["ready_now", "1_2_years", "3_plus_years"] as const;
export const READINESS_LABELS: Record<(typeof READINESS)[number], string> = {
  ready_now: "Ready now",
  "1_2_years": "1–2 years",
  "3_plus_years": "3+ years",
};
export const successionPlanSchema = z.object({
  id: optionalId,
  positionId: optionalId,
  roleTitle: z.string().trim().min(1, "Enter the role").max(200),
  incumbentEmployeeId: optionalId,
  criticality: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  candidates: z.array(z.object({ employeeId: z.uuid(), readiness: z.enum(READINESS), notes: optionalText(500).transform((v) => v ?? undefined) })).max(10).default([]),
});
