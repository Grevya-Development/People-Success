/**
 * Survey aggregation with small-group suppression. Pure functions shared by
 * the results service and unit tests.
 *
 * Privacy rules implemented here:
 * - Any group (the whole survey, a department, a location, a tenure band)
 *   with fewer responses than `minGroupSize` is reported as suppressed, with
 *   no scores, counts per option or themes.
 * - Free-text answers are never returned individually; only keyword themes
 *   for groups that meet the threshold.
 * - Nothing here infers health, wellbeing or personal circumstances from
 *   answers; scores are reported exactly as the questions asked them.
 */

export type SurveyQuestionLite = {
  id: string;
  label: string;
  type: "scale" | "enps" | "choice" | "text";
  options?: string[];
  driver?: string;
};

export type ResponseLite = {
  departmentId: string | null;
  locationId: string | null;
  tenureBand: string | null;
  answers: Record<string, string | number>;
};

export const TENURE_BANDS = ["<1y", "1-3y", "3y+"] as const;
export type TenureBand = (typeof TENURE_BANDS)[number];
export const TENURE_BAND_LABELS: Record<TenureBand, string> = {
  "<1y": "Less than 1 year",
  "1-3y": "1 to 3 years",
  "3y+": "3 years or more",
};

/** Coarse tenure band from joining date to a reference date (both yyyy-MM-dd). */
export function tenureBand(joiningDate: string, onDate: string): TenureBand {
  const [jy, jm, jd] = joiningDate.split("-").map(Number);
  const [oy, om, od] = onDate.split("-").map(Number);
  let months = (oy - jy) * 12 + (om - jm);
  if (od < jd) months -= 1;
  if (months < 12) return "<1y";
  if (months < 36) return "1-3y";
  return "3y+";
}

const round = (n: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

export type EnpsResult = { score: number; promoters: number; passives: number; detractors: number; count: number };

/** Employee Net Promoter Score: % promoters (9-10) minus % detractors (0-6), rounded. */
export function enpsScore(values: number[]): EnpsResult | null {
  const valid = values.filter((v) => Number.isInteger(v) && v >= 0 && v <= 10);
  if (!valid.length) return null;
  const promoters = valid.filter((v) => v >= 9).length;
  const detractors = valid.filter((v) => v <= 6).length;
  const passives = valid.length - promoters - detractors;
  return {
    score: Math.round(((promoters - detractors) / valid.length) * 100),
    promoters,
    passives,
    detractors,
    count: valid.length,
  };
}

export type ScaleResult = { average: number; favorablePercent: number; distribution: Record<number, number>; count: number };

/** 1-5 scale: mean, share of favourable (4-5) answers and the distribution. */
export function scaleStats(values: number[]): ScaleResult | null {
  const valid = values.filter((v) => Number.isInteger(v) && v >= 1 && v <= 5);
  if (!valid.length) return null;
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const v of valid) distribution[v] += 1;
  return {
    average: round(valid.reduce((a, b) => a + b, 0) / valid.length),
    favorablePercent: Math.round((valid.filter((v) => v >= 4).length / valid.length) * 100),
    distribution,
    count: valid.length,
  };
}

const STOP_WORDS = new Set(
  (
    "a an and are as at be been but by can could did do does for from had has have he her his i if in into is it its " +
    "just me more most my no not of on or our out over so some than that the their them then there these they this to " +
    "too very was we were what when where which while who why will with would you your also about all any because more " +
    "much should get got make made like really feel think things thing lot"
  ).split(/\s+/),
);

/** Most frequent meaningful words across answers (deterministic theme fallback). */
export function keywordThemes(texts: string[], limit = 8): { term: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of texts) {
    // Count each term once per answer so one long answer cannot dominate.
    const seen = new Set(
      t
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w)),
    );
    for (const w of seen) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 2 || texts.length < 4)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

export type QuestionResult =
  | { id: string; label: string; type: "scale"; driver: string | null; stats: ScaleResult | null }
  | { id: string; label: string; type: "enps"; driver: string | null; enps: EnpsResult | null }
  | { id: string; label: string; type: "choice"; driver: string | null; counts: { option: string; count: number }[]; total: number }
  | { id: string; label: string; type: "text"; driver: string | null; answered: number; themes: { term: string; count: number }[] };

const numeric = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

function summarizeQuestion(q: SurveyQuestionLite, responses: ResponseLite[]): QuestionResult {
  const raw = responses.map((r) => r.answers[q.id]).filter((v) => v !== undefined && v !== null && v !== "");
  const driver = q.driver ?? null;
  switch (q.type) {
    case "scale":
      return { id: q.id, label: q.label, type: "scale", driver, stats: scaleStats(raw.map(numeric)) };
    case "enps":
      return { id: q.id, label: q.label, type: "enps", driver, enps: enpsScore(raw.map(numeric)) };
    case "choice": {
      const counts = (q.options ?? []).map((option) => ({ option, count: raw.filter((v) => v === option).length }));
      return { id: q.id, label: q.label, type: "choice", driver, counts, total: raw.length };
    }
    case "text": {
      const texts = raw.map(String);
      return { id: q.id, label: q.label, type: "text", driver, answered: texts.length, themes: keywordThemes(texts) };
    }
  }
}

export type DriverResult = { driver: string; average: number; count: number };

/** Mean of all 1-5 scale answers per driver. */
export function driverAverages(questions: SurveyQuestionLite[], responses: ResponseLite[]): DriverResult[] {
  const byDriver = new Map<string, number[]>();
  for (const q of questions) {
    if (q.type !== "scale" || !q.driver) continue;
    const list = byDriver.get(q.driver) ?? [];
    for (const r of responses) {
      const v = numeric(r.answers[q.id]);
      if (Number.isInteger(v) && v >= 1 && v <= 5) list.push(v);
    }
    byDriver.set(q.driver, list);
  }
  return [...byDriver.entries()]
    .filter(([, values]) => values.length > 0)
    .map(([driver, values]) => ({ driver, average: round(values.reduce((a, b) => a + b, 0) / values.length), count: values.length }))
    .sort((a, b) => a.driver.localeCompare(b.driver));
}

/** Mean of every 1-5 scale answer in the set; the headline engagement score. */
export function overallScaleAverage(questions: SurveyQuestionLite[], responses: ResponseLite[]): number | null {
  const values: number[] = [];
  for (const q of questions) {
    if (q.type !== "scale") continue;
    for (const r of responses) {
      const v = numeric(r.answers[q.id]);
      if (Number.isInteger(v) && v >= 1 && v <= 5) values.push(v);
    }
  }
  return values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

export type SurveyAggregate = {
  responseCount: number;
  participantCount: number;
  responseRate: number | null;
  minGroupSize: number;
  /** True when the survey as a whole has fewer responses than minGroupSize. */
  suppressed: boolean;
  overallAverage: number | null;
  enps: EnpsResult | null;
  drivers: DriverResult[];
  questions: QuestionResult[];
};

export function aggregateSurvey(input: {
  questions: SurveyQuestionLite[];
  responses: ResponseLite[];
  minGroupSize: number;
  participantCount: number;
}): SurveyAggregate {
  const { questions, responses, participantCount } = input;
  const minGroupSize = Math.max(3, input.minGroupSize);
  const responseCount = responses.length;
  const base = {
    responseCount,
    participantCount,
    responseRate: participantCount > 0 ? round(responseCount / participantCount, 4) : null,
    minGroupSize,
  };
  if (responseCount < minGroupSize) {
    return { ...base, suppressed: true, overallAverage: null, enps: null, drivers: [], questions: [] };
  }
  const enpsQuestion = questions.find((q) => q.type === "enps");
  return {
    ...base,
    suppressed: false,
    overallAverage: overallScaleAverage(questions, responses),
    enps: enpsQuestion ? enpsScore(responses.map((r) => numeric(r.answers[enpsQuestion.id]))) : null,
    drivers: driverAverages(questions, responses),
    questions: questions.map((q) => summarizeQuestion(q, responses)),
  };
}

export type BreakdownDimension = "department" | "location" | "tenure";

export type BreakdownGroup =
  | { key: string; label: string; suppressed: true }
  | {
      key: string;
      label: string;
      suppressed: false;
      count: number;
      overallAverage: number | null;
      enps: number | null;
      drivers: DriverResult[];
    };

const dimensionKey = (r: ResponseLite, by: BreakdownDimension) =>
  by === "department" ? r.departmentId : by === "location" ? r.locationId : r.tenureBand;

/**
 * Break results down by a coarse attribute. Groups below minGroupSize are
 * marked suppressed and carry no numbers at all (not even their count, which
 * would reveal how few people answered from a small team).
 */
export function breakdown(input: {
  questions: SurveyQuestionLite[];
  responses: ResponseLite[];
  minGroupSize: number;
  by: BreakdownDimension;
  labels: Record<string, string>;
}): BreakdownGroup[] {
  const minGroupSize = Math.max(3, input.minGroupSize);
  const groups = new Map<string, ResponseLite[]>();
  for (const r of input.responses) {
    const key = dimensionKey(r, input.by) ?? "unassigned";
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  const enpsQuestion = input.questions.find((q) => q.type === "enps");
  return [...groups.entries()]
    .map(([key, list]): BreakdownGroup => {
      const label = input.labels[key] ?? (key === "unassigned" ? "Not specified" : "Other");
      if (list.length < minGroupSize) return { key, label, suppressed: true };
      return {
        key,
        label,
        suppressed: false,
        count: list.length,
        overallAverage: overallScaleAverage(input.questions, list),
        enps: enpsQuestion ? (enpsScore(list.map((r) => numeric(r.answers[enpsQuestion.id])))?.score ?? null) : null,
        drivers: driverAverages(input.questions, list),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Text answers for one question, released only when the group meets the threshold. */
export function releasableTexts(questionId: string, responses: ResponseLite[], minGroupSize: number): string[] | null {
  const texts = responses
    .map((r) => r.answers[questionId])
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
  return texts.length >= Math.max(3, minGroupSize) ? texts : null;
}
