import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { RequestContext } from "../../auth/context";
import { applications, candidates, documents, jobOpenings, tenants, users } from "../../db/schema";
import type { ApplicationAiSummary, ParsedResume } from "../../db/schema/recruitment";
import { supabaseAdmin } from "../../auth/supabase";
import { runAi } from "../../ai/run";
import { audit } from "../../lib/audit";
import { notFound } from "../../lib/errors";
import { logger } from "../../lib/logger";
import {
  RULES_MODEL,
  RULES_PROMPT_VERSION,
  ruleBasedEmailDraft,
  ruleBasedMatch,
  ruleBasedParse,
  ruleBasedQuestions,
  scrubProtected,
  type EmailDraft,
  type InterviewQuestion,
} from "./matching";
import { extractResumeText } from "./text-extract";
import { logEvent, requireRecruitmentManage, requireRecruitmentView } from "./shared";

/**
 * AI assistance for recruiters (agent "recruitment"). Every call:
 *  - sends only job-related inputs: the opening's stated requirements and
 *    skills, and resume text with protected characteristics, contact details
 *    and the candidate's name removed;
 *  - has a deterministic rule-based fallback, labelled "Rule-based";
 *  - is advisory: nothing here moves, ranks, filters or rejects candidates.
 */

export type AiSource = { source: "ai" | "rules"; reason: string | null; model: string };

const AGENT = "recruitment";

/** Remove contact details and the candidate's own name before AI processing. */
export function anonymize(text: string, names: (string | null | undefined)[]) {
  let out = scrubProtected(text).text;
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]").replace(/\+?\d[\d\s()-]{8,}\d/g, "[phone]");
  for (const n of names) {
    if (!n || n.length < 2) continue;
    out = out.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "[Candidate]");
  }
  return out;
}

async function storedResumeText(tenantId: string, documentId: string | null, tx: Parameters<Parameters<RequestContext["db"]>[0]>[0]) {
  if (!documentId) return { text: null as string | null, warning: "No resume on file." };
  const [d] = await tx.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.tenantId, tenantId)));
  if (!d) return { text: null, warning: "No resume on file." };
  try {
    const { data, error } = await supabaseAdmin().storage.from(d.bucket).download(d.storagePath);
    if (error || !data) throw new Error(error?.message ?? "download failed");
    const bytes = new Uint8Array(await data.arrayBuffer());
    const ex = extractResumeText(bytes, d.mimeType);
    return { text: ex.text, warning: ex.warning };
  } catch (err) {
    logger.warn("recruitment.resume_read_failed", { documentId, err });
    return { text: null, warning: "The stored resume could not be read. Paste the resume text instead." };
  }
}

/* ------------------------------------------------------------------ */
/* Resume parsing                                                      */
/* ------------------------------------------------------------------ */

const parsedResumeSchema = z.object({
  skills: z.array(z.string().max(60)).max(60),
  totalExperienceMonths: z.number().int().min(0).max(720).nullable(),
  workHistory: z
    .array(z.object({ company: z.string().max(120), title: z.string().max(120), from: z.string().max(20).nullable(), to: z.string().max(20).nullable(), summary: z.string().max(400).optional() }))
    .max(20),
  education: z.array(z.object({ institution: z.string().max(160), degree: z.string().max(120), year: z.number().int().min(1950).max(2100).nullable() })).max(10),
  certifications: z.array(z.string().max(160)).max(20),
});

export async function parseCandidateResume(ctx: RequestContext, candidateId: string, pastedText: string | null) {
  requireRecruitmentManage(ctx);
  const loaded = await ctx.db(async (tx) => {
    const [c] = await tx.select().from(candidates).where(eq(candidates.id, candidateId));
    if (!c) throw notFound("Candidate");
    const skills = await tx.select({ skills: jobOpenings.skills }).from(jobOpenings).where(eq(jobOpenings.status, "published")).limit(100);
    const stored = pastedText ? { text: pastedText, warning: null } : await storedResumeText(ctx.tenantId, c.resumeDocumentId, tx);
    return { c, extraSkills: [...new Set(skills.flatMap((s) => s.skills))], stored };
  });
  const { c, extraSkills, stored } = loaded;
  if (!stored.text) return { ok: false as const, warning: stored.warning ?? "No resume text available." };
  const text = anonymize(stored.text, [c.firstName, c.lastName, c.email]);
  const outcome = await runAi({ tenantId: ctx.tenantId, userId: ctx.userId }, {
    agentKey: AGENT,
    task: "recruitment.parse_resume",
    system:
      "Extract a structured profile from the resume text. Only include facts stated in the text. Do not infer age, gender, marital status, nationality, religion or any other personal characteristic. totalExperienceMonths is the total professional experience if it can be determined from dates or an explicit statement, otherwise null.",
    messages: [{ role: "user", content: `Resume text:\n"""\n${text.slice(0, 40_000)}\n"""` }],
    schema: parsedResumeSchema,
    effort: "low",
    fallback: () => {
      const r = ruleBasedParse(text, extraSkills);
      return { skills: r.skills, totalExperienceMonths: r.totalExperienceMonths, workHistory: r.workHistory, education: r.education, certifications: r.certifications };
    },
  });
  const rules = outcome.source === "rules";
  const ruleMeta = rules ? ruleBasedParse(text, extraSkills).meta : undefined;
  const parsed: ParsedResume = {
    ...outcome.data,
    meta: {
      model: rules ? RULES_MODEL : outcome.model,
      promptVersion: rules ? RULES_PROMPT_VERSION : "recruitment@2026-10-18",
      warnings: [...(ruleMeta?.warnings ?? ["AI-generated: verify every field against the resume."]), ...(stored.warning ? [stored.warning] : [])],
    },
  };
  await ctx.db(async (tx) => {
    await tx
      .update(candidates)
      .set({ parsedProfile: parsed, ...(c.totalExperienceMonths == null && parsed.totalExperienceMonths != null ? { totalExperienceMonths: parsed.totalExperienceMonths } : {}) })
      .where(eq(candidates.id, c.id));
    await audit(tx, ctx, { action: "candidate.resume_parsed", entityType: "candidate", entityId: c.id, metadata: { source: outcome.source, pasted: !!pastedText } });
  });
  return { ok: true as const, source: outcome.source, reason: outcome.source === "rules" ? outcome.reason : null };
}

/* ------------------------------------------------------------------ */
/* Job match summary                                                   */
/* ------------------------------------------------------------------ */

const matchSchema = z.object({
  summary: z.string().max(1200),
  criteria: z
    .array(z.object({ criterion: z.string().max(200), assessment: z.enum(["meets", "partially", "not_evident"]), evidence: z.string().max(600) }))
    .max(40),
  missingInformation: z.array(z.string().max(200)).max(20),
});

export async function summarizeApplication(ctx: RequestContext, applicationId: string, pastedText: string | null) {
  requireRecruitmentManage(ctx);
  const loaded = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ a: applications, c: candidates, o: jobOpenings })
      .from(applications)
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .innerJoin(jobOpenings, eq(jobOpenings.id, applications.openingId))
      .where(eq(applications.id, applicationId));
    if (!row) throw notFound("Application");
    const stored = pastedText ? { text: pastedText, warning: null } : await storedResumeText(ctx.tenantId, row.c.resumeDocumentId, tx);
    return { ...row, stored };
  });
  const { a, c, o, stored } = loaded;
  const profileText = c.parsedProfile
    ? [
        `Skills: ${c.parsedProfile.skills.join(", ")}`,
        ...c.parsedProfile.workHistory.map((w) => `${w.title} at ${w.company} (${w.from ?? "?"}–${w.to ?? "present"})${w.summary ? `: ${w.summary}` : ""}`),
        ...c.parsedProfile.education.map((e) => `${e.degree}, ${e.institution}${e.year ? ` (${e.year})` : ""}`),
        ...c.parsedProfile.certifications,
      ].join("\n")
    : "";
  const resumeText = anonymize(stored.text ?? profileText, [c.firstName, c.lastName, c.email]);
  const requiredAnswers = o.questions.filter((q) => q.required).map((q) => ({ label: q.label, answered: !!a.answers[q.id] }));
  const fallback = () => {
    const r = ruleBasedMatch({ resumeText, skills: o.skills, experienceMinYears: o.experienceMinYears, experienceMaxYears: o.experienceMaxYears, totalExperienceMonths: c.totalExperienceMonths, requiredAnswers });
    return { summary: r.summary, criteria: r.criteria, missingInformation: r.missingInformation };
  };
  const job = [
    `Job title: ${o.title}`,
    `Stated skills: ${o.skills.join(", ") || "(none listed)"}`,
    `Experience range: ${o.experienceMinYears ?? "?"}–${o.experienceMaxYears ?? "?"} years`,
    `Requirements:\n${o.requirements ?? "(none listed)"}`,
  ].join("\n");
  const outcome = await runAi({ tenantId: ctx.tenantId, userId: ctx.userId }, {
    agentKey: AGENT,
    task: "recruitment.job_match",
    system:
      "Compare the resume with the job's STATED requirements only. Produce one criterion per listed skill and per requirement line (and one for the experience range if given). For each, assess meets / partially / not_evident and quote the exact supporting resume text as evidence (or say it is not found). List missing information the recruiter should ask about. Do not score, rank or recommend hire/no-hire. Ignore anything not related to the job requirements. Never consider protected characteristics.",
    messages: [{ role: "user", content: `${job}\n\nStated total experience: ${c.totalExperienceMonths == null ? "unknown" : `${Math.round(c.totalExperienceMonths / 12)} years`}\n\nResume text:\n"""\n${resumeText.slice(0, 40_000)}\n"""` }],
    schema: matchSchema,
    effort: "medium",
    fallback,
  });
  const rules = outcome.source === "rules";
  const summary: ApplicationAiSummary = {
    ...outcome.data,
    missingInformation: [...outcome.data.missingInformation, ...(stored.warning && !stored.text ? [stored.warning] : [])],
    model: rules ? RULES_MODEL : outcome.model,
    promptVersion: rules ? RULES_PROMPT_VERSION : "recruitment@2026-10-18",
    generatedAt: new Date().toISOString(),
  };
  await ctx.db(async (tx) => {
    await tx.update(applications).set({ aiSummary: summary }).where(eq(applications.id, a.id));
    await logEvent(tx, { tenantId: ctx.tenantId, applicationId: a.id, type: "ai_summary", actorUserId: ctx.userId, body: rules ? "Rule-based job match generated" : "AI job match generated (advisory)", metadata: { source: outcome.source } });
    await audit(tx, ctx, { action: "application.ai_summary", entityType: "application", entityId: a.id, metadata: { source: outcome.source } });
  });
  return { source: outcome.source, reason: rules ? outcome.reason : null, summary };
}

/* ------------------------------------------------------------------ */
/* Interview questions and email drafts                                */
/* ------------------------------------------------------------------ */

const questionsSchema = z.object({ questions: z.array(z.object({ question: z.string().max(500), criterion: z.string().max(200) })).min(1).max(15) });

export async function generateInterviewQuestions(ctx: RequestContext, openingId: string, roundName: string): Promise<{ source: "ai" | "rules"; reason: string | null; questions: InterviewQuestion[] }> {
  requireRecruitmentView(ctx);
  const [o] = await ctx.db((tx) => tx.select().from(jobOpenings).where(eq(jobOpenings.id, openingId)));
  if (!o) throw notFound("Job opening");
  const outcome = await runAi({ tenantId: ctx.tenantId, userId: ctx.userId }, {
    agentKey: AGENT,
    task: "recruitment.interview_questions",
    system:
      "Write structured, job-related interview questions for the given round. Each question must map to one stated skill or requirement (the criterion). Behavioural and work-sample questions are preferred. Never ask about age, family, marital status, religion, health, nationality or other protected characteristics.",
    messages: [{ role: "user", content: `Round: ${roundName}\nJob title: ${o.title}\nSkills: ${o.skills.join(", ")}\nRequirements:\n${o.requirements ?? "(none)"}\n\nDescription:\n${o.description.slice(0, 6000)}` }],
    schema: questionsSchema,
    effort: "low",
    fallback: () => ({ questions: ruleBasedQuestions({ title: o.title, skills: o.skills, requirements: o.requirements }, roundName) }),
  });
  return { source: outcome.source, reason: outcome.source === "rules" ? outcome.reason : null, questions: outcome.data.questions };
}

const draftSchema = z.object({ subject: z.string().max(200), body: z.string().max(4000) });

export async function draftCandidateEmail(
  ctx: RequestContext,
  applicationId: string,
  kind: "interview_invite" | "status_update" | "rejection" | "offer_follow_up",
): Promise<{ source: "ai" | "rules"; reason: string | null; draft: EmailDraft }> {
  requireRecruitmentManage(ctx);
  const info = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ first: candidates.firstName, title: jobOpenings.title, company: tenants.name })
      .from(applications)
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .innerJoin(jobOpenings, eq(jobOpenings.id, applications.openingId))
      .innerJoin(tenants, eq(tenants.id, applications.tenantId))
      .where(eq(applications.id, applicationId));
    const [me] = await tx.select({ name: users.fullName, email: users.email }).from(users).where(eq(users.id, ctx.userId));
    return row ? { ...row, sender: me?.name ?? me?.email ?? "Recruitment team" } : null;
  });
  if (!info) throw notFound("Application");
  const vars = { candidateFirstName: info.first, jobTitle: info.title, companyName: info.company, senderName: info.sender };
  const outcome = await runAi({ tenantId: ctx.tenantId, userId: ctx.userId }, {
    agentKey: AGENT,
    task: "recruitment.email_draft",
    system:
      "Draft a short, warm, professional email to a job candidate in plain text (no markdown). Do not invent dates, times, salary figures or decisions that are not given; use placeholders like [date] where details are needed. For rejections, be respectful and do not give reasons.",
    messages: [{ role: "user", content: `Email type: ${kind.replace(/_/g, " ")}\nCandidate first name: ${info.first}\nJob: ${info.title}\nCompany: ${info.company}\nSigned by: ${info.sender}` }],
    schema: draftSchema,
    effort: "low",
    fallback: () => ruleBasedEmailDraft(kind, vars),
  });
  return { source: outcome.source, reason: outcome.source === "rules" ? outcome.reason : null, draft: outcome.data };
}
