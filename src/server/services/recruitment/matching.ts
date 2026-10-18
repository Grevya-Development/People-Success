/**
 * Deterministic recruitment helpers. Pure functions (no I/O), used as the
 * rule-based fallback for every AI feature and unit-tested directly.
 *
 * Fairness rules that apply here and to everything sent to an AI model:
 *  - candidates are assessed ONLY against the opening's stated skills,
 *    experience range and requirements;
 *  - protected characteristics (date of birth / age, gender, marital status,
 *    religion, caste, nationality, family details, photos, health) are
 *    stripped from resume text before any processing;
 *  - results are advisory and never used to rank, filter or reject anyone.
 */
import type { ApplicationAiSummary, ParsedResume } from "../../db/schema/recruitment";

export const RULES_MODEL = "rule-based";
export const RULES_PROMPT_VERSION = "rules@2026-10-18";

/* ------------------------------------------------------------------ */
/* Protected characteristics                                           */
/* ------------------------------------------------------------------ */

/** "Label: value" lines that carry protected attributes (label at the start of the line). */
const PROTECTED_LINE =
  /^[\s•*\-–|]*(?:date\s*of\s*birth|d\.?\s?o\.?\s?b\.?|birth\s*date|born(?:\s+on)?|age|gender|sex|marital\s*status|religion|caste|nationality|citizenship|father'?s?\s*name|mother'?s?\s*name|spouse(?:'s)?\s*name|husband'?s?\s*name|wife'?s?\s*name|no\.?\s*of\s*children|children|dependents|blood\s*group|height|weight|disability|health\s*status|photo(?:graph)?|passport\s*(?:no|number)|aadhaa?r(?:\s*(?:no|number))?|pan\s*(?:no|number|card))\s*[:\-–][^\n]*$/gim;

/** Inline fragments that reveal protected attributes. */
const PROTECTED_INLINE: RegExp[] = [
  /\b(?:d\.?o\.?b\.?|date\s+of\s+birth|born\s+on)\b[^\n]{0,30}/gi,
  /\b\d{1,2}\s*(?:years?|yrs?)\s*old\b/gi,
  /\baged?\s*[:\-]?\s*\d{2}\b/gi,
  /\b(?:male|female|transgender|non-binary)\b/gi,
  /\b(?:married|unmarried|single|divorced|widowed|engaged)\b(?!\s+(?:to\s+)?(?:code|quality|deadline|data))/gi,
  /\b(?:hindu|muslim|christian|sikh|jain|buddhist|parsi)\b/gi,
  /\b(?:s\/o|d\/o|w\/o)\b[^\n,;]*/gi,
];

/**
 * Remove protected characteristics from free text. Returns the cleaned text
 * and how many fragments were removed (shown as a warning, never the values).
 */
export function scrubProtected(text: string): { text: string; removed: number } {
  let removed = 0;
  let out = text.replace(PROTECTED_LINE, () => {
    removed++;
    return "[removed]";
  });
  for (const re of PROTECTED_INLINE) {
    out = out.replace(re, () => {
      removed++;
      return "[removed]";
    });
  }
  return { text: out, removed };
}

/* ------------------------------------------------------------------ */
/* Skill matching                                                      */
/* ------------------------------------------------------------------ */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Regex for a term with "word" boundaries that also work for C++, C#, .NET, Node.js. */
function termRegex(term: string) {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRe(term)}(?![A-Za-z0-9+#])`, "i");
}

function variants(skill: string) {
  const s = skill.trim();
  const set = new Set([s]);
  set.add(s.replace(/[.\-\s]+/g, ""));
  set.add(s.replace(/[.\-]+/g, " "));
  if (/\.js$/i.test(s)) set.add(s.replace(/\.js$/i, ""));
  return [...set].filter((v) => v.length >= 1);
}

/** About `radius` characters around a match, whitespace collapsed, with ellipses. */
export function snippet(text: string, index: number, length: number, radius = 70) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

export type SkillHit = { skill: string; assessment: "meets" | "partially" | "not_evident"; evidence: string };

const STOP = new Set(["and", "the", "with", "for", "of", "in", "on", "to", "or", "a", "an"]);

export function matchSkill(text: string, skill: string): SkillHit {
  for (const v of variants(skill)) {
    const m = termRegex(v).exec(text);
    if (m) return { skill, assessment: "meets", evidence: snippet(text, m.index, m[0].length) };
  }
  // Multi-word skills: some of the significant words present counts as partial evidence.
  const words = skill
    .toLowerCase()
    .split(/[\s/]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
  if (words.length >= 2) {
    const found = words.map((w) => ({ w, m: termRegex(w).exec(text) })).filter((x) => x.m);
    if (found.length * 2 >= words.length) {
      const first = found[0].m!;
      return {
        skill,
        assessment: "partially",
        evidence: `Related terms found (${found.map((f) => f.w).join(", ")}): ${snippet(text, first.index, first[0].length)}`,
      };
    }
  }
  return { skill, assessment: "not_evident", evidence: "Not found in the resume text." };
}

export type MatchInput = {
  resumeText: string;
  skills: string[];
  experienceMinYears: number | null;
  experienceMaxYears: number | null;
  /** Known total experience (application form or parsed profile). */
  totalExperienceMonths: number | null;
  /** Screening questions marked required, with whether they were answered. */
  requiredAnswers?: { label: string; answered: boolean }[];
};

/**
 * Rule-based job match: each of the opening's stated skills is looked up in
 * the (scrubbed) resume text with an evidence snippet; experience is compared
 * with the stated range. Nothing else is considered.
 */
export function ruleBasedMatch(input: MatchInput, now = new Date()): ApplicationAiSummary {
  const { text } = scrubProtected(input.resumeText ?? "");
  const hits = input.skills.map((s) => matchSkill(text, s));
  const criteria: ApplicationAiSummary["criteria"] = hits.map((h) => ({ criterion: `Skill: ${h.skill}`, assessment: h.assessment, evidence: h.evidence }));
  const missing: string[] = [];

  if (input.experienceMinYears != null || input.experienceMaxYears != null) {
    const range =
      input.experienceMinYears != null && input.experienceMaxYears != null
        ? `${input.experienceMinYears}–${input.experienceMaxYears} years`
        : input.experienceMinYears != null
          ? `at least ${input.experienceMinYears} years`
          : `up to ${input.experienceMaxYears} years`;
    if (input.totalExperienceMonths == null) {
      criteria.push({ criterion: `Experience: ${range}`, assessment: "not_evident", evidence: "Total experience was not stated." });
      missing.push("Total years of relevant experience");
    } else {
      const years = Math.round((input.totalExperienceMonths / 12) * 10) / 10;
      const min = input.experienceMinYears ?? 0;
      const assessment = years >= min ? "meets" : years >= min * 0.75 ? "partially" : "not_evident";
      const over = input.experienceMaxYears != null && years > input.experienceMaxYears ? " (above the stated range)" : "";
      criteria.push({ criterion: `Experience: ${range}`, assessment, evidence: `Stated total experience: ${years} years${over}.` });
    }
  }

  for (const h of hits) if (h.assessment === "not_evident") missing.push(`Evidence of ${h.skill}`);
  for (const q of input.requiredAnswers ?? []) if (!q.answered) missing.push(`Answer to “${q.label}”`);
  if (!text.trim()) missing.unshift("Resume text (upload a PDF/DOCX resume or paste the text)");

  const met = hits.filter((h) => h.assessment === "meets").length;
  const partial = hits.filter((h) => h.assessment === "partially").length;
  const summary = input.skills.length
    ? `Rule-based keyword check: ${met} of ${input.skills.length} listed skills found in the resume${partial ? `, ${partial} partially` : ""}. Keyword presence is not proof of proficiency; verify in interview.`
    : "Rule-based check: the opening lists no skills, so only experience could be compared.";

  return {
    summary,
    criteria,
    missingInformation: [...new Set(missing)].slice(0, 20),
    model: RULES_MODEL,
    promptVersion: RULES_PROMPT_VERSION,
    generatedAt: now.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Rule-based resume parsing                                           */
/* ------------------------------------------------------------------ */

/** Common skills recognised by the fallback parser, in addition to the tenant's opening skills. */
export const COMMON_SKILLS = [
  "JavaScript", "TypeScript", "React", "Next.js", "Node.js", "Python", "Java", "Kotlin", "Swift", "Go", "Rust", "C++", "C#", ".NET",
  "SQL", "PostgreSQL", "MySQL", "MongoDB", "Redis", "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Terraform", "Git", "GraphQL",
  "REST", "HTML", "CSS", "Tailwind", "Django", "Flask", "Spring", "Angular", "Vue", "Figma", "Excel", "Power BI", "Tableau",
  "SAP", "Tally", "GST", "Payroll", "Recruitment", "Salesforce", "HubSpot", "SEO", "Content writing", "Machine learning",
  "Data analysis", "Project management", "Agile", "Scrum", "Customer support", "Sales", "Accounting", "Communication",
];

const DEGREE = /\b(b\.?\s?tech|b\.?\s?e\.?|m\.?\s?tech|m\.?\s?e\.?|mba|pgdm|b\.?\s?sc|m\.?\s?sc|bca|mca|b\.?\s?com|m\.?\s?com|ca|bba|b\.?a\.?|m\.?a\.?|ph\.?\s?d|bachelor|master|diploma|doctorate)\b/i;
const YEAR = /\b(19[6-9]\d|20[0-4]\d)\b/g;

export function ruleBasedParse(resumeText: string, extraSkills: string[] = []): ParsedResume {
  const { text, removed } = scrubProtected(resumeText);
  const lines = text.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const pool = [...new Set([...extraSkills, ...COMMON_SKILLS])];
  const skills = pool.filter((s) => matchSkill(text, s).assessment === "meets").slice(0, 40);

  const education = lines
    .filter((l) => DEGREE.test(l) && l.length < 200)
    .slice(0, 6)
    .map((l) => {
      const years = l.match(YEAR);
      const degree = l.match(DEGREE)?.[0] ?? "Degree";
      return { institution: l.replace(/\s*\(?\b(19|20)\d{2}\b\)?/g, "").slice(0, 120), degree, year: years ? Number(years[years.length - 1]) : null };
    });

  const certifications = lines.filter((l) => /\b(certified|certification|certificate)\b/i.test(l) && l.length < 160).slice(0, 10);

  const workHistory: ParsedResume["workHistory"] = [];
  const ROLE = /^(.{2,80}?)\s+(?:at|@|,|\||–|-)\s+(.{2,80}?)\s*[(|,–-]?\s*((?:19|20)\d{2})\s*(?:-|–|to)\s*((?:19|20)\d{2}|present|current|now)\)?\s*$/i;
  for (const l of lines) {
    const m = ROLE.exec(l);
    if (m) workHistory.push({ title: m[1].trim(), company: m[2].trim(), from: m[3], to: /^\d{4}$/.test(m[4]) ? m[4] : null });
    if (workHistory.length >= 10) break;
  }

  let totalExperienceMonths: number | null = null;
  const exp = /(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:\w+\s+){0,3}experience/i.exec(text);
  if (exp) totalExperienceMonths = Math.round(Number(exp[1]) * 12);

  const warnings = [
    "Rule-based extraction: verify every field against the resume.",
    ...(workHistory.length ? [] : ["Work history could not be extracted reliably."]),
    ...(removed ? [`${removed} personal detail(s) such as age, gender or marital status were removed before processing.`] : []),
  ];
  return {
    skills,
    totalExperienceMonths,
    workHistory,
    education,
    certifications,
    meta: { model: RULES_MODEL, promptVersion: RULES_PROMPT_VERSION, warnings },
  };
}

/* ------------------------------------------------------------------ */
/* Interview questions and email drafts                                */
/* ------------------------------------------------------------------ */

export type InterviewQuestion = { question: string; criterion: string };

export function ruleBasedQuestions(opening: { title: string; skills: string[]; requirements: string | null }, roundName: string): InterviewQuestion[] {
  const out: InterviewQuestion[] = [];
  for (const s of opening.skills.slice(0, 6)) {
    out.push({
      criterion: `Skill: ${s}`,
      question: `Walk us through a recent piece of work where you used ${s}. What was your part, what was hard, and what would you do differently?`,
    });
  }
  const reqLines = (opening.requirements ?? "")
    .split("\n")
    .map((l) => l.replace(/^[\s*\-•\d.)]+/, "").trim())
    .filter((l) => l.length > 8)
    .slice(0, 4);
  for (const r of reqLines) out.push({ criterion: `Requirement: ${r.slice(0, 80)}`, question: `The role needs: “${r}”. Tell us about a time you did this and how you measured the result.` });
  out.push({ criterion: "Role understanding", question: `What do you think success looks like in the first six months as ${opening.title}?` });
  if (/final|manager|culture|values/i.test(roundName)) {
    out.push({ criterion: "Collaboration", question: "Describe a disagreement with a colleague about how to do something. How was it resolved?" });
  }
  return out.slice(0, 12);
}

export type EmailDraft = { subject: string; body: string };

export function ruleBasedEmailDraft(
  kind: "interview_invite" | "status_update" | "rejection" | "offer_follow_up",
  v: { candidateFirstName: string; jobTitle: string; companyName: string; senderName: string },
): EmailDraft {
  const hi = `Dear ${v.candidateFirstName},`;
  const sign = `Regards,\n${v.senderName}\n${v.companyName}`;
  switch (kind) {
    case "interview_invite":
      return {
        subject: `Interview for ${v.jobTitle} at ${v.companyName}`,
        body: `${hi}\n\nThank you for your interest in the ${v.jobTitle} role. We would like to invite you to an interview. Please reply with two or three time slots that work for you over the next week, and we will confirm the details.\n\n${sign}`,
      };
    case "status_update":
      return {
        subject: `Update on your application for ${v.jobTitle}`,
        body: `${hi}\n\nThank you for your patience. Your application for ${v.jobTitle} is still under review, and we expect to share an update soon.\n\n${sign}`,
      };
    case "rejection":
      return {
        subject: `Your application for ${v.jobTitle}`,
        body: `${hi}\n\nThank you for the time you invested in applying for the ${v.jobTitle} role. After careful consideration, we have decided not to take your application further at this time. We appreciate your interest in ${v.companyName} and wish you the very best.\n\n${sign}`,
      };
    case "offer_follow_up":
      return {
        subject: `Following up on your offer for ${v.jobTitle}`,
        body: `${hi}\n\nWe wanted to check whether you had any questions about the offer for the ${v.jobTitle} role. We are happy to set up a call if that would help.\n\n${sign}`,
      };
  }
}
