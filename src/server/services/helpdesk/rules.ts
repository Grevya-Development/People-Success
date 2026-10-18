import { can, type RequestContext } from "../../auth/context";

export const canManageHelpdesk = (ctx: Pick<RequestContext, "grants">) => can(ctx, "helpdesk.manage", "all");
export const isHelpdeskAgent = (ctx: Pick<RequestContext, "grants">) => can(ctx, "helpdesk.agent", "all") || canManageHelpdesk(ctx);

/* ------------------------------------------------------------------ */
/* Sensitive topics: deterministic, never decided by AI                */
/* ------------------------------------------------------------------ */

/**
 * Phrases that indicate harassment, grievances, health matters or
 * disciplinary issues. Matching tickets are routed to the sensitive
 * (grievance) queue with high priority by this rule, and their text is never
 * sent to an AI model. Patterns are deliberately specific ("mental health",
 * not "health") so routine benefit questions are not misrouted.
 */
const SENSITIVE_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "harassment", re: /\bharass/i },
  { label: "sexual misconduct", re: /\bsexual(ly)?\b|\bposh\b|\bmolest/i },
  { label: "bullying", re: /\bbull(y|ied|ying)\b/i },
  { label: "discrimination", re: /\bdiscriminat/i },
  { label: "retaliation", re: /\bretaliat|\bvictimi[sz]/i },
  { label: "violence or threats", re: /\bassault|\bthreat(en|ened|ening|s)?\b|\bviolen(t|ce)\b|\babus(e|ed|ive)\b/i },
  { label: "hostile workplace", re: /\bhostile (work|environment)|\bunsafe at work/i },
  { label: "grievance", re: /\bgrievance|\bwhistle ?blow/i },
  { label: "health", re: /\bmental health\b|\bmedical condition\b|\bhealth condition\b|\bdiagnos(ed|is)\b|\bpregnan|\bdisabilit|\bmiscarriage\b/i },
  { label: "disciplinary", re: /\bdisciplinary\b|\bshow[- ]cause\b|\bmisconduct\b|\bwarning letter\b|\bsuspen(ded|sion)\b/i },
];

export function sensitiveTopic(text: string): string | null {
  return SENSITIVE_PATTERNS.find((p) => p.re.test(text))?.label ?? null;
}

/* ------------------------------------------------------------------ */
/* Keyword triage fallback                                             */
/* ------------------------------------------------------------------ */

/** Default category names (as seeded) and the words that point to them. */
const CATEGORY_KEYWORDS: { category: string; re: RegExp }[] = [
  { category: "Payroll & payslips", re: /\b(salary|payslip|pay ?slip|payroll|tds|form ?16|pf|epf|uan|esi|professional tax|deduction|arrears?|bonus|reimburse|ctc|tax)\b/i },
  { category: "Leave & attendance", re: /\b(leave|leaves|attendance|holiday|regulari[sz]|punch|shift|work from home|wfh|comp ?off|absent|late mark)\b/i },
  { category: "Documents & letters", re: /\b(letter|certificate|document|address proof|employment proof|experience letter|relieving|noc|visa)\b/i },
  { category: "IT & assets", re: /\b(laptop|password|login|access|email account|vpn|asset|monitor|phone|sim|software|license|id card)\b/i },
  { category: "Policies", re: /\b(policy|policies|handbook|code of conduct|rule|guideline|entitle)/i },
];

const URGENT = /\b(urgent|asap|immediately|today|not (been )?(credited|paid)|blocked|cannot work|can't work)\b/i;

export type TriageSuggestion = { categoryId: string | null; priority: "low" | "normal" | "high" | "urgent"; confidence: number; rationale: string };

export function keywordTriage(text: string, categories: { id: string; name: string }[]): TriageSuggestion {
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  let best: { id: string; name: string; hits: number } | null = null;
  for (const rule of CATEGORY_KEYWORDS) {
    const id = byName.get(rule.category.toLowerCase());
    if (!id) continue;
    const hits = (text.match(new RegExp(rule.re.source, "gi")) ?? []).length;
    if (hits && (!best || hits > best.hits)) best = { id, name: rule.category, hits };
  }
  const urgent = URGENT.test(text);
  return {
    categoryId: best?.id ?? null,
    priority: urgent ? "high" : "normal",
    confidence: best ? Math.min(0.4 + best.hits * 0.1, 0.7) : 0.2,
    rationale: best
      ? `Keywords match “${best.name}”${urgent ? "; wording suggests urgency" : ""}.`
      : `No category keywords matched${urgent ? "; wording suggests urgency" : ""}.`,
  };
}

/* ------------------------------------------------------------------ */
/* SLA                                                                 */
/* ------------------------------------------------------------------ */

export const DEFAULT_SLA = { firstResponseHours: 8, resolutionHours: 48 };

/**
 * SLA due times are calendar hours from creation (business hours and
 * holidays are not excluded) so they are predictable and easy to audit.
 */
export function slaDue(createdAt: Date, sla: { firstResponseHours: number; resolutionHours: number }) {
  return {
    firstResponseDueAt: new Date(createdAt.getTime() + sla.firstResponseHours * 3_600_000),
    resolutionDueAt: new Date(createdAt.getTime() + sla.resolutionHours * 3_600_000),
  };
}

export const REOPEN_WINDOW_DAYS = 7;
export const AUTO_CLOSE_DAYS = 7;
const PRIORITY_RANK = { low: 0, normal: 1, high: 2, urgent: 3 } as const;
export const atLeast = (p: keyof typeof PRIORITY_RANK, min: keyof typeof PRIORITY_RANK) => (PRIORITY_RANK[p] >= PRIORITY_RANK[min] ? p : min);
