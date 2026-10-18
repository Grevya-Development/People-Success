import { describe, expect, it } from "vitest";
import {
  DEFAULT_RATING_SCALE,
  attainmentToRating,
  computeOverallRating,
  goalsAttainment,
  nearestLevel,
  overrideNeedsJustification,
  progressFromValues,
  validateGoalWeights,
} from "@/lib/talent/ratings";
import { addMonthsIso, learningBucket, matchesAssignment, scoreQuiz } from "@/lib/talent/learning";
import { coachingTopicsFallback, extractiveSummary } from "@/lib/talent/text";

const levels = DEFAULT_RATING_SCALE.levels;

describe("goal weights", () => {
  it("accepts totals up to 100", () => {
    expect(validateGoalWeights([40, 30], 30)).toMatchObject({ ok: true, total: 100, remaining: 0 });
    expect(validateGoalWeights([], 0)).toMatchObject({ ok: true, total: 0 });
  });
  it("rejects totals over 100 and reports what is left", () => {
    const r = validateGoalWeights([60, 30], 20);
    expect(r.ok).toBe(false);
    expect(r.total).toBe(110);
    expect(r.remaining).toBe(10);
    expect(r.message).toMatch(/10% is left/);
  });
  it("rejects negative or fractional weights", () => {
    expect(validateGoalWeights([], -5).ok).toBe(false);
    expect(validateGoalWeights([], 2.5).ok).toBe(false);
  });
});

describe("goal progress", () => {
  it("derives progress from values, clamped", () => {
    expect(progressFromValues(0, 200, 50)).toBe(25);
    expect(progressFromValues(100, 50, 75)).toBe(50); // decreasing targets
    expect(progressFromValues(0, 10, 15)).toBe(100);
    expect(progressFromValues(0, 10, -3)).toBe(0);
    expect(progressFromValues(null, null, 5)).toBeNull();
  });
  it("weights attainment and ignores cancelled goals", () => {
    expect(
      goalsAttainment([
        { weight: 60, progressPercent: 100, status: "achieved" },
        { weight: 40, progressPercent: 50, status: "active" },
        { weight: 50, progressPercent: 0, status: "cancelled" },
      ]),
    ).toBe(80);
    expect(goalsAttainment([{ weight: 0, progressPercent: 40, status: "active" }, { weight: 0, progressPercent: 60, status: "active" }])).toBe(50);
    expect(goalsAttainment([])).toBeNull();
  });
  it("maps attainment onto the scale", () => {
    expect(attainmentToRating(0, levels)).toBe(1);
    expect(attainmentToRating(100, levels)).toBe(5);
    expect(attainmentToRating(80, levels)).toBe(4.2);
  });
});

describe("overall rating", () => {
  const questions = [
    { id: "a", type: "rating" as const, forKinds: ["self", "manager"] },
    { id: "b", type: "competency" as const, forKinds: ["manager"] },
    { id: "c", type: "text" as const, forKinds: ["manager"] },
  ];
  it("blends question average with goals by weight", () => {
    const r = computeOverallRating({
      questions,
      responses: { a: { rating: 4 }, b: { rating: 3 }, c: { text: "ok" } },
      kind: "manager",
      levels,
      goals: [{ weight: 100, progressPercent: 100, status: "achieved" }],
      includeGoals: true,
      goalsWeightPercent: 50,
    });
    expect(r.questionAverage).toBe(3.5);
    expect(r.goalsRating).toBe(5);
    expect(r.overall).toBe(4.25);
  });
  it("uses only questions for the reviewer kind", () => {
    const r = computeOverallRating({ questions, responses: { a: { rating: 2 }, b: { rating: 5 } }, kind: "self", levels, goals: [], includeGoals: true, goalsWeightPercent: 50 });
    expect(r.questionAverage).toBe(2);
    expect(r.overall).toBe(2);
  });
  it("ignores goals when the template excludes them and rejects out-of-scale ratings", () => {
    const r = computeOverallRating({
      questions,
      responses: { a: { rating: 9 }, b: { rating: 4 } },
      kind: "manager",
      levels,
      goals: [{ weight: 100, progressPercent: 0, status: "missed" }],
      includeGoals: false,
      goalsWeightPercent: 50,
    });
    expect(r.overall).toBe(4);
    expect(r.goalsRating).toBeNull();
  });
  it("requires justification when overriding", () => {
    expect(overrideNeedsJustification(3.5, 3.5)).toBe(false);
    expect(overrideNeedsJustification(3.5, 4)).toBe(true);
    expect(overrideNeedsJustification(null, 4)).toBe(false);
    expect(nearestLevel(3.6, levels)).toBe(4);
  });
});

describe("learning helpers", () => {
  const quiz = {
    passMark: 70,
    questions: [
      { id: "1", prompt: "a", options: ["x", "y"], answer: 0 },
      { id: "2", prompt: "b", options: ["x", "y"], answer: 1 },
      { id: "3", prompt: "c", options: ["x", "y"], answer: 1 },
    ],
  };
  it("scores quizzes against the pass mark", () => {
    expect(scoreQuiz(quiz, { "1": 0, "2": 1, "3": 1 })).toEqual({ score: 100, correct: 3, total: 3, passed: true });
    expect(scoreQuiz(quiz, { "1": 0, "2": 1, "3": 0 })).toEqual({ score: 67, correct: 2, total: 3, passed: false });
  });
  it("adds months with month-end clamping", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-10-18", 12)).toBe("2027-10-18");
  });
  it("buckets overdue enrollments", () => {
    expect(learningBucket("assigned", "2026-10-01", "2026-10-18")).toBe("overdue");
    expect(learningBucket("completed", "2026-10-01", "2026-10-18")).toBe("completed");
    expect(learningBucket("in_progress", "2026-10-30", "2026-10-18")).toBe("in_progress");
  });
  it("matches assignment rules", () => {
    const e = { id: "e", departmentId: "d1", designationId: "x", joiningDate: "2026-10-10" };
    expect(matchesAssignment({ all: true }, e, "2026-01-01")).toBe(true);
    expect(matchesAssignment({ departmentIds: ["d2"] }, e, "2026-01-01")).toBe(false);
    expect(matchesAssignment({ departmentIds: ["d1"], designationIds: ["x"] }, e, "2026-01-01")).toBe(true);
    expect(matchesAssignment({ newJoiners: true }, e, "2026-10-11")).toBe(false);
    expect(matchesAssignment({ newJoiners: true }, e, "2026-10-01")).toBe(true);
    expect(matchesAssignment({}, e, "2026-01-01")).toBe(false);
  });
});

describe("feedback text fallbacks", () => {
  it("extracts strengths and concerns", () => {
    const s = extractiveSummary([
      "Asha is a strong communicator and delivered the payments migration on time.",
      "She needs to improve delegation. Planning could be more realistic, deadlines slipped twice.",
    ]);
    expect(s.strengths[0]).toMatch(/strong communicator/);
    expect(s.concerns.length).toBeGreaterThan(0);
    const topics = coachingTopicsFallback(s.concerns, ["Stakeholder management"]);
    expect(topics.map((t) => t.title)).toContain("Stakeholder management");
    expect(topics.length).toBeLessThanOrEqual(5);
  });
  it("handles empty input", () => {
    expect(extractiveSummary([]).strengths).toEqual([]);
  });
});
