import "server-only";
import { and, desc, eq, inArray, isNull, or, gte, sql } from "drizzle-orm";
import { withSystem } from "../../db/tx";
import { applications, candidates, departments, jobOpenings, locations, tenants } from "../../db/schema";
import { audit } from "../../lib/audit";
import { sha256 } from "../../lib/crypto";
import { AppError, conflict, notFound, validation } from "../../lib/errors";
import { rateLimit } from "../../lib/rate-limit";
import { emitDomainEvent } from "../events";
import { todayIn } from "@/lib/format";
import { CANDIDATE_RETENTION_MONTHS, type PublicApplicationInput } from "@/lib/validation/recruitment";
import { notifyRecruiters, queueCandidateEmail } from "./messaging";
import { discardResume, insertResumeDocument, stageResume, type StagedResume } from "./resumes";
import { firstStage, logEvent, retainUntilFrom } from "./shared";

/**
 * Public careers site. Runs without a session in system context, so every
 * query filters by the tenant resolved from the URL slug, and only fields
 * meant for candidates are returned (no budgets, recruiters, requisitions).
 */

export type PublicTenant = { id: string; name: string; slug: string };

async function tenantBySlug(slug: string): Promise<PublicTenant | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const [t] = await withSystem((tx) =>
    tx
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
      .from(tenants)
      .where(and(eq(tenants.slug, slug), inArray(tenants.status, ["onboarding", "active"]))),
  );
  return t ?? null;
}

const openFilter = (tenantId: string) =>
  and(eq(jobOpenings.tenantId, tenantId), eq(jobOpenings.status, "published"), or(isNull(jobOpenings.closesOn), gte(jobOpenings.closesOn, todayIn())));

export type PublicJobSummary = {
  slug: string;
  title: string;
  department: string | null;
  location: string | null;
  workMode: string;
  employmentType: string;
  experienceMinYears: number | null;
  experienceMaxYears: number | null;
  salary: { min: number | null; max: number | null } | null;
  publishedAt: string | null;
};

export async function getCareerSite(tenantSlug: string): Promise<{ tenant: PublicTenant; jobs: PublicJobSummary[] } | null> {
  const tenant = await tenantBySlug(tenantSlug);
  if (!tenant) return null;
  const rows = await withSystem(
    (tx) =>
      tx
        .select({ o: jobOpenings, department: departments.name, location: locations.name })
        .from(jobOpenings)
        .leftJoin(departments, and(eq(departments.id, jobOpenings.departmentId), eq(departments.tenantId, tenant.id)))
        .leftJoin(locations, and(eq(locations.id, jobOpenings.locationId), eq(locations.tenantId, tenant.id)))
        .where(openFilter(tenant.id))
        .orderBy(desc(jobOpenings.publishedAt))
        .limit(200),
    tenant.id,
  );
  return {
    tenant,
    jobs: rows.map(({ o, department, location }) => ({
      slug: o.slug,
      title: o.title,
      department,
      location,
      workMode: o.workMode,
      employmentType: o.employmentType,
      experienceMinYears: o.experienceMinYears,
      experienceMaxYears: o.experienceMaxYears,
      salary: o.showSalary ? { min: o.salaryMinAnnual, max: o.salaryMaxAnnual } : null,
      publishedAt: o.publishedAt?.toISOString() ?? null,
    })),
  };
}

export type PublicJob = PublicJobSummary & {
  description: string;
  requirements: string | null;
  skills: string[];
  closesOn: string | null;
  questions: { id: string; label: string; type: "text" | "yes_no" | "number"; required: boolean }[];
};

export async function getPublicJob(tenantSlug: string, jobSlug: string): Promise<{ tenant: PublicTenant; job: PublicJob } | null> {
  const tenant = await tenantBySlug(tenantSlug);
  if (!tenant || !/^[a-z0-9-]{1,80}$/.test(jobSlug)) return null;
  const [row] = await withSystem(
    (tx) =>
      tx
        .select({ o: jobOpenings, department: departments.name, location: locations.name })
        .from(jobOpenings)
        .leftJoin(departments, and(eq(departments.id, jobOpenings.departmentId), eq(departments.tenantId, tenant.id)))
        .leftJoin(locations, and(eq(locations.id, jobOpenings.locationId), eq(locations.tenantId, tenant.id)))
        .where(and(openFilter(tenant.id), eq(jobOpenings.slug, jobSlug))),
    tenant.id,
  );
  if (!row) return null;
  const o = row.o;
  return {
    tenant,
    job: {
      slug: o.slug,
      title: o.title,
      department: row.department,
      location: row.location,
      workMode: o.workMode,
      employmentType: o.employmentType,
      experienceMinYears: o.experienceMinYears,
      experienceMaxYears: o.experienceMaxYears,
      salary: o.showSalary ? { min: o.salaryMinAnnual, max: o.salaryMaxAnnual } : null,
      publishedAt: o.publishedAt?.toISOString() ?? null,
      description: o.description,
      requirements: o.requirements,
      skills: o.skills,
      closesOn: o.closesOn,
      questions: o.questions,
    },
  };
}

export type ApplicationReceipt = {
  /** False when the honeypot tripped: the bot sees success, nothing is stored. */
  stored: boolean;
  applicationId: string | null;
  outboxIds: string[];
};

/**
 * Accept an application from the public careers page.
 *
 * Duplicate handling: the candidate is matched by email (case-insensitive)
 * and reused; a second application to the same opening is refused with a
 * friendly message (also enforced by a unique index). A different email with
 * a phone number that matches an existing candidate creates a new candidate
 * tagged "possible-duplicate" for the recruiter to review; nothing about the
 * other record is revealed to the applicant.
 */
export async function submitPublicApplication(
  input: PublicApplicationInput,
  resume: File | null,
  meta: { ip: string | null; userAgent?: string | null },
): Promise<ApplicationReceipt> {
  if (input.website && input.website.trim()) return { stored: false, applicationId: null, outboxIds: [] };

  const ip = meta.ip || "unknown";
  await rateLimit(`careers:ip:${ip}`, 20, 3600);
  await rateLimit(`careers:email:${sha256(`${input.tenantSlug}:${input.email}`).slice(0, 32)}`, 5, 3600);

  const found = await getPublicJob(input.tenantSlug, input.jobSlug);
  if (!found) throw notFound("Job");
  const { tenant, job } = found;

  // Screening questions: required answers present; yes/no and numbers well-formed.
  const answers: Record<string, string> = {};
  const fieldErrors: Record<string, string[]> = {};
  for (const q of job.questions) {
    const a = (input.answers[q.id] ?? "").trim();
    if (!a) {
      if (q.required) fieldErrors[`answers.${q.id}`] = ["Please answer this question"];
      continue;
    }
    if (q.type === "yes_no" && a !== "yes" && a !== "no") fieldErrors[`answers.${q.id}`] = ["Choose yes or no"];
    else if (q.type === "number" && !Number.isFinite(Number(a))) fieldErrors[`answers.${q.id}`] = ["Enter a number"];
    else answers[q.id] = a.slice(0, 2000);
  }
  if (Object.keys(fieldErrors).length) throw validation("Please answer the required questions.", fieldErrors);
  if (!resume) throw validation("Attach your resume.", { resume: ["Attach a PDF or Word (.docx) file"] });

  // Cheap duplicate check before touching storage.
  await withSystem(async (tx) => {
    const [existing] = await tx
      .select({ id: applications.id })
      .from(applications)
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .innerJoin(jobOpenings, eq(jobOpenings.id, applications.openingId))
      .where(and(eq(candidates.tenantId, tenant.id), sql`lower(${candidates.email}) = ${input.email}`, eq(jobOpenings.slug, job.slug), eq(jobOpenings.tenantId, tenant.id)));
    if (existing) throw alreadyApplied(job.title);
  }, tenant.id);

  const staged: StagedResume = await stageResume(tenant.id, resume);
  try {
    return await withSystem(async (tx) => {
      const [opening] = await tx
        .select()
        .from(jobOpenings)
        .where(and(openFilter(tenant.id), eq(jobOpenings.slug, job.slug)))
        .for("share");
      if (!opening) throw notFound("Job");
      const today = todayIn();
      const retainUntil = retainUntilFrom(today, CANDIDATE_RETENTION_MONTHS);

      let [candidate] = await tx
        .select()
        .from(candidates)
        .where(and(eq(candidates.tenantId, tenant.id), sql`lower(${candidates.email}) = ${input.email}`))
        .for("update");
      let possibleDuplicateOf: string | null = null;
      const profile = {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        currentCompany: input.currentCompany,
        currentTitle: input.currentTitle,
        totalExperienceMonths: input.experienceYears == null ? null : input.experienceYears * 12,
        linkedinUrl: input.linkedinUrl,
      };
      if (!candidate) {
        if (input.phone) {
          const digits = input.phone.replace(/\D/g, "").slice(-10);
          const [phoneMatch] = await tx
            .select({ id: candidates.id })
            .from(candidates)
            .where(and(eq(candidates.tenantId, tenant.id), sql`right(regexp_replace(coalesce(${candidates.phone}, ''), '\\D', '', 'g'), 10) = ${digits}`))
            .limit(1);
          possibleDuplicateOf = digits.length >= 10 ? (phoneMatch?.id ?? null) : null;
        }
        [candidate] = await tx
          .insert(candidates)
          .values({
            tenantId: tenant.id,
            email: input.email,
            ...profile,
            source: "career_page",
            consentAt: new Date(),
            retainUntil,
            tags: possibleDuplicateOf ? ["possible-duplicate"] : [],
          })
          .returning();
      } else {
        // Keep the candidate's latest self-reported details; never blank existing values.
        const patch = Object.fromEntries(Object.entries(profile).filter(([, v]) => v !== null && v !== undefined));
        [candidate] = await tx
          .update(candidates)
          .set({ ...patch, consentAt: new Date(), retainUntil })
          .where(eq(candidates.id, candidate.id))
          .returning();
      }

      const [dup] = await tx
        .select({ id: applications.id })
        .from(applications)
        .where(and(eq(applications.openingId, opening.id), eq(applications.candidateId, candidate.id)));
      if (dup) throw alreadyApplied(opening.title);

      const doc = await insertResumeDocument(tx, {
        tenantId: tenant.id,
        candidateId: candidate.id,
        staged,
        uploadedBy: null,
        title: `Resume – ${[input.firstName, input.lastName].filter(Boolean).join(" ")}`,
        retainUntil,
      });
      await tx.update(candidates).set({ resumeDocumentId: doc.id }).where(eq(candidates.id, candidate.id));

      const stage = await firstStage(tx, tenant.id);
      const [application] = await tx
        .insert(applications)
        .values({
          tenantId: tenant.id,
          candidateId: candidate.id,
          openingId: opening.id,
          stageId: stage.id,
          source: "career_page",
          answers,
          coverNote: input.coverNote,
        })
        .returning({ id: applications.id });

      await logEvent(tx, {
        tenantId: tenant.id,
        applicationId: application.id,
        type: "applied",
        actorUserId: null,
        toStageId: stage.id,
        body: "Applied through the careers page.",
        metadata: { source: "career_page", consent: true, possibleDuplicateOf },
      });
      await audit(tx, { tenantId: tenant.id, userId: null }, {
        action: "application.received",
        entityType: "application",
        entityId: application.id,
        metadata: { openingId: opening.id, candidateId: candidate.id, source: "career_page", consentRecorded: true },
        ip: meta.ip && /^[0-9a-f.:]+$/i.test(meta.ip) ? meta.ip : null,
        userAgent: meta.userAgent,
      });
      await emitDomainEvent(tx, tenant.id, "candidate.applied", { applicationId: application.id, openingId: opening.id, candidateId: candidate.id, source: "career_page" });
      await notifyRecruiters(tx, tenant.id, {
        recruiterUserId: opening.recruiterUserId,
        title: `New application: ${opening.title}`,
        body: `${input.firstName} ${input.lastName?.[0] ? `${input.lastName[0]}.` : ""} applied through the careers page.`.trim(),
        href: `/recruitment/openings/${opening.id}`,
        dedupeKey: `application:${application.id}`,
      });
      const outboxId = await queueCandidateEmail(tx, {
        tenantId: tenant.id,
        applicationId: application.id,
        to: input.email,
        companyName: tenant.name,
        subject: `We received your application for ${opening.title}`,
        paragraphs: [
          `Hi ${input.firstName},`,
          `Thank you for applying for ${opening.title} at ${tenant.name}. Our team will review your application and get back to you.`,
          `We process your details only to evaluate your application and keep them for ${CANDIDATE_RETENTION_MONTHS} months unless you join us. Reply to this email to ask for access, correction or deletion.`,
        ],
        template: "candidate.application_received",
        actorUserId: null,
        dedupeKey: `application-received:${application.id}`,
      });
      return { stored: true, applicationId: application.id, outboxIds: outboxId ? [outboxId] : [] };
    }, tenant.id);
  } catch (err) {
    await discardResume(staged);
    const pg = (err as { cause?: { code?: string; constraint_name?: string } })?.cause;
    if (pg?.code === "23505" && pg.constraint_name === "applications_candidate_opening_key") throw alreadyApplied(job.title);
    throw err;
  }
}

function alreadyApplied(title: string): AppError {
  return conflict(`You have already applied for ${title}. We have your application and will be in touch — there's no need to apply again.`);
}
