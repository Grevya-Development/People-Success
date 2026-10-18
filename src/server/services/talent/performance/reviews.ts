import { and, desc, eq, inArray, isNotNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import { can, canAccessEmployee, getTeamEmployeeIds, scopeOf, type RequestContext } from "../../../auth/context";
import type { Tx } from "../../../db/client";
import { withSystem } from "../../../db/tx";
import { competencies, ratingScales, reviewCycles, reviewTemplates, reviews } from "../../../db/schema";
import type { ReviewQuestion } from "../../../db/schema/talent";
import { runAi } from "../../../ai/run";
import { audit } from "../../../lib/audit";
import { forbidden, invalidState, notFound, validation } from "../../../lib/errors";
import { notify } from "../../notifications";
import { computeOverallRating, overrideNeedsJustification, scaleBounds, type RatingLevelLite, type RatingSuggestion } from "@/lib/talent/ratings";
import { coachingTopicsFallback, extractiveSummary, type CoachingTopic, type FeedbackSummary } from "@/lib/talent/text";
import type { saveReviewSchema } from "@/lib/validation/talent";
import { employeeBasics, requireEmployeeId } from "../shared";
import { assertCycleWritable } from "./cycles";
import { goalsForReview } from "./goals";

type ReviewRow = typeof reviews.$inferSelect;
type CycleRow = typeof reviewCycles.$inferSelect;

/** Reserved response keys that hold manager metadata rather than answers. */
const OVERALL_KEY = "_overall";
const DEVELOPMENT_KEY = "_development";

const DONE = ["submitted", "shared", "acknowledged"] as const;
const isDone = (status: string) => (DONE as readonly string[]).includes(status);

export type ReviewAccess = {
  isHr: boolean;
  isReviewer: boolean;
  isSubject: boolean;
  /** Manager chain over the reviewee (performance.view team/all). */
  isChain: boolean;
};

/**
 * Service-level visibility on top of RLS:
 * - HR (performance.manage) sees every review.
 * - The reviewer sees what they wrote.
 * - The reviewee sees their manager review only once it is shared; never
 *   peer reviews or individual upward feedback.
 * - The reporting line sees self reviews only after the employee submits,
 *   and manager reviews.
 */
async function accessFor(ctx: RequestContext, r: ReviewRow): Promise<ReviewAccess & { visible: boolean }> {
  const isHr = can(ctx, "performance.manage", "all");
  const isReviewer = !!ctx.employeeId && r.reviewerEmployeeId === ctx.employeeId;
  const isSubject = !!ctx.employeeId && r.employeeId === ctx.employeeId;
  const isChain = !isSubject && (r.kind === "self" || r.kind === "manager") && (await canAccessEmployee(ctx, "performance.view", r.employeeId));
  const visible =
    isHr ||
    isReviewer ||
    (isSubject && r.kind === "manager" && (r.status === "shared" || r.status === "acknowledged")) ||
    (isChain && (r.kind === "manager" || isDone(r.status)));
  return { isHr, isReviewer, isSubject, isChain, visible };
}

async function loadContext(tx: Tx, r: ReviewRow) {
  const [cycle] = await tx.select().from(reviewCycles).where(eq(reviewCycles.id, r.cycleId));
  if (!cycle) throw notFound("Review cycle");
  const [[tpl], [scale]] = await Promise.all([
    tx.select().from(reviewTemplates).where(eq(reviewTemplates.id, cycle.templateId)),
    tx.select().from(ratingScales).where(eq(ratingScales.id, cycle.ratingScaleId)),
  ]);
  if (!tpl || !scale) throw notFound("Review template");
  return { cycle, template: tpl, levels: scale.levels as RatingLevelLite[] };
}

const questionsFor = (questions: ReviewQuestion[], kind: string) => questions.filter((q) => q.forKinds.includes(kind as ReviewQuestion["forKinds"][number]));

const dueOnFor = (c: CycleRow, kind: string) => (kind === "self" ? c.selfDueOn : kind === "manager" ? c.managerDueOn : c.peerDueOn);

function answersOnly(responses: ReviewRow["responses"]) {
  return Object.fromEntries(Object.entries(responses).filter(([k]) => !k.startsWith("_")));
}

async function suggestionFor(tx: Tx, r: Pick<ReviewRow, "employeeId" | "cycleId" | "kind">, responses: ReviewRow["responses"], ctxData: Awaited<ReturnType<typeof loadContext>>) {
  const goals = ctxData.template.includeGoals && (r.kind === "manager" || r.kind === "self") ? await goalsForReview(tx, r.employeeId, r.cycleId) : [];
  const suggestion = computeOverallRating({
    questions: ctxData.template.questions,
    responses,
    kind: r.kind,
    levels: ctxData.levels,
    goals,
    includeGoals: ctxData.template.includeGoals && (r.kind === "manager" || r.kind === "self"),
    goalsWeightPercent: ctxData.template.goalsWeightPercent,
  });
  return { goals, suggestion };
}

export type ReviewDetail = {
  id: string;
  kind: ReviewRow["kind"];
  status: ReviewRow["status"];
  responses: Record<string, { rating?: number; text?: string }>;
  overallRating: number | null;
  finalRating: number | null;
  calibratedRating: number | null;
  calibrationNote: string | null;
  overrideJustification: string | null;
  developmentAreas: string | null;
  submittedAt: string | null;
  sharedAt: string | null;
  acknowledgedAt: string | null;
  cycle: { id: string; name: string; status: CycleRow["status"]; dueOn: string | null; periodStart: string; periodEnd: string };
  employee: { id: string; name: string };
  reviewer: { id: string; name: string } | null;
  questions: ReviewQuestion[];
  competencyNames: Record<string, string>;
  levels: RatingLevelLite[];
  includeGoals: boolean;
  goalsWeightPercent: number;
  goals: Awaited<ReturnType<typeof goalsForReview>>;
  suggestion: RatingSuggestion | null;
  selfReview: { status: string; responses: Record<string, { rating?: number; text?: string }>; overallRating: number | null; submittedAt: string | null; questions: ReviewQuestion[] } | null;
  access: ReviewAccess & { canEdit: boolean; canAcknowledge: boolean; canAssist: boolean; canUpdateDevelopmentPlan: boolean };
};

export async function getReview(ctx: RequestContext, reviewId: string): Promise<ReviewDetail> {
  return ctx.db(async (tx) => {
    const [r] = await tx.select().from(reviews).where(eq(reviews.id, reviewId));
    if (!r) throw notFound("Review");
    const access = await accessFor(ctx, r);
    if (!access.visible) throw notFound("Review");
    const data = await loadContext(tx, r);
    const people = await employeeBasics(tx, [r.employeeId, r.reviewerEmployeeId]);
    const questions = questionsFor(data.template.questions, r.kind);
    const showScoring = r.kind === "manager" || r.kind === "self";
    const { goals, suggestion } = showScoring ? await suggestionFor(tx, r, r.responses, data) : { goals: [], suggestion: null };

    let selfReview: ReviewDetail["selfReview"] = null;
    if (r.kind === "manager" && !access.isSubject) {
      const [self] = await tx
        .select()
        .from(reviews)
        .where(and(eq(reviews.cycleId, r.cycleId), eq(reviews.employeeId, r.employeeId), eq(reviews.kind, "self")));
      // The manager sees the self review only after the employee submits it.
      if (self && isDone(self.status)) {
        selfReview = {
          status: self.status,
          responses: answersOnly(self.responses),
          overallRating: self.overallRating,
          submittedAt: self.submittedAt?.toISOString() ?? null,
          questions: questionsFor(data.template.questions, "self"),
        };
      }
    }
    const compIds = questions.map((q) => q.competencyId).filter((x): x is string => !!x);
    const comps = compIds.length ? await tx.select({ id: competencies.id, name: competencies.name }).from(competencies).where(inArray(competencies.id, compIds)) : [];
    const writable = r.status === "not_started" || r.status === "in_progress";
    const cycleOk = data.cycle.status === "active" || (data.cycle.status === "calibration" && r.kind === "manager");
    const hideFromSubject = access.isSubject && !access.isReviewer;
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      responses: answersOnly(r.responses),
      overallRating: r.overallRating,
      finalRating: r.calibratedRating ?? r.overallRating,
      calibratedRating: access.isHr ? r.calibratedRating : null,
      calibrationNote: access.isHr ? r.calibrationNote : null,
      overrideJustification: hideFromSubject ? null : (r.responses[OVERALL_KEY]?.text ?? null),
      developmentAreas: r.responses[DEVELOPMENT_KEY]?.text ?? null,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      sharedAt: r.sharedAt?.toISOString() ?? null,
      acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
      cycle: { id: data.cycle.id, name: data.cycle.name, status: data.cycle.status, dueOn: dueOnFor(data.cycle, r.kind), periodStart: data.cycle.periodStart, periodEnd: data.cycle.periodEnd },
      employee: { id: r.employeeId, name: people.get(r.employeeId)?.name ?? "Unknown" },
      // Upward feedback is confidential: only the author and HR know who wrote it.
      reviewer: r.kind === "upward" && !access.isReviewer && !access.isHr ? null : { id: r.reviewerEmployeeId, name: people.get(r.reviewerEmployeeId)?.name ?? "Unknown" },
      questions,
      competencyNames: Object.fromEntries(comps.map((c) => [c.id, c.name])),
      levels: data.levels,
      includeGoals: data.template.includeGoals && showScoring,
      goalsWeightPercent: data.template.goalsWeightPercent,
      goals,
      suggestion: hideFromSubject ? null : suggestion,
      selfReview,
      access: {
        isHr: access.isHr,
        isReviewer: access.isReviewer,
        isSubject: access.isSubject,
        isChain: access.isChain,
        canEdit: access.isReviewer && writable && cycleOk,
        canAcknowledge: access.isSubject && r.kind === "manager" && r.status === "shared",
        canAssist: r.kind === "manager" && (access.isHr || access.isReviewer || access.isChain) && !hideFromSubject,
        canUpdateDevelopmentPlan:
          r.kind === "manager" && data.cycle.status === "closed" && (r.status === "shared" || r.status === "acknowledged") && (access.isHr || access.isReviewer || access.isChain || access.isSubject),
      },
    };
  });
}

/** Clean responses against the template, enforcing the scale and required answers on submit. */
function cleanResponses(questions: ReviewQuestion[], levels: RatingLevelLite[], raw: Record<string, { rating?: number; text?: string }>, submit: boolean) {
  const { min, max } = scaleBounds(levels);
  const out: Record<string, { rating?: number; text?: string }> = {};
  const errors: Record<string, string[]> = {};
  for (const q of questions) {
    const a = raw[q.id] ?? {};
    if (q.type === "text") {
      const text = (a.text ?? "").trim();
      if (text) out[q.id] = { text };
      else if (submit && q.required) errors[`responses.${q.id}`] = ["Please answer this question"];
    } else {
      const rating = a.rating;
      if (rating != null) {
        if (!Number.isInteger(rating) || rating < min || rating > max) errors[`responses.${q.id}`] = [`Choose a rating from ${min} to ${max}`];
        else out[q.id] = { rating, ...(a.text?.trim() ? { text: a.text.trim() } : {}) };
      } else if (submit && q.required) errors[`responses.${q.id}`] = ["Choose a rating"];
    }
  }
  if (Object.keys(errors).length) throw validation(submit ? "Answer the required questions before submitting." : "Some answers are not valid.", errors);
  return out;
}

export async function saveReview(ctx: RequestContext, input: z.output<typeof saveReviewSchema>) {
  const me = requireEmployeeId(ctx);
  return ctx.db(async (tx) => {
    const [r] = await tx.select().from(reviews).where(eq(reviews.id, input.reviewId)).for("update");
    if (!r) throw notFound("Review");
    if (r.reviewerEmployeeId !== me) throw forbidden("Only the reviewer can edit this review.");
    if (isDone(r.status)) throw invalidState("This review has already been submitted.");
    const data = await loadContext(tx, r);
    await assertCycleWritable(data.cycle, r.kind);
    const answers = cleanResponses(questionsFor(data.template.questions, r.kind), data.levels, input.responses, input.submit);
    const { suggestion } = await suggestionFor(tx, r, answers, data);
    let overallRating = suggestion.overall;
    const responses: ReviewRow["responses"] = { ...answers };
    if (r.kind === "manager") {
      const chosen = input.overallRating ?? suggestion.overall;
      const { min, max } = scaleBounds(data.levels);
      if (chosen != null && (chosen < min || chosen > max)) throw validation("The overall rating is outside the scale.", { overallRating: ["Out of range"] });
      if (input.submit && chosen == null) throw validation("Choose an overall rating.", { overallRating: ["Choose a rating"] });
      if (input.submit && overrideNeedsJustification(suggestion.overall, chosen) && !input.overrideJustification) {
        throw validation("Explain why the overall rating differs from the suggestion.", { overrideJustification: ["Add a justification"] });
      }
      overallRating = chosen;
      responses[OVERALL_KEY] = { ...(suggestion.overall != null ? { rating: suggestion.overall } : {}), ...(input.overrideJustification ? { text: input.overrideJustification } : {}) };
      if (input.developmentAreas) responses[DEVELOPMENT_KEY] = { text: input.developmentAreas };
    }
    const status = input.submit ? "submitted" : "in_progress";
    await tx
      .update(reviews)
      .set({ responses, overallRating, status, submittedAt: input.submit ? new Date() : null })
      .where(eq(reviews.id, r.id));
    // Review content is confidential: the audit trail records the transition, not the answers.
    await audit(tx, ctx, {
      action: input.submit ? "review.submitted" : "review.saved",
      entityType: "review",
      entityId: r.id,
      metadata: { kind: r.kind, cycleId: r.cycleId, employeeId: r.employeeId, overridden: r.kind === "manager" && overrideNeedsJustification(suggestion.overall, overallRating) },
    });
    if (input.submit && r.kind === "self") {
      const [mgrReview] = await tx
        .select({ id: reviews.id, reviewer: reviews.reviewerEmployeeId })
        .from(reviews)
        .where(and(eq(reviews.cycleId, r.cycleId), eq(reviews.employeeId, r.employeeId), eq(reviews.kind, "manager")));
      if (mgrReview) {
        const people = await employeeBasics(tx, [mgrReview.reviewer, r.employeeId]);
        const userId = people.get(mgrReview.reviewer)?.userId;
        if (userId) {
          await notify(tx, {
            tenantId: ctx.tenantId,
            userIds: [userId],
            category: "performance",
            title: `${people.get(r.employeeId)?.name ?? "A report"} submitted their self review`,
            body: data.cycle.name,
            href: `/performance/reviews/${mgrReview.id}`,
            dedupeKey: `self-submitted:${r.id}`,
          });
        }
      }
    }
    return { id: r.id, status, overallRating, suggestion: suggestion.overall };
  });
}

export async function acknowledgeReview(ctx: RequestContext, reviewId: string) {
  const me = requireEmployeeId(ctx);
  return ctx.db(async (tx) => {
    const [r] = await tx.select().from(reviews).where(eq(reviews.id, reviewId)).for("update");
    if (!r || r.employeeId !== me || r.kind !== "manager") throw notFound("Review");
    if (r.status !== "shared") throw invalidState(r.status === "acknowledged" ? "You have already acknowledged this review." : "This review has not been shared with you yet.");
    await tx.update(reviews).set({ status: "acknowledged", acknowledgedAt: new Date() }).where(eq(reviews.id, r.id));
    await audit(tx, ctx, { action: "review.acknowledged", entityType: "review", entityId: r.id, metadata: { cycleId: r.cycleId } });
    const people = await employeeBasics(tx, [r.reviewerEmployeeId, r.employeeId]);
    const userId = people.get(r.reviewerEmployeeId)?.userId;
    if (userId) {
      await notify(tx, {
        tenantId: ctx.tenantId,
        userIds: [userId],
        category: "performance",
        title: `${people.get(r.employeeId)?.name ?? "Your report"} acknowledged their review`,
        href: `/performance/reviews/${r.id}`,
        dedupeKey: `review-ack:${r.id}`,
      });
    }
    return { status: "acknowledged" as const };
  });
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

export type ReviewListItem = {
  id: string;
  kind: ReviewRow["kind"];
  status: ReviewRow["status"];
  cycleId: string;
  cycleName: string;
  cycleStatus: CycleRow["status"];
  dueOn: string | null;
  employeeId: string;
  employeeName: string;
  reviewerName: string | null;
  finalRating: number | null;
};

async function toItems(tx: Tx, rows: ReviewRow[], opts: { hideRating?: (r: ReviewRow) => boolean } = {}): Promise<ReviewListItem[]> {
  if (!rows.length) return [];
  const cycleIds = [...new Set(rows.map((r) => r.cycleId))];
  const cycles = await tx.select().from(reviewCycles).where(inArray(reviewCycles.id, cycleIds));
  const cycleMap = new Map(cycles.map((c) => [c.id, c]));
  const people = await employeeBasics(tx, [...rows.map((r) => r.employeeId), ...rows.map((r) => r.reviewerEmployeeId)]);
  return rows.map((r) => {
    const c = cycleMap.get(r.cycleId)!;
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      cycleId: r.cycleId,
      cycleName: c.name,
      cycleStatus: c.status,
      dueOn: dueOnFor(c, r.kind),
      employeeId: r.employeeId,
      employeeName: people.get(r.employeeId)?.name ?? "Unknown",
      reviewerName: people.get(r.reviewerEmployeeId)?.name ?? null,
      finalRating: opts.hideRating?.(r) ? null : (r.calibratedRating ?? r.overallRating),
    };
  });
}

/** Reviews I write, plus reviews about me that I may read. */
export async function listMyReviews(ctx: RequestContext) {
  if (!ctx.employeeId) return { toWrite: [], aboutMe: [] };
  const me = ctx.employeeId;
  return ctx.db(async (tx) => {
    const rows = await tx
      .select()
      .from(reviews)
      .where(
        or(
          eq(reviews.reviewerEmployeeId, me),
          and(eq(reviews.employeeId, me), eq(reviews.kind, "manager"), inArray(reviews.status, ["shared", "acknowledged"])),
        ),
      )
      .orderBy(desc(reviews.createdAt))
      .limit(300);
    const items = await toItems(tx, rows);
    return {
      toWrite: items.filter((i) => rows.find((r) => r.id === i.id)!.reviewerEmployeeId === me),
      aboutMe: items.filter((i) => i.employeeId === me && i.kind === "manager"),
    };
  });
}

export type TeamReviewRow = {
  employeeId: string;
  employeeName: string;
  cycleId: string;
  cycleName: string;
  cycleStatus: CycleRow["status"];
  includePeers: boolean;
  selfStatus: string | null;
  managerReviewId: string | null;
  managerStatus: string | null;
  iAmReviewer: boolean;
  finalRating: number | null;
};

/** Team tab: my reports' self/manager review status per cycle. */
export async function listTeamReviews(ctx: RequestContext): Promise<TeamReviewRow[]> {
  const viewScope = scopeOf(ctx, "performance.view");
  if (viewScope !== "team" && viewScope !== "all") return [];
  const team = await getTeamEmployeeIds(ctx);
  if (!team.length) return [];
  return ctx.db(async (tx) => {
    const rows = await tx
      .select()
      .from(reviews)
      .where(and(inArray(reviews.employeeId, team), inArray(reviews.kind, ["self", "manager"])))
      .orderBy(desc(reviews.createdAt))
      .limit(2000);
    const cycles = rows.length ? await tx.select().from(reviewCycles).where(inArray(reviewCycles.id, [...new Set(rows.map((r) => r.cycleId))])) : [];
    const cycleMap = new Map(cycles.map((c) => [c.id, c]));
    const people = await employeeBasics(tx, team);
    const keys = new Map<string, TeamReviewRow>();
    for (const r of rows) {
      const c = cycleMap.get(r.cycleId)!;
      const key = `${r.cycleId}:${r.employeeId}`;
      const row =
        keys.get(key) ??
        ({
          employeeId: r.employeeId,
          employeeName: people.get(r.employeeId)?.name ?? "Unknown",
          cycleId: r.cycleId,
          cycleName: c.name,
          cycleStatus: c.status,
          includePeers: c.includePeers,
          selfStatus: null,
          managerReviewId: null,
          managerStatus: null,
          iAmReviewer: false,
          finalRating: null,
        } satisfies TeamReviewRow);
      if (r.kind === "self") row.selfStatus = r.status;
      else {
        row.managerReviewId = r.id;
        row.managerStatus = r.status;
        row.iAmReviewer = r.reviewerEmployeeId === ctx.employeeId;
        row.finalRating = r.calibratedRating ?? r.overallRating;
      }
      keys.set(key, row);
    }
    return [...keys.values()].sort((a, b) => (a.cycleStatus === "closed" ? 1 : 0) - (b.cycleStatus === "closed" ? 1 : 0) || a.employeeName.localeCompare(b.employeeName));
  });
}

/* ------------------------------------------------------------------ */
/* Upward feedback (anonymized aggregate)                              */
/* ------------------------------------------------------------------ */

export const UPWARD_MIN_RESPONSES = 3;

export type UpwardSummary = {
  cycleId: string;
  cycleName: string;
  responses: number;
  suppressed: boolean;
  questions: { id: string; label: string; average: number }[];
};

/**
 * Upward feedback for the signed-in manager, aggregated per closed cycle.
 * Individual upward reviews are invisible to the manager under RLS, so the
 * aggregate is computed in system context for ctx.employeeId only, and is
 * released only with at least 3 responses and after the cycle closes (so the
 * manager cannot watch counts change while reports respond). Text answers are
 * never returned.
 */
export async function myUpwardSummary(ctx: RequestContext): Promise<UpwardSummary[]> {
  if (!ctx.employeeId) return [];
  const me = ctx.employeeId;
  return withSystem(async (tx) => {
    const rows = await tx
      .select({ cycleId: reviews.cycleId, responses: reviews.responses })
      .from(reviews)
      .innerJoin(reviewCycles, eq(reviewCycles.id, reviews.cycleId))
      .where(
        and(
          eq(reviews.tenantId, ctx.tenantId),
          eq(reviews.employeeId, me),
          eq(reviews.kind, "upward"),
          ne(reviews.reviewerEmployeeId, me),
          inArray(reviews.status, ["submitted", "shared", "acknowledged"]),
          eq(reviewCycles.status, "closed"),
          isNotNull(reviews.submittedAt),
        ),
      );
    if (!rows.length) return [];
    const cycleIds = [...new Set(rows.map((r) => r.cycleId))];
    const cycles = await tx
      .select({ id: reviewCycles.id, name: reviewCycles.name, questions: reviewTemplates.questions })
      .from(reviewCycles)
      .innerJoin(reviewTemplates, eq(reviewTemplates.id, reviewCycles.templateId))
      .where(and(eq(reviewCycles.tenantId, ctx.tenantId), inArray(reviewCycles.id, cycleIds)));
    return cycles.map((c) => {
      const list = rows.filter((r) => r.cycleId === c.id);
      const suppressed = list.length < UPWARD_MIN_RESPONSES;
      const qs = questionsFor(c.questions, "upward").filter((q) => q.type !== "text");
      return {
        cycleId: c.id,
        cycleName: c.name,
        responses: suppressed ? 0 : list.length,
        suppressed,
        questions: suppressed
          ? []
          : qs
              .map((q) => {
                const values = list.map((r) => r.responses[q.id]?.rating).filter((v): v is number => typeof v === "number");
                return { id: q.id, label: q.label, average: values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : 0, n: values.length };
              })
              .filter((q) => q.n >= UPWARD_MIN_RESPONSES)
              .map(({ id, label, average }) => ({ id, label, average })),
      };
    });
  }, ctx.tenantId);
}

/* ------------------------------------------------------------------ */
/* AI assistance (advisory only)                                       */
/* ------------------------------------------------------------------ */

const summarySchema = z.object({
  summary: z.string().max(1500),
  strengths: z.array(z.string().max(300)).max(5),
  concerns: z.array(z.string().max(300)).max(5),
});

const coachingSchema = z.object({ topics: z.array(z.object({ title: z.string().max(120), why: z.string().max(400) })).max(5) });

export type AssistResult<T> = { source: "ai" | "rules"; note: string | null; data: T };

/** Written feedback the caller may read about this review's employee in the same cycle (text only). */
async function feedbackTexts(ctx: RequestContext, reviewId: string) {
  return ctx.db(async (tx) => {
    const [r] = await tx.select().from(reviews).where(eq(reviews.id, reviewId));
    if (!r) throw notFound("Review");
    const access = await accessFor(ctx, r);
    if (!access.visible || r.kind !== "manager" || (access.isSubject && !access.isReviewer && !access.isHr)) throw forbidden();
    const data = await loadContext(tx, r);
    const related = await tx
      .select()
      .from(reviews)
      .where(and(eq(reviews.cycleId, r.cycleId), eq(reviews.employeeId, r.employeeId), inArray(reviews.kind, ["self", "manager", "peer"])));
    const texts: string[] = [];
    const lowRated: string[] = [];
    const { min, max } = scaleBounds(data.levels);
    const mid = (min + max) / 2;
    for (const rv of related) {
      if (rv.id !== r.id && !isDone(rv.status)) continue; // unsubmitted drafts of others stay private
      if (rv.kind === "peer" && !access.isHr && rv.reviewerEmployeeId !== ctx.employeeId) continue;
      const qs = questionsFor(data.template.questions, rv.kind);
      for (const q of qs) {
        const a = rv.responses[q.id];
        if (a?.text) texts.push(a.text);
        if (rv.kind === "manager" && a?.rating != null && a.rating < mid) lowRated.push(q.label);
      }
      if (rv.kind === "manager" && rv.responses[DEVELOPMENT_KEY]?.text) texts.push(rv.responses[DEVELOPMENT_KEY].text!);
    }
    return { texts, lowRated: [...new Set(lowRated)] };
  });
}

const AI_RULES =
  "The text below is written performance feedback about one employee. Work only from this text. Do not invent facts, do not produce or suggest ratings, do not speculate about health, family or other personal circumstances, and do not use protected characteristics. Your output is advisory and will be reviewed by a human.";

export async function summarizeReviewFeedback(ctx: RequestContext, reviewId: string): Promise<AssistResult<FeedbackSummary>> {
  const { texts } = await feedbackTexts(ctx, reviewId);
  if (!texts.length) return { source: "rules", note: "There is no written feedback to summarize yet.", data: extractiveSummary([]) };
  const out = await runAi(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    {
      agentKey: "hr_operations",
      task: "summarize_review_feedback",
      system: `${AI_RULES} Summarize the themes in two to four sentences, then list up to five strengths and up to five development points, each as a short phrase.`,
      messages: [{ role: "user", content: texts.map((t, i) => `Feedback ${i + 1}:\n${t}`).join("\n\n") }],
      schema: summarySchema,
      fallback: () => extractiveSummary(texts),
    },
  );
  return { source: out.source, note: out.source === "rules" ? out.reason : null, data: out.data };
}

export async function suggestCoachingTopics(ctx: RequestContext, reviewId: string): Promise<AssistResult<{ topics: CoachingTopic[] }>> {
  const { texts, lowRated } = await feedbackTexts(ctx, reviewId);
  const concerns = extractiveSummary(texts).concerns;
  const out = await runAi(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    {
      agentKey: "hr_operations",
      task: "suggest_coaching_topics",
      system: `${AI_RULES} Suggest up to five coaching conversation topics a manager could discuss, each with one sentence on why, grounded in the feedback.`,
      messages: [{ role: "user", content: `Development points:\n${concerns.join("\n") || "(none)"}\n\nAreas rated below the midpoint:\n${lowRated.join("\n") || "(none)"}\n\nFeedback:\n${texts.join("\n\n") || "(none)"}` }],
      schema: coachingSchema,
      fallback: () => ({ topics: coachingTopicsFallback(concerns, lowRated) }),
    },
  );
  return { source: out.source, note: out.source === "rules" ? out.reason : null, data: out.data };
}

export const reviewKeys = { OVERALL_KEY, DEVELOPMENT_KEY };
