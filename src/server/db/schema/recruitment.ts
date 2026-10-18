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
import { employmentType, workMode } from "./people";

/* ------------------------------------------------------------------ */
/* Requisitions and openings                                           */
/* ------------------------------------------------------------------ */

export const requisitionStatus = pgEnum("requisition_status", [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "on_hold",
  "filled",
  "cancelled",
]);

export const jobRequisitions = pgTable(
  "job_requisitions",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    code: text().notNull(),
    title: text().notNull(),
    departmentId: uuid(),
    designationId: uuid(),
    locationId: uuid(),
    legalEntityId: uuid(),
    positionId: uuid(),
    headcount: integer().notNull().default(1),
    employmentType: employmentType().notNull().default("full_time"),
    /** "new" | "backfill" */
    reason: text().notNull().default("new"),
    backfillForEmployeeId: uuid(),
    budgetMinAnnual: money(),
    budgetMaxAnnual: money(),
    currency: text().notNull().default("INR"),
    justification: text(),
    hiringManagerEmployeeId: uuid(),
    recruiterUserId: uuid(),
    targetStartDate: date(),
    status: requisitionStatus().notNull().default("draft"),
    approvedAt: timestamp({ withTimezone: true }),
    createdBy: uuid().notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("job_requisitions_code_key").on(t.tenantId, t.code),
    index("job_requisitions_status_idx").on(t.tenantId, t.status),
  ],
);

export const openingStatus = pgEnum("opening_status", ["draft", "published", "paused", "closed"]);

export const jobOpenings = pgTable(
  "job_openings",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    requisitionId: uuid().references(() => jobRequisitions.id),
    title: text().notNull(),
    /** Public career-page slug, unique per tenant. */
    slug: text().notNull(),
    description: text().notNull(),
    requirements: text(),
    skills: text().array().notNull().default(sql`'{}'::text[]`),
    experienceMinYears: smallint(),
    experienceMaxYears: smallint(),
    departmentId: uuid(),
    locationId: uuid(),
    workMode: workMode().notNull().default("onsite"),
    employmentType: employmentType().notNull().default("full_time"),
    salaryMinAnnual: money(),
    salaryMaxAnnual: money(),
    showSalary: boolean().notNull().default(false),
    openings: integer().notNull().default(1),
    status: openingStatus().notNull().default("draft"),
    publishedAt: timestamp({ withTimezone: true }),
    closesOn: date(),
    hiringManagerEmployeeId: uuid(),
    recruiterUserId: uuid(),
    /** Job-related screening questions shown on the application form. */
    questions: jsonb().$type<{ id: string; label: string; type: "text" | "yes_no" | "number"; required: boolean }[]>().notNull().default([]),
    createdBy: uuid().notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("job_openings_slug_key").on(t.tenantId, t.slug),
    index("job_openings_status_idx").on(t.tenantId, t.status),
  ],
);

export const stageKind = pgEnum("stage_kind", [
  "applied",
  "screening",
  "review",
  "assessment",
  "interview",
  "final",
  "offer",
  "hired",
]);

/** Configurable pipeline. Default stages are seeded per tenant. */
export const recruitmentStages = pgTable(
  "recruitment_stages",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text().notNull(),
    kind: stageKind().notNull(),
    sortOrder: integer().notNull(),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("recruitment_stages_name_key").on(t.tenantId, t.name)],
);

/* ------------------------------------------------------------------ */
/* Candidates and applications                                         */
/* ------------------------------------------------------------------ */

export type ParsedResume = {
  skills: string[];
  totalExperienceMonths: number | null;
  workHistory: { company: string; title: string; from: string | null; to: string | null; summary?: string }[];
  education: { institution: string; degree: string; year: number | null }[];
  certifications: string[];
  /** Extraction metadata: model, prompt version, warnings. */
  meta?: { model?: string; promptVersion?: string; warnings?: string[] };
};

export const candidates = pgTable(
  "candidates",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    firstName: text().notNull(),
    lastName: text(),
    email: text().notNull(),
    phone: text(),
    currentCompany: text(),
    currentTitle: text(),
    totalExperienceMonths: integer(),
    city: text(),
    linkedinUrl: text(),
    /** "career_page" | "referral" | "agency" | "job_board" | "sourced" | "internal" */
    source: text().notNull().default("career_page"),
    sourceDetail: text(),
    resumeDocumentId: uuid(),
    parsedProfile: jsonb().$type<ParsedResume | null>(),
    tags: text().array().notNull().default(sql`'{}'::text[]`),
    /** Consent to process data for recruitment (DPDP); retention end date. */
    consentAt: timestamp({ withTimezone: true }),
    retainUntil: date(),
    employeeId: uuid(),
    createdBy: uuid(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("candidates_email_key").on(t.tenantId, sql`lower(${t.email})`),
    index("candidates_phone_idx").on(t.tenantId, t.phone),
  ],
);

export const talentPools = pgTable(
  "talent_pools",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text().notNull(),
    description: text(),
    ...timestamps,
  },
  (t) => [uniqueIndex("talent_pools_name_key").on(t.tenantId, t.name)],
);

export const talentPoolMembers = pgTable(
  "talent_pool_members",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    poolId: uuid()
      .notNull()
      .references(() => talentPools.id, { onDelete: "cascade" }),
    candidateId: uuid()
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    addedBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("talent_pool_members_key").on(t.poolId, t.candidateId)],
);

export const applicationStatus = pgEnum("application_status", ["active", "rejected", "withdrawn", "hired"]);

export type ApplicationAiSummary = {
  summary: string;
  /** Job-related criteria only; each with evidence from the resume. */
  criteria: { criterion: string; assessment: "meets" | "partially" | "not_evident"; evidence: string }[];
  missingInformation: string[];
  model: string;
  promptVersion: string;
  generatedAt: string;
};

export const applications = pgTable(
  "applications",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    candidateId: uuid()
      .notNull()
      .references(() => candidates.id),
    openingId: uuid()
      .notNull()
      .references(() => jobOpenings.id),
    stageId: uuid()
      .notNull()
      .references(() => recruitmentStages.id),
    status: applicationStatus().notNull().default("active"),
    source: text().notNull().default("career_page"),
    referralId: uuid(),
    answers: jsonb().$type<Record<string, string>>().notNull().default({}),
    coverNote: text(),
    aiSummary: jsonb().$type<ApplicationAiSummary | null>(),
    averageRating: numeric({ precision: 3, scale: 2, mode: "number" }),
    rejectionReason: text(),
    appliedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    stageEnteredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("applications_candidate_opening_key").on(t.openingId, t.candidateId),
    index("applications_stage_idx").on(t.tenantId, t.openingId, t.stageId, t.status),
    index("applications_candidate_idx").on(t.candidateId),
  ],
);

/** Timeline: stage changes, notes, emails, interview and offer events. */
export const applicationEvents = pgTable(
  "application_events",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    applicationId: uuid()
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    type: text().notNull(),
    fromStageId: uuid(),
    toStageId: uuid(),
    body: text(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    actorUserId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("application_events_app_idx").on(t.applicationId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Interviews                                                          */
/* ------------------------------------------------------------------ */

export const interviewStatus = pgEnum("interview_status", ["scheduled", "completed", "cancelled", "no_show"]);

export type ScorecardCriterion = { key: string; label: string; description?: string };

export const scorecardTemplates = pgTable(
  "scorecard_templates",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text().notNull(),
    criteria: jsonb().$type<ScorecardCriterion[]>().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("scorecard_templates_name_key").on(t.tenantId, t.name)],
);

export const interviews = pgTable(
  "interviews",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    applicationId: uuid()
      .notNull()
      .references(() => applications.id),
    roundName: text().notNull(),
    /** "phone" | "video" | "onsite" | "assessment" */
    mode: text().notNull().default("video"),
    scheduledStart: timestamp({ withTimezone: true }).notNull(),
    scheduledEnd: timestamp({ withTimezone: true }).notNull(),
    location: text(),
    meetingUrl: text(),
    scorecardTemplateId: uuid(),
    status: interviewStatus().notNull().default("scheduled"),
    calendarEventIds: jsonb().$type<Record<string, string>>(),
    createdBy: uuid().notNull(),
    ...timestamps,
  },
  (t) => [
    index("interviews_application_idx").on(t.applicationId),
    index("interviews_start_idx").on(t.tenantId, t.scheduledStart),
  ],
);

export const interviewPanelists = pgTable(
  "interview_panelists",
  {
    tenantId: tenantRef().references(() => tenants.id),
    interviewId: uuid()
      .notNull()
      .references(() => interviews.id, { onDelete: "cascade" }),
    userId: uuid().notNull(),
    isLead: boolean().notNull().default(false),
  },
  (t) => [
    uniqueIndex("interview_panelists_key").on(t.interviewId, t.userId),
    index("interview_panelists_user_idx").on(t.userId),
  ],
);

export const recommendation = pgEnum("recommendation", ["strong_yes", "yes", "no", "strong_no"]);

export const interviewFeedback = pgTable(
  "interview_feedback",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    interviewId: uuid()
      .notNull()
      .references(() => interviews.id),
    interviewerUserId: uuid().notNull(),
    recommendation: recommendation().notNull(),
    overallRating: smallint().notNull(),
    scores: jsonb().$type<{ key: string; rating: number; notes?: string }[]>().notNull().default([]),
    strengths: text(),
    concerns: text(),
    submittedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [uniqueIndex("interview_feedback_key").on(t.interviewId, t.interviewerUserId)],
);

/* ------------------------------------------------------------------ */
/* Offers                                                              */
/* ------------------------------------------------------------------ */

export const offerStatus = pgEnum("offer_status", [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "accepted",
  "declined",
  "expired",
  "rescinded",
]);

export type OfferComponent = { code: string; name: string; annualAmount: number };

export const offers = pgTable(
  "offers",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    applicationId: uuid()
      .notNull()
      .references(() => applications.id),
    candidateId: uuid().notNull(),
    openingId: uuid().notNull(),
    version: integer().notNull().default(1),
    status: offerStatus().notNull().default("draft"),
    designationId: uuid(),
    departmentId: uuid(),
    locationId: uuid(),
    legalEntityId: uuid().notNull(),
    reportingManagerId: uuid(),
    employmentType: employmentType().notNull().default("full_time"),
    joiningDate: date().notNull(),
    annualCtc: money().notNull(),
    currency: text().notNull().default("INR"),
    components: jsonb().$type<OfferComponent[]>().notNull().default([]),
    probationMonths: smallint().notNull().default(6),
    noticePeriodDays: integer().notNull().default(30),
    expiresOn: date().notNull(),
    templateVersionId: uuid(),
    documentId: uuid(),
    /** SHA-256 of the candidate response token. */
    responseTokenHash: text(),
    sentAt: timestamp({ withTimezone: true }),
    respondedAt: timestamp({ withTimezone: true }),
    responseNote: text(),
    responseIp: text(),
    /** Only set when a configured e-signature provider confirms signing. */
    esignProvider: text(),
    esignEnvelopeId: text(),
    esignStatus: text(),
    employeeId: uuid(),
    createdBy: uuid().notNull(),
    ...timestamps,
  },
  (t) => [
    index("offers_application_idx").on(t.applicationId),
    uniqueIndex("offers_one_live_per_application")
      .on(t.applicationId)
      .where(sql`${t.status} in ('draft','pending_approval','approved','sent','accepted')`),
    uniqueIndex("offers_response_token_key")
      .on(t.responseTokenHash)
      .where(sql`${t.responseTokenHash} is not null`),
  ],
);

/* ------------------------------------------------------------------ */
/* Referrals                                                           */
/* ------------------------------------------------------------------ */

export const referralRewardPolicies = pgTable("referral_reward_policies", {
  id: pk(),
  tenantId: tenantRef().references(() => tenants.id),
  name: text().notNull(),
  amount: money().notNull(),
  currency: text().notNull().default("INR"),
  /** Reward becomes eligible this many days after the hire joins (and is still employed). */
  eligibleAfterDays: integer().notNull().default(90),
  conditions: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  isActive: boolean().notNull().default(true),
  ...timestamps,
});

export const referralStatus = pgEnum("referral_status", [
  "submitted",
  "in_review",
  "interviewing",
  "hired",
  "rejected",
  "duplicate",
  "withdrawn",
]);

export const rewardStatus = pgEnum("reward_status", [
  "not_applicable",
  "pending",
  "eligible",
  "approved",
  "paid",
  "cancelled",
]);

export const referrals = pgTable(
  "referrals",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    referrerEmployeeId: uuid().notNull(),
    candidateId: uuid()
      .notNull()
      .references(() => candidates.id),
    openingId: uuid().references(() => jobOpenings.id),
    applicationId: uuid(),
    relationship: text(),
    note: text(),
    status: referralStatus().notNull().default("submitted"),
    rewardPolicyId: uuid(),
    rewardAmount: money(),
    rewardStatus: rewardStatus().notNull().default("not_applicable"),
    rewardEligibleOn: date(),
    rewardPaidAt: timestamp({ withTimezone: true }),
    payrollInputId: uuid(),
    ...timestamps,
  },
  (t) => [
    // First valid referral of a candidate for an opening wins attribution.
    uniqueIndex("referrals_candidate_opening_key")
      .on(t.tenantId, t.candidateId, t.openingId)
      .where(sql`${t.status} not in ('duplicate','withdrawn')`),
    index("referrals_referrer_idx").on(t.tenantId, t.referrerEmployeeId),
  ],
);
