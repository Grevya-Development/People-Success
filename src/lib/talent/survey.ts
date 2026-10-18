import type { SurveyQuestionLite } from "./aggregation";

export type SurveyQuestionFull = SurveyQuestionLite & { required: boolean };

/**
 * Validate and normalize survey answers: scale 1-5, eNPS 0-10 (integers),
 * choice from the listed options, text up to 2000 characters. Unknown
 * question ids are dropped. Returns field errors keyed by question id.
 */
export function validateSurveyAnswers(questions: SurveyQuestionFull[], raw: Record<string, string | number>) {
  const answers: Record<string, string | number> = {};
  const errors: Record<string, string[]> = {};
  for (const q of questions) {
    const v = raw[q.id];
    const empty = v === undefined || v === null || (typeof v === "string" && v.trim() === "");
    if (empty) {
      if (q.required) errors[q.id] = ["Please answer this question"];
      continue;
    }
    if (q.type === "scale" || q.type === "enps") {
      const n = typeof v === "number" ? v : Number(v);
      const [min, max] = q.type === "scale" ? [1, 5] : [0, 10];
      if (!Number.isInteger(n) || n < min || n > max) errors[q.id] = [`Choose a value from ${min} to ${max}`];
      else answers[q.id] = n;
    } else if (q.type === "choice") {
      const s = String(v);
      if (!(q.options ?? []).includes(s)) errors[q.id] = ["Choose one of the options"];
      else answers[q.id] = s;
    } else {
      const s = String(v).trim();
      if (s.length > 2000) errors[q.id] = ["Keep it under 2000 characters"];
      else answers[q.id] = s;
    }
  }
  return { answers, errors, ok: Object.keys(errors).length === 0 };
}

/** Starter question sets for new surveys. */
export const SURVEY_TEMPLATES: Record<string, { label: string; questions: SurveyQuestionFull[] }> = {
  pulse: {
    label: "Quick pulse",
    questions: [
      { id: "valued", label: "I feel valued for the work I do.", type: "scale", driver: "Recognition", required: true },
      { id: "growth", label: "I see opportunities to learn and grow here.", type: "scale", driver: "Growth", required: true },
      { id: "manager", label: "My manager supports me in doing my best work.", type: "scale", driver: "Manager support", required: true },
      { id: "enps", label: "How likely are you to recommend working here to a friend?", type: "enps", required: true },
      { id: "change", label: "What one thing would make work better for you?", type: "text", required: false },
    ],
  },
  onboarding: {
    label: "Onboarding check-in",
    questions: [
      { id: "ready", label: "I had what I needed to be productive in my first weeks.", type: "scale", driver: "Enablement", required: true },
      { id: "clarity", label: "My role and expectations are clear.", type: "scale", driver: "Clarity", required: true },
      { id: "welcome", label: "My team made me feel welcome.", type: "scale", driver: "Belonging", required: true },
      { id: "improve", label: "What could we improve about onboarding?", type: "text", required: false },
    ],
  },
  exit: {
    label: "Exit survey",
    questions: [
      { id: "reason", label: "Main reason for leaving", type: "choice", options: ["Career growth", "Compensation", "Manager", "Work-life balance", "Relocation", "Other"], required: true },
      { id: "recommend", label: "How likely are you to recommend working here to a friend?", type: "enps", required: true },
      { id: "keep", label: "What could we have done to keep you?", type: "text", required: false },
    ],
  },
};
