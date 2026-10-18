/**
 * Deterministic text helpers used when AI is unavailable. They summarize
 * what reviewers wrote; they never score people or infer anything about
 * health or personal circumstances.
 */

const STRENGTH_CUES = [
  "strong",
  "great",
  "excellent",
  "good",
  "well",
  "reliable",
  "proactive",
  "helpful",
  "clear",
  "ownership",
  "consistent",
  "delivered",
  "improved",
  "collaborat",
  "mentor",
  "creative",
  "thorough",
  "quick",
  "supportive",
];

const CONCERN_CUES = [
  "improve",
  "needs",
  "need to",
  "should",
  "could",
  "lack",
  "missed",
  "delay",
  "late",
  "struggle",
  "inconsistent",
  "unclear",
  "more focus",
  "work on",
  "develop",
  "challenge",
  "slow",
  "gap",
];

export function splitSentences(texts: string[]): string[] {
  return texts
    .flatMap((t) => t.split(/(?<=[.!?])\s+|\n+/))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 8);
}

const hasCue = (s: string, cues: string[]) => {
  const l = s.toLowerCase();
  return cues.some((c) => l.includes(c));
};

const WORD_STOP = new Set(
  "the and for with that this from have has was were are but not you your they them their his her its our more also very into over will would should could about been being just than then there here when what which while".split(" "),
);

/** Frequency of meaningful words across sentences (each counted once per sentence). */
function termFrequency(sentences: string[]) {
  const freq = new Map<string, number>();
  for (const s of sentences) {
    const words = new Set(
      s
        .toLowerCase()
        .replace(/[^a-z\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3 && !WORD_STOP.has(w)),
    );
    for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return freq;
}

/** Rank sentences by how many frequent terms they share with the rest. */
function rankSentences(sentences: string[], limit: number) {
  const freq = termFrequency(sentences);
  const scored = sentences.map((s, i) => {
    const words = new Set(s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/));
    let score = 0;
    for (const w of words) score += (freq.get(w) ?? 0) > 1 ? freq.get(w)! : 0;
    return { s, i, score };
  });
  const seen = new Set<string>();
  return scored
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .filter((x) => {
      const key = x.s.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((x) => (x.s.length > 220 ? `${x.s.slice(0, 217)}...` : x.s));
}

export type FeedbackSummary = { summary: string; strengths: string[]; concerns: string[] };

/** Extractive summary: the most representative strength and concern sentences. */
export function extractiveSummary(texts: string[]): FeedbackSummary {
  const sentences = splitSentences(texts);
  if (!sentences.length) return { summary: "No written feedback to summarize yet.", strengths: [], concerns: [] };
  const concernsAll = sentences.filter((s) => hasCue(s, CONCERN_CUES));
  const strengthsAll = sentences.filter((s) => !concernsAll.includes(s) && hasCue(s, STRENGTH_CUES));
  const strengths = rankSentences(strengthsAll, 3);
  const concerns = rankSentences(concernsAll, 3);
  const top = [...termFrequency(sentences).entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([w]) => w);
  const summary =
    `${sentences.length} feedback statement${sentences.length === 1 ? "" : "s"}` +
    (top.length ? `; recurring themes: ${top.join(", ")}.` : ".") +
    ` ${strengths.length} highlight${strengths.length === 1 ? "" : "s"} and ${concerns.length} development point${concerns.length === 1 ? "" : "s"} identified.`;
  return { summary, strengths, concerns };
}

export type CoachingTopic = { title: string; why: string };

const TOPIC_RULES: { match: RegExp; title: string }[] = [
  { match: /communicat|unclear|update|stakeholder/i, title: "Clear and timely communication" },
  { match: /deadline|late|delay|missed|time/i, title: "Planning and time management" },
  { match: /prioriti|focus/i, title: "Prioritization" },
  { match: /ownership|initiative|proactive/i, title: "Ownership and initiative" },
  { match: /collaborat|team|cross/i, title: "Cross-team collaboration" },
  { match: /delegat|mentor|coach|lead/i, title: "Delegation and coaching others" },
  { match: /quality|detail|bug|error|thorough/i, title: "Quality and attention to detail" },
  { match: /technical|skill|learn|knowledge/i, title: "Building technical depth" },
  { match: /feedback/i, title: "Giving and receiving feedback" },
];

/** Rule-based coaching topics from development points and low-rated areas. */
export function coachingTopicsFallback(concerns: string[], lowRatedAreas: string[]): CoachingTopic[] {
  const topics: CoachingTopic[] = [];
  const add = (title: string, why: string) => {
    if (!topics.some((t) => t.title === title)) topics.push({ title, why });
  };
  for (const c of concerns) {
    const rule = TOPIC_RULES.find((r) => r.match.test(c));
    if (rule) add(rule.title, `Mentioned in feedback: "${c.length > 120 ? `${c.slice(0, 117)}...` : c}"`);
  }
  for (const area of lowRatedAreas) add(area, "Rated below the midpoint of the scale in this review.");
  return topics.slice(0, 5);
}
