import { describe, expect, it } from "vitest";
import {
  aggregateSurvey,
  breakdown,
  driverAverages,
  enpsScore,
  keywordThemes,
  releasableTexts,
  scaleStats,
  tenureBand,
  type ResponseLite,
  type SurveyQuestionLite,
} from "@/lib/talent/aggregation";

const questions: SurveyQuestionLite[] = [
  { id: "q1", label: "I feel valued", type: "scale", driver: "Recognition" },
  { id: "q2", label: "I have the tools I need", type: "scale", driver: "Enablement" },
  { id: "q3", label: "Recommend us", type: "enps" },
  { id: "q4", label: "Preferred format", type: "choice", options: ["Remote", "Hybrid", "Office"] },
  { id: "q5", label: "Anything else?", type: "text" },
];

const resp = (dept: string | null, a: Record<string, string | number>, tenure = "1-3y"): ResponseLite => ({
  departmentId: dept,
  locationId: "loc-1",
  tenureBand: tenure,
  answers: a,
});

describe("tenure bands", () => {
  it("bands by completed months", () => {
    expect(tenureBand("2026-01-15", "2026-10-18")).toBe("<1y");
    expect(tenureBand("2025-10-19", "2026-10-18")).toBe("<1y");
    expect(tenureBand("2025-10-18", "2026-10-18")).toBe("1-3y");
    expect(tenureBand("2023-10-19", "2026-10-18")).toBe("1-3y");
    expect(tenureBand("2023-10-18", "2026-10-18")).toBe("3y+");
    expect(tenureBand("2010-01-01", "2026-10-18")).toBe("3y+");
  });
});

describe("eNPS", () => {
  it("is % promoters minus % detractors", () => {
    // 3 promoters, 2 passives, 5 detractors of 10 → 30 - 50 = -20
    const r = enpsScore([10, 9, 9, 8, 7, 6, 5, 0, 3, 6]);
    expect(r).toEqual({ score: -20, promoters: 3, passives: 2, detractors: 5, count: 10 });
  });
  it("ignores out-of-range values and returns null when empty", () => {
    expect(enpsScore([])).toBeNull();
    expect(enpsScore([11, -1, 4.5])).toBeNull();
    expect(enpsScore([10, 10, 11])?.score).toBe(100);
  });
});

describe("scale stats and drivers", () => {
  it("computes average, favourable share and distribution", () => {
    const s = scaleStats([5, 4, 3, 2, 1, 4]);
    expect(s?.average).toBe(3.17);
    expect(s?.favorablePercent).toBe(50);
    expect(s?.distribution).toEqual({ 1: 1, 2: 1, 3: 1, 4: 2, 5: 1 });
  });
  it("averages per driver", () => {
    const d = driverAverages(questions, [resp("d1", { q1: 5, q2: 3 }), resp("d1", { q1: 3, q2: 1 })]);
    expect(d).toEqual([
      { driver: "Enablement", average: 2, count: 2 },
      { driver: "Recognition", average: 4, count: 2 },
    ]);
  });
});

describe("suppression", () => {
  const five = Array.from({ length: 5 }, (_, i) => resp("eng", { q1: 4, q2: 5, q3: i < 3 ? 10 : 5, q4: "Hybrid", q5: "Great team culture and growth" }));
  const two = [resp("ops", { q1: 1, q2: 1, q3: 0, q4: "Office", q5: "Manager is unclear" }), resp("ops", { q1: 2, q2: 2, q3: 1 })];

  it("suppresses the whole survey below the threshold", () => {
    const agg = aggregateSurvey({ questions, responses: two, minGroupSize: 5, participantCount: 10 });
    expect(agg.suppressed).toBe(true);
    expect(agg.questions).toEqual([]);
    expect(agg.enps).toBeNull();
    expect(agg.overallAverage).toBeNull();
    expect(agg.responseRate).toBe(0.2);
  });

  it("never lowers the threshold below 3", () => {
    const agg = aggregateSurvey({ questions, responses: two, minGroupSize: 1, participantCount: 2 });
    expect(agg.suppressed).toBe(true);
    expect(agg.minGroupSize).toBe(3);
  });

  it("aggregates when the threshold is met, without raw text", () => {
    const agg = aggregateSurvey({ questions, responses: [...five, ...two], minGroupSize: 5, participantCount: 10 });
    expect(agg.suppressed).toBe(false);
    expect(agg.responseCount).toBe(7);
    expect(agg.enps?.score).toBe(Math.round(((3 - 4) / 7) * 100));
    const text = agg.questions.find((q) => q.id === "q5");
    expect(text?.type).toBe("text");
    expect(JSON.stringify(text)).not.toContain("Manager is unclear");
    const choice = agg.questions.find((q) => q.id === "q4");
    expect(choice && choice.type === "choice" ? choice.counts : []).toEqual([
      { option: "Remote", count: 0 },
      { option: "Hybrid", count: 5 },
      { option: "Office", count: 1 },
    ]);
  });

  it("suppresses small groups in breakdowns and hides their counts", () => {
    const groups = breakdown({ questions, responses: [...five, ...two], minGroupSize: 5, by: "department", labels: { eng: "Engineering", ops: "Operations" } });
    const eng = groups.find((g) => g.key === "eng")!;
    const ops = groups.find((g) => g.key === "ops")!;
    expect(eng.suppressed).toBe(false);
    expect(eng.suppressed === false && eng.count).toBe(5);
    expect(eng.suppressed === false && eng.overallAverage).toBe(4.5);
    expect(ops).toEqual({ key: "ops", label: "Operations", suppressed: true });
  });

  it("breaks down by tenure band", () => {
    const rs = [...Array.from({ length: 3 }, () => resp(null, { q1: 5 }, "<1y")), ...Array.from({ length: 4 }, () => resp(null, { q1: 3 }, "3y+"))];
    const groups = breakdown({ questions, responses: rs, minGroupSize: 4, by: "tenure", labels: {} });
    expect(groups.find((g) => g.key === "<1y")?.suppressed).toBe(true);
    const senior = groups.find((g) => g.key === "3y+");
    expect(senior?.suppressed === false && senior.overallAverage).toBe(3);
  });

  it("releases text only for groups that meet the threshold", () => {
    expect(releasableTexts("q5", two, 3)).toBeNull();
    expect(releasableTexts("q5", five, 5)).toHaveLength(5);
  });

  it("finds keyword themes", () => {
    const themes = keywordThemes(["Great culture and growth", "Growth paths are unclear", "Culture of growth"]);
    expect(themes[0]).toEqual({ term: "growth", count: 3 });
    expect(themes.some((t) => t.term === "culture")).toBe(true);
  });
});
