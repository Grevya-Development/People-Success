/**
 * Performance math: goal weights, goal progress, and the suggested overall
 * rating. Pure and deterministic. AI never computes ratings.
 */

export type RatingLevelLite = { value: number; label: string; description?: string };

export const DEFAULT_RATING_SCALE: { name: string; levels: RatingLevelLite[] } = {
  name: "Standard 5-point",
  levels: [
    { value: 1, label: "Needs improvement", description: "Falls short of most expectations." },
    { value: 2, label: "Partially meets", description: "Meets some expectations; development needed." },
    { value: 3, label: "Meets expectations", description: "Consistently delivers what the role requires." },
    { value: 4, label: "Exceeds expectations", description: "Often goes beyond what the role requires." },
    { value: 5, label: "Outstanding", description: "Exceptional impact well beyond the role." },
  ],
};

export const MAX_GOAL_WEIGHT = 100;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function scaleBounds(levels: RatingLevelLite[]) {
  const values = levels.map((l) => l.value);
  if (!values.length) return { min: 1, max: 5 };
  return { min: Math.min(...values), max: Math.max(...values) };
}

/**
 * Validate that an employee's goal weights in one cycle total at most 100.
 * `existing` are the weights of the other (non-cancelled) goals; `next` the
 * weight being saved.
 */
export function validateGoalWeights(existing: number[], next: number, limit = MAX_GOAL_WEIGHT) {
  if (!Number.isInteger(next) || next < 0) return { ok: false as const, total: NaN, remaining: 0, message: "Weight must be a whole number of 0 or more." };
  const others = existing.reduce((a, b) => a + b, 0);
  const total = others + next;
  const remaining = Math.max(0, limit - others);
  if (total > limit) {
    return { ok: false as const, total, remaining, message: `Goal weights would total ${total}%. Only ${remaining}% is left in this cycle.` };
  }
  return { ok: true as const, total, remaining: limit - total, message: null };
}

/** Progress (0-100) from start/target/current values; null when not measurable. */
export function progressFromValues(start: number | null | undefined, target: number | null | undefined, current: number | null | undefined) {
  if (target == null || current == null) return null;
  const from = start ?? 0;
  if (target === from) return current >= target ? 100 : 0;
  const pct = ((current - from) / (target - from)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export type GoalLite = { weight: number; progressPercent: number; status: string };

/**
 * Weighted goal attainment (0-100). Cancelled goals are ignored. When no goal
 * carries weight, every goal counts equally.
 */
export function goalsAttainment(goals: GoalLite[]): number | null {
  const live = goals.filter((g) => g.status !== "cancelled" && g.status !== "draft");
  if (!live.length) return null;
  const totalWeight = live.reduce((a, g) => a + Math.max(0, g.weight), 0);
  if (totalWeight === 0) return round2(live.reduce((a, g) => a + g.progressPercent, 0) / live.length);
  return round2(live.reduce((a, g) => a + g.progressPercent * Math.max(0, g.weight), 0) / totalWeight);
}

/** Map attainment (0-100) onto the rating scale linearly. */
export function attainmentToRating(attainment: number, levels: RatingLevelLite[]) {
  const { min, max } = scaleBounds(levels);
  return round2(min + ((max - min) * Math.max(0, Math.min(100, attainment))) / 100);
}

export type TemplateQuestionLite = {
  id: string;
  type: "rating" | "text" | "competency";
  forKinds: string[];
};

export type RatingSuggestion = {
  questionAverage: number | null;
  goalsAttainment: number | null;
  goalsRating: number | null;
  /** Suggested overall rating, or null when there is nothing to rate yet. */
  overall: number | null;
  goalsWeightPercent: number;
};

/**
 * Suggested overall rating = rating/competency question average blended with
 * goal attainment by the template's goals weight. If one side is missing the
 * other carries the full weight.
 */
export function computeOverallRating(input: {
  questions: TemplateQuestionLite[];
  responses: Record<string, { rating?: number; text?: string }>;
  kind: string;
  levels: RatingLevelLite[];
  goals: GoalLite[];
  includeGoals: boolean;
  goalsWeightPercent: number;
}): RatingSuggestion {
  const { min, max } = scaleBounds(input.levels);
  const ratings = input.questions
    .filter((q) => (q.type === "rating" || q.type === "competency") && q.forKinds.includes(input.kind))
    .map((q) => input.responses[q.id]?.rating)
    .filter((r): r is number => typeof r === "number" && r >= min && r <= max);
  const questionAverage = ratings.length ? round2(ratings.reduce((a, b) => a + b, 0) / ratings.length) : null;
  const attainment = input.includeGoals ? goalsAttainment(input.goals) : null;
  const goalsRating = attainment == null ? null : attainmentToRating(attainment, input.levels);
  const weight = Math.max(0, Math.min(100, input.includeGoals ? input.goalsWeightPercent : 0));
  let overall: number | null = null;
  if (questionAverage != null && goalsRating != null) overall = round2((questionAverage * (100 - weight) + goalsRating * weight) / 100);
  else overall = questionAverage ?? goalsRating;
  return { questionAverage, goalsAttainment: attainment, goalsRating, overall, goalsWeightPercent: weight };
}

/** A manager's rating that differs from the suggestion must be justified. */
export function overrideNeedsJustification(suggested: number | null, chosen: number | null) {
  if (chosen == null || suggested == null) return false;
  return Math.abs(suggested - chosen) >= 0.01;
}

/** Nearest scale level for distribution charts. */
export function nearestLevel(rating: number, levels: RatingLevelLite[]) {
  const sorted = [...levels].sort((a, b) => a.value - b.value);
  if (!sorted.length) return Math.round(rating);
  let best = sorted[0];
  for (const l of sorted) if (Math.abs(l.value - rating) < Math.abs(best.value - rating)) best = l;
  return best.value;
}
