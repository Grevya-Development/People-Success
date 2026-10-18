import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { money, pk, tenantRef, timestamps } from "./_helpers";
import { tenants } from "./identity";

/* ------------------------------------------------------------------ */
/* Performance                                                         */
/* ------------------------------------------------------------------ */

export type RatingLevel = { value: number; label: string; description?: string };

export const ratingScales = pgTable(
  "rating_scales",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text().notNull(),
    levels: jsonb().$type<RatingLevel[]>().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("rating_scales_name_key").on(t.tenantId, t.name)],
);

export const competencies = pgTable(
  "competencies",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text().notNull(),
    description: text(),
    category: text(),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("competencies_name_key").on(t.tenantId, t.name)],
);

export type ReviewQuestion = {
  id: string;
  label: string;
  type: "rating" | "text" | "competency";
  competencyId?: string;
  required: boolean;
  forKinds: ("self" | "manager" | "peer" | "upward")[];
};

export const reviewTemplates = pgTable(
  "review_templates",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text().notNull(),
    questions: jsonb().$type<ReviewQuestion[]>().notNull(),
    includeGoals: boolean().notNull().default(true),
    goalsWeightPercent: smallint().notNull().default(50),
    ...timestamps,
  },
  (t) => [uniqueIndex("review_templates_name_key").on(t.tenantId, t.name)],
);

export const cycleStatus = pgEnum("cycle_status", ["draft", "active", "calibration", "closed"]);

export const reviewCycles = pgTable(
  "review_cycles",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text().notNull(),
    /** "annual" | "half_yearly" | "quarterly" | "probation" */
    kind: text().notNull().default("annual"),
    periodStart: date().notNull(),
    periodEnd: date().notNull(),
    templateId: uuid().notNull(),
    ratingScaleId: uuid().notNull(),
    selfDueOn: date(),
    peerDueOn: date(),
    managerDueOn: date(),
    calibrationDueOn: date(),
    includePeers: boolean().notNull().default(false),
    includeUpward: boolean().notNull().default(false),
    participantConditions: jsonb().$type<Record<string, string | string[]>>().notNull().default({}),
    status: cycleStatus().notNull().default("draft"),
    launchedAt: timestamp({ withTimezone: true }),
    closedAt: timestamp({ withTimezone: true }),
    createdBy: uuid().notNull(),
    ...timestamps,
  },
  (t) => [index("review_cycles_status_idx").on(t.tenantId, t.status)],
);

export const goalStatus = pgEnum("goal_status", ["draft", "active", "achieved", "partially_achieved", "missed", "cancelled"]);

export const goals = pgTable(
  "goals",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid(),
    /** Company / department goals have no employee. */
    departmentId: uuid(),
    cycleId: uuid(),
    parentGoalId: uuid(),
    /** "okr" | "kpi" | "goal" */
    kind: text().notNull().default("goal"),
    title: text().notNull(),
    description: text(),
    metricUnit: text(),
    startValue: numeric({ precision: 14, scale: 2, mode: "number" }),
    targetValue: numeric({ precision: 14, scale: 2, mode: "number" }),
    currentValue: numeric({ precision: 14, scale: 2, mode: "number" }),
    weight: smallint().notNull().default(0),
    progressPercent: smallint().notNull().default(0),
    dueOn: date(),
    status: goalStatus().notNull().default("active"),
    /** "private" (employee + manager + HR) | "team" | "company" */
    visibility: text().notNull().default("private"),
    createdBy: uuid().notNull(),
    ...timestamps,
  },
  (t) => [
    index("goals_employee_idx").on(t.tenantId, t.employeeId, t.cycleId),
    index("goals_parent_idx").on(t.parentGoalId),
  ],
);

export const goalCheckins = pgTable(
  "goal_checkins",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    goalId: uuid()
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    value: numeric({ precision: 14, scale: 2, mode: "number" }),
    progressPercent: smallint().notNull(),
    note: text(),
    createdBy: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("goal_checkins_goal_idx").on(t.goalId, t.createdAt)],
);

export const reviewKind = pgEnum("review_kind", ["self", "manager", "peer", "upward"]);
export const reviewStatus = pgEnum("review_status", ["not_started", "in_progress", "submitted", "shared", "acknowledged"]);

export const reviews = pgTable(
  "reviews",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    cycleId: uuid()
      .notNull()
      .references(() => reviewCycles.id),
    employeeId: uuid().notNull(),
    reviewerEmployeeId: uuid().notNull(),
    kind: reviewKind().notNull(),
    status: reviewStatus().notNull().default("not_started"),
    responses: jsonb().$type<Record<string, { rating?: number; text?: string }>>().notNull().default({}),
    overallRating: numeric({ precision: 3, scale: 2, mode: "number" }),
    calibratedRating: numeric({ precision: 3, scale: 2, mode: "number" }),
    calibrationNote: text(),
    submittedAt: timestamp({ withTimezone: true }),
    sharedAt: timestamp({ withTimezone: true }),
    acknowledgedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("reviews_key").on(t.cycleId, t.employeeId, t.reviewerEmployeeId, t.kind),
    index("reviews_reviewer_idx").on(t.tenantId, t.reviewerEmployeeId, t.status),
  ],
);

export const feedbackNotes = pgTable(
  "feedback_notes",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    fromEmployeeId: uuid().notNull(),
    toEmployeeId: uuid().notNull(),
    /** "praise" | "constructive" | "request" */
    kind: text().notNull().default("praise"),
    body: text().notNull(),
    /** "private" (recipient + their manager) | "manager_only" */
    visibility: text().notNull().default("private"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("feedback_notes_to_idx").on(t.toEmployeeId, t.createdAt)],
);

export const improvementPlans = pgTable(
  "improvement_plans",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid().notNull(),
    managerEmployeeId: uuid().notNull(),
    startsOn: date().notNull(),
    endsOn: date().notNull(),
    objectives: jsonb().$type<{ title: string; measure: string; status: string }[]>().notNull(),
    status: text().notNull().default("active"),
    outcome: text(),
    createdBy: uuid().notNull(),
    ...timestamps,
  },
  (t) => [index("improvement_plans_employee_idx").on(t.employeeId)],
);

export const promotionRecommendations = pgTable(
  "promotion_recommendations",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    cycleId: uuid(),
    employeeId: uuid().notNull(),
    recommendedBy: uuid().notNull(),
    toDesignationId: uuid(),
    toGradeId: uuid(),
    proposedAnnualCtc: money(),
    justification: text().notNull(),
    status: text().notNull().default("proposed"),
    decidedBy: uuid(),
    ...timestamps,
  },
  (t) => [index("promotion_recommendations_cycle_idx").on(t.tenantId, t.cycleId)],
);

/* ------------------------------------------------------------------ */
/* Learning                                                            */
/* ------------------------------------------------------------------ */

export const courses = pgTable(
  "courses",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    title: text().notNull(),
    description: text(),
    /** "document" | "video" | "link" | "classroom" | "external" */
    format: text().notNull().default("link"),
    provider: text(),
    url: text(),
    documentId: uuid(),
    durationMinutes: integer(),
    skills: text().array().notNull().default(sql`'{}'::text[]`),
    isMandatory: boolean().notNull().default(false),
    certificateValidityMonths: smallint(),
    quiz: jsonb().$type<{ passMark: number; questions: { id: string; prompt: string; options: string[]; answer: number }[] } | null>(),
    isActive: boolean().notNull().default(true),
    createdBy: uuid(),
    ...timestamps,
  },
  (t) => [uniqueIndex("courses_title_key").on(t.tenantId, t.title)],
);

export const learningPaths = pgTable(
  "learning_paths",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    title: text().notNull(),
    description: text(),
    courseIds: uuid().array().notNull(),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("learning_paths_title_key").on(t.tenantId, t.title)],
);

/** Rule-based assignment of a course or path to roles / departments / everyone. */
export const learningAssignments = pgTable("learning_assignments", {
  id: pk(),
  tenantId: tenantRef().references(() => tenants.id),
  courseId: uuid(),
  pathId: uuid(),
  target: jsonb().$type<{ departmentIds?: string[]; designationIds?: string[]; all?: boolean; newJoiners?: boolean }>().notNull(),
  dueInDays: smallint().notNull().default(30),
  isActive: boolean().notNull().default(true),
  createdBy: uuid().notNull(),
  ...timestamps,
});

export const enrollmentState = pgEnum("learning_enrollment_status", ["assigned", "in_progress", "completed", "expired", "waived"]);

export const learningEnrollments = pgTable(
  "learning_enrollments",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid().notNull(),
    courseId: uuid()
      .notNull()
      .references(() => courses.id),
    pathId: uuid(),
    assignmentId: uuid(),
    status: enrollmentState().notNull().default("assigned"),
    dueOn: date(),
    progressPercent: smallint().notNull().default(0),
    score: smallint(),
    attempts: smallint().notNull().default(0),
    completedAt: timestamp({ withTimezone: true }),
    expiresOn: date(),
    certificateDocumentId: uuid(),
    assignedBy: uuid(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("learning_enrollments_open_key")
      .on(t.employeeId, t.courseId)
      .where(sql`${t.status} in ('assigned','in_progress')`),
    index("learning_enrollments_due_idx").on(t.tenantId, t.status, t.dueOn),
  ],
);

/* ------------------------------------------------------------------ */
/* Engagement and people success                                       */
/* ------------------------------------------------------------------ */

export type SurveyQuestion = {
  id: string;
  label: string;
  type: "scale" | "enps" | "choice" | "text";
  options?: string[];
  driver?: string;
  required: boolean;
};

export const surveyStatus = pgEnum("survey_status", ["draft", "active", "closed"]);

export const surveys = pgTable(
  "surveys",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    title: text().notNull(),
    /** "pulse" | "engagement" | "onboarding" | "exit" | "custom" */
    kind: text().notNull().default("pulse"),
    description: text(),
    /**
     * Anonymous surveys never store who answered: responses carry only coarse
     * group attributes, and results are suppressed below minGroupSize.
     */
    isAnonymous: boolean().notNull().default(true),
    minGroupSize: smallint().notNull().default(5),
    questions: jsonb().$type<SurveyQuestion[]>().notNull(),
    audience: jsonb().$type<{ all?: boolean; departmentIds?: string[]; locationIds?: string[] }>().notNull().default({ all: true }),
    status: surveyStatus().notNull().default("draft"),
    opensOn: date(),
    closesOn: date(),
    createdBy: uuid().notNull(),
    ...timestamps,
  },
  (t) => [index("surveys_status_idx").on(t.tenantId, t.status)],
);

/** Who was invited and whether they responded. Never joined to anonymous answers. */
export const surveyParticipants = pgTable(
  "survey_participants",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    surveyId: uuid()
      .notNull()
      .references(() => surveys.id, { onDelete: "cascade" }),
    employeeId: uuid().notNull(),
    respondedOn: date(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("survey_participants_key").on(t.surveyId, t.employeeId)],
);

export const surveyResponses = pgTable(
  "survey_responses",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    surveyId: uuid()
      .notNull()
      .references(() => surveys.id, { onDelete: "cascade" }),
    /** Null for anonymous surveys. */
    employeeId: uuid(),
    /** Coarse group attributes for aggregation (department, location, tenure band). */
    departmentId: uuid(),
    locationId: uuid(),
    tenureBand: text(),
    answers: jsonb().$type<Record<string, string | number>>().notNull(),
    /** Day precision only, to avoid re-identification by timestamp. */
    submittedOn: date().notNull(),
  },
  (t) => [index("survey_responses_survey_idx").on(t.surveyId)],
);

export const recognitions = pgTable(
  "recognitions",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    fromEmployeeId: uuid().notNull(),
    toEmployeeId: uuid().notNull(),
    badge: text().notNull(),
    message: text().notNull(),
    isPublic: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("recognitions_tenant_idx").on(t.tenantId, t.createdAt)],
);

export const oneOnOnes = pgTable(
  "one_on_ones",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    managerEmployeeId: uuid().notNull(),
    employeeId: uuid().notNull(),
    heldOn: date().notNull(),
    agenda: text(),
    /** Visible only to the two participants. */
    notes: text(),
    actionItems: jsonb().$type<{ text: string; owner: "manager" | "employee"; done: boolean }[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [index("one_on_ones_pair_idx").on(t.managerEmployeeId, t.employeeId, t.heldOn)],
);

export const careerPlans = pgTable(
  "career_plans",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid().notNull(),
    aspirations: text(),
    targetRoles: text().array().notNull().default(sql`'{}'::text[]`),
    interestedInMobility: boolean().notNull().default(false),
    actions: jsonb().$type<{ title: string; kind: "course" | "project" | "mentoring" | "other"; dueOn?: string; done: boolean }[]>().notNull().default([]),
    managerNotes: text(),
    reviewedOn: date(),
    ...timestamps,
  },
  (t) => [uniqueIndex("career_plans_employee_key").on(t.employeeId)],
);

/** Restricted to succession.manage. */
export const successionPlans = pgTable("succession_plans", {
  id: pk(),
  tenantId: tenantRef().references(() => tenants.id),
  positionId: uuid(),
  roleTitle: text().notNull(),
  incumbentEmployeeId: uuid(),
  criticality: text().notNull().default("medium"),
  candidates: jsonb().$type<{ employeeId: string; readiness: "ready_now" | "1_2_years" | "3_plus_years"; notes?: string }[]>().notNull().default([]),
  createdBy: uuid().notNull(),
  ...timestamps,
});

export const engagementActionPlans = pgTable("engagement_action_plans", {
  id: pk(),
  tenantId: tenantRef().references(() => tenants.id),
  surveyId: uuid(),
  departmentId: uuid(),
  ownerEmployeeId: uuid().notNull(),
  focusArea: text().notNull(),
  actions: jsonb().$type<{ title: string; dueOn?: string; done: boolean }[]>().notNull().default([]),
  status: text().notNull().default("open"),
  ...timestamps,
});
