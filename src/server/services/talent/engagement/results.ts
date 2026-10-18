import { and, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { authorize, type RequestContext } from "../../../auth/context";
import { surveyParticipants, surveyResponses, surveys } from "../../../db/schema";
import { runAi } from "../../../ai/run";
import { notFound, validation } from "../../../lib/errors";
import {
  TENURE_BAND_LABELS,
  aggregateSurvey,
  breakdown,
  keywordThemes,
  overallScaleAverage,
  enpsScore,
  releasableTexts,
  type BreakdownGroup,
  type ResponseLite,
  type SurveyAggregate,
} from "@/lib/talent/aggregation";
import { lookupLabels } from "../shared";

/**
 * Survey results are aggregated with small-group suppression (see
 * src/lib/talent/aggregation.ts). This module never returns individual
 * answers, never returns raw free text, and does not attempt to infer
 * wellbeing or health from responses.
 */

export type SurveyResults = {
  survey: { id: string; title: string; status: string; isAnonymous: boolean; minGroupSize: number; kind: string; closesOn: string | null };
  aggregate: SurveyAggregate;
  breakdowns: { department: BreakdownGroup[]; location: BreakdownGroup[]; tenure: BreakdownGroup[] };
};

async function loadResponses(ctx: RequestContext, surveyId: string) {
  return ctx.db(async (tx) => {
    const [s] = await tx.select().from(surveys).where(eq(surveys.id, surveyId));
    if (!s) throw notFound("Survey");
    const rows = await tx
      .select({ departmentId: surveyResponses.departmentId, locationId: surveyResponses.locationId, tenureBand: surveyResponses.tenureBand, answers: surveyResponses.answers })
      .from(surveyResponses)
      .where(eq(surveyResponses.surveyId, surveyId));
    const [{ total }] = await tx.select({ total: count() }).from(surveyParticipants).where(eq(surveyParticipants.surveyId, surveyId));
    const labels = await lookupLabels(tx);
    return { survey: s, responses: rows as ResponseLite[], participantCount: total, labels };
  });
}

export async function surveyResults(ctx: RequestContext, surveyId: string): Promise<SurveyResults> {
  authorize(ctx, "engagement.results", "all");
  const { survey: s, responses, participantCount, labels } = await loadResponses(ctx, surveyId);
  const aggregate = aggregateSurvey({ questions: s.questions, responses, minGroupSize: s.minGroupSize, participantCount });
  const common = { questions: s.questions, responses, minGroupSize: s.minGroupSize };
  return {
    survey: { id: s.id, title: s.title, status: s.status, isAnonymous: s.isAnonymous, minGroupSize: s.minGroupSize, kind: s.kind, closesOn: s.closesOn },
    aggregate,
    breakdowns: aggregate.suppressed
      ? { department: [], location: [], tenure: [] }
      : {
          department: breakdown({ ...common, by: "department", labels: labels.departments }),
          location: breakdown({ ...common, by: "location", labels: labels.locations }),
          tenure: breakdown({ ...common, by: "tenure", labels: TENURE_BAND_LABELS }),
        },
  };
}

const themeSchema = z.object({
  themes: z.array(z.object({ theme: z.string().max(80), summary: z.string().max(400), mentions: z.number().int().min(0).max(100000) })).max(8),
});

export type ThemeSummary = { source: "ai" | "rules"; note: string | null; answered: number; themes: { theme: string; summary: string; mentions: number }[] };

/**
 * Theme summary for one free-text question, only when the number of text
 * answers meets the survey's minimum group size. The AI sees the texts but is
 * told not to quote or identify anyone; the fallback is keyword frequency.
 */
export async function textThemeSummary(ctx: RequestContext, surveyId: string, questionId: string): Promise<ThemeSummary> {
  authorize(ctx, "engagement.results", "all");
  const { survey: s, responses } = await loadResponses(ctx, surveyId);
  const q = s.questions.find((x) => x.id === questionId && x.type === "text");
  if (!q) throw notFound("Question");
  const texts = releasableTexts(q.id, responses, s.minGroupSize);
  if (!texts) throw validation("Not enough responses to summarize this question without risking anyone's anonymity.");
  const fallback = () => ({
    themes: keywordThemes(texts, 6).map((t) => ({ theme: t.term, summary: `Mentioned in ${t.count} answer${t.count === 1 ? "" : "s"}.`, mentions: t.count })),
  });
  const out = await runAi(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    {
      agentKey: "people_success",
      task: "survey_text_themes",
      system:
        "Group the anonymous survey comments below into up to six themes. For each theme give a short name, a one-sentence neutral summary and the approximate number of comments that mention it. Never quote comments verbatim, never mention names, teams or details that could identify a respondent, and do not infer anyone's health, wellbeing or personal circumstances.",
      messages: [{ role: "user", content: `Question: ${q.label}\n\nComments:\n${texts.map((t) => `- ${t.replace(/\s+/g, " ")}`).join("\n")}` }],
      schema: themeSchema,
      fallback,
    },
  );
  return { source: out.source, note: out.source === "rules" ? out.reason : null, answered: texts.length, themes: out.data.themes };
}

/** Company-level trend across recent launched surveys (each point respects suppression). */
export async function engagementTrend(ctx: RequestContext, limit = 8) {
  authorize(ctx, "engagement.results", "all");
  return ctx.db(async (tx) => {
    const list = await tx
      .select()
      .from(surveys)
      .where(inArray(surveys.status, ["active", "closed"]))
      .orderBy(desc(surveys.opensOn), desc(surveys.createdAt))
      .limit(limit);
    if (!list.length) return [];
    const rows = await tx
      .select({ surveyId: surveyResponses.surveyId, departmentId: surveyResponses.departmentId, locationId: surveyResponses.locationId, tenureBand: surveyResponses.tenureBand, answers: surveyResponses.answers })
      .from(surveyResponses)
      .where(and(inArray(surveyResponses.surveyId, list.map((s) => s.id))));
    return list
      .map((s) => {
        const rs = rows.filter((r) => r.surveyId === s.id) as ResponseLite[];
        const suppressed = rs.length < Math.max(3, s.minGroupSize);
        const enpsQ = s.questions.find((q) => q.type === "enps");
        return {
          surveyId: s.id,
          title: s.title,
          date: s.opensOn ?? s.createdAt.toISOString().slice(0, 10),
          suppressed,
          average: suppressed ? null : overallScaleAverage(s.questions, rs),
          enps: suppressed || !enpsQ ? null : (enpsScore(rs.map((r) => Number(r.answers[enpsQ.id]))) ?.score ?? null),
        };
      })
      .reverse();
  });
}
