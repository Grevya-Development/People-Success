import { and, count, desc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { z } from "zod";
import { authorize, can, type RequestContext } from "../../../auth/context";
import type { Tx } from "../../../db/client";
import { departments, employees, locations, surveyParticipants, surveyResponses, surveys } from "../../../db/schema";
import type { SurveyQuestion } from "../../../db/schema/talent";
import { audit, diff } from "../../../lib/audit";
import { conflict, forbidden, invalidState, notFound, validation } from "../../../lib/errors";
import { notify } from "../../notifications";
import { todayIn } from "@/lib/format";
import { tenureBand } from "@/lib/talent/aggregation";
import { validateSurveyAnswers } from "@/lib/talent/survey";
import type { surveyResponseSchema, surveySchema } from "@/lib/validation/talent";
import { CURRENT_STATUSES, requireEmployeeId } from "../shared";

type SurveyRow = typeof surveys.$inferSelect;

export type SurveyListItem = {
  id: string;
  title: string;
  kind: string;
  status: SurveyRow["status"];
  isAnonymous: boolean;
  minGroupSize: number;
  opensOn: string | null;
  closesOn: string | null;
  questionCount: number;
  participants: number | null;
  responded: number | null;
  /** For the signed-in employee. */
  invited: boolean;
  respondedOn: string | null;
};

/**
 * HR (engagement.manage / engagement.results) sees every survey with
 * response counts; employees see the surveys they were invited to.
 */
export async function listSurveys(ctx: RequestContext): Promise<SurveyListItem[]> {
  const admin = can(ctx, "engagement.manage", "all") || can(ctx, "engagement.results", "all");
  return ctx.db(async (tx) => {
    const mine = ctx.employeeId
      ? await tx
          .select({ surveyId: surveyParticipants.surveyId, respondedOn: surveyParticipants.respondedOn })
          .from(surveyParticipants)
          .where(eq(surveyParticipants.employeeId, ctx.employeeId))
      : [];
    const mineMap = new Map(mine.map((m) => [m.surveyId, m.respondedOn]));
    if (!admin && !mine.length) return [];
    const rows = await tx
      .select()
      .from(surveys)
      .where(admin ? undefined : and(inArray(surveys.id, [...mineMap.keys()]), inArray(surveys.status, ["active", "closed"])))
      .orderBy(desc(surveys.createdAt))
      .limit(200);
    const stats = admin && rows.length
      ? await tx
          .select({ surveyId: surveyParticipants.surveyId, total: count(), responded: count(surveyParticipants.respondedOn) })
          .from(surveyParticipants)
          .where(inArray(surveyParticipants.surveyId, rows.map((r) => r.id)))
          .groupBy(surveyParticipants.surveyId)
      : [];
    const statMap = new Map(stats.map((s) => [s.surveyId, s]));
    return rows.map((s) => ({
      id: s.id,
      title: s.title,
      kind: s.kind,
      status: s.status,
      isAnonymous: s.isAnonymous,
      minGroupSize: s.minGroupSize,
      opensOn: s.opensOn,
      closesOn: s.closesOn,
      questionCount: s.questions.length,
      participants: admin ? (statMap.get(s.id)?.total ?? 0) : null,
      responded: admin ? (statMap.get(s.id)?.responded ?? 0) : null,
      invited: mineMap.has(s.id),
      respondedOn: mineMap.get(s.id) ?? null,
    }));
  });
}

export async function getSurveyAdmin(ctx: RequestContext, id: string) {
  if (!can(ctx, "engagement.manage", "all") && !can(ctx, "engagement.results", "all")) throw forbidden();
  return ctx.db(async (tx) => {
    const [s] = await tx.select().from(surveys).where(eq(surveys.id, id));
    if (!s) throw notFound("Survey");
    const [stats] = await tx
      .select({ total: count(), responded: count(surveyParticipants.respondedOn) })
      .from(surveyParticipants)
      .where(eq(surveyParticipants.surveyId, id));
    return { survey: s, participants: stats?.total ?? 0, responded: stats?.responded ?? 0 };
  });
}

export async function saveSurvey(ctx: RequestContext, input: z.output<typeof surveySchema>) {
  authorize(ctx, "engagement.manage", "all");
  const audience = input.audienceAll ? { all: true } : { departmentIds: input.departmentIds, locationIds: input.locationIds };
  const values = {
    title: input.title,
    kind: input.kind,
    description: input.description,
    isAnonymous: input.isAnonymous,
    minGroupSize: input.minGroupSize,
    questions: input.questions as SurveyQuestion[],
    audience,
    opensOn: input.opensOn,
    closesOn: input.closesOn,
  };
  return ctx.db(async (tx) => {
    if (input.departmentIds.length) {
      const found = await tx.select({ id: departments.id }).from(departments).where(inArray(departments.id, input.departmentIds));
      if (found.length !== new Set(input.departmentIds).size) throw validation("Some departments no longer exist.", { departmentIds: ["Not found"] });
    }
    if (input.locationIds.length) {
      const found = await tx.select({ id: locations.id }).from(locations).where(inArray(locations.id, input.locationIds));
      if (found.length !== new Set(input.locationIds).size) throw validation("Some locations no longer exist.", { locationIds: ["Not found"] });
    }
    if (input.id) {
      const [before] = await tx.select().from(surveys).where(eq(surveys.id, input.id)).for("update");
      if (!before) throw notFound("Survey");
      if (before.status !== "draft") throw invalidState("Only draft surveys can be edited.");
      await tx.update(surveys).set(values).where(eq(surveys.id, input.id));
      await audit(tx, ctx, { action: "survey.updated", entityType: "survey", entityId: input.id, changes: diff(before, values) });
      return { id: input.id };
    }
    const [row] = await tx.insert(surveys).values({ tenantId: ctx.tenantId, ...values, createdBy: ctx.userId }).returning({ id: surveys.id });
    await audit(tx, ctx, { action: "survey.created", entityType: "survey", entityId: row.id, metadata: { kind: input.kind, anonymous: input.isAnonymous } });
    return row;
  });
}

async function audienceEmployees(tx: Tx, s: SurveyRow) {
  const a = s.audience;
  const filters = [];
  if (!a.all) {
    if (a.departmentIds?.length) filters.push(inArray(employees.departmentId, a.departmentIds));
    if (a.locationIds?.length) filters.push(inArray(employees.locationId, a.locationIds));
    if (!filters.length) return [];
  }
  return tx
    .select({ id: employees.id, userId: employees.userId })
    .from(employees)
    .where(and(isNull(employees.deletedAt), inArray(employees.status, [...CURRENT_STATUSES]), filters.length ? or(...filters) : undefined));
}

/** Launch: invite the audience. Participants record only whether someone responded. */
export async function launchSurvey(ctx: RequestContext, id: string) {
  authorize(ctx, "engagement.manage", "all");
  const today = todayIn();
  return ctx.db(async (tx) => {
    const [s] = await tx.select().from(surveys).where(eq(surveys.id, id)).for("update");
    if (!s) throw notFound("Survey");
    if (s.status !== "draft") throw invalidState("This survey has already been launched.");
    if (s.closesOn && s.closesOn < today) throw invalidState("The close date is in the past. Edit the survey first.");
    const people = await audienceEmployees(tx, s);
    if (!people.length) throw invalidState("No current employees match this survey's audience.");
    if (s.isAnonymous && people.length < s.minGroupSize) {
      throw invalidState(`An anonymous survey needs at least ${s.minGroupSize} invitees so results can be shown.`);
    }
    for (let i = 0; i < people.length; i += 500) {
      await tx
        .insert(surveyParticipants)
        .values(people.slice(i, i + 500).map((p) => ({ tenantId: ctx.tenantId, surveyId: id, employeeId: p.id })))
        .onConflictDoNothing();
    }
    await tx.update(surveys).set({ status: "active", opensOn: s.opensOn ?? today }).where(eq(surveys.id, id));
    await notify(tx, {
      tenantId: ctx.tenantId,
      userIds: people.map((p) => p.userId).filter((u): u is string => !!u),
      category: "engagement",
      title: `Survey: ${s.title}`,
      body: s.isAnonymous ? "Your answers are anonymous and shown only in groups." : "Please share your feedback.",
      href: `/engagement/surveys/${id}/respond`,
      dedupeKey: `survey-launch:${id}`,
    });
    await audit(tx, ctx, { action: "survey.launched", entityType: "survey", entityId: id, metadata: { participants: people.length } });
    return { participants: people.length };
  });
}

export async function closeSurvey(ctx: RequestContext, id: string) {
  authorize(ctx, "engagement.manage", "all");
  return ctx.db(async (tx) => {
    const [s] = await tx.select().from(surveys).where(eq(surveys.id, id)).for("update");
    if (!s) throw notFound("Survey");
    if (s.status !== "active") throw invalidState("Only active surveys can be closed.");
    await tx.update(surveys).set({ status: "closed", closesOn: s.closesOn && s.closesOn < todayIn() ? s.closesOn : todayIn() }).where(eq(surveys.id, id));
    await audit(tx, ctx, { action: "survey.closed", entityType: "survey", entityId: id });
    return { status: "closed" as const };
  });
}

/** Close surveys whose close date has passed (system context). */
export async function closeExpiredSurveys(tx: Tx, tenantId: string, today = todayIn()) {
  const rows = await tx
    .update(surveys)
    .set({ status: "closed" })
    .where(and(eq(surveys.tenantId, tenantId), eq(surveys.status, "active"), isNotNull(surveys.closesOn), lt(surveys.closesOn, today)))
    .returning({ id: surveys.id });
  return rows.length;
}

/** What a participant needs to answer. Never includes other people's answers. */
export async function getSurveyForResponse(ctx: RequestContext, id: string) {
  const me = requireEmployeeId(ctx);
  const today = todayIn();
  return ctx.db(async (tx) => {
    const [s] = await tx.select().from(surveys).where(eq(surveys.id, id));
    if (!s || s.status === "draft") throw notFound("Survey");
    const [p] = await tx
      .select({ respondedOn: surveyParticipants.respondedOn })
      .from(surveyParticipants)
      .where(and(eq(surveyParticipants.surveyId, id), eq(surveyParticipants.employeeId, me)));
    if (!p) throw notFound("Survey");
    const open = s.status === "active" && (!s.opensOn || s.opensOn <= today) && (!s.closesOn || s.closesOn >= today);
    return {
      id: s.id,
      title: s.title,
      description: s.description,
      kind: s.kind,
      isAnonymous: s.isAnonymous,
      minGroupSize: s.minGroupSize,
      questions: s.questions,
      closesOn: s.closesOn,
      opensOn: s.opensOn,
      open,
      respondedOn: p.respondedOn,
    };
  });
}

/**
 * Record a response.
 *
 * Anonymity guarantees for anonymous surveys:
 * - The response row stores NO employee id and no id of the participant row;
 *   only coarse group attributes (department, location, tenure band) and the
 *   submission date (day precision, no timestamp).
 * - The participant row is marked responded in the same transaction, so a
 *   person can answer once, but nothing links the two rows.
 * - Nothing about the answers is written to audit or application logs.
 * Non-anonymous surveys additionally store the employee id.
 */
export async function submitSurveyResponse(ctx: RequestContext, input: z.output<typeof surveyResponseSchema>) {
  const me = requireEmployeeId(ctx);
  const today = todayIn();
  return ctx.db(async (tx) => {
    const [s] = await tx.select().from(surveys).where(eq(surveys.id, input.surveyId));
    if (!s || s.status === "draft") throw notFound("Survey");
    if (s.status !== "active" || (s.opensOn && s.opensOn > today) || (s.closesOn && s.closesOn < today)) throw invalidState("This survey is not open for responses.");
    const check = validateSurveyAnswers(s.questions, input.answers);
    if (!check.ok) throw validation("Please answer the required questions.", Object.fromEntries(Object.entries(check.errors).map(([k, v]) => [`answers.${k}`, v])));

    const marked = await tx
      .update(surveyParticipants)
      .set({ respondedOn: today })
      .where(and(eq(surveyParticipants.surveyId, s.id), eq(surveyParticipants.employeeId, me), isNull(surveyParticipants.respondedOn)))
      .returning({ id: surveyParticipants.surveyId });
    if (!marked.length) {
      const [p] = await tx
        .select({ respondedOn: surveyParticipants.respondedOn })
        .from(surveyParticipants)
        .where(and(eq(surveyParticipants.surveyId, s.id), eq(surveyParticipants.employeeId, me)));
      if (!p) throw forbidden("You were not invited to this survey.");
      throw conflict("You have already responded to this survey.");
    }
    const [emp] = await tx
      .select({ departmentId: employees.departmentId, locationId: employees.locationId, joiningDate: employees.joiningDate })
      .from(employees)
      .where(eq(employees.id, me));
    // No RETURNING: respondents cannot read survey_responses (RLS), by design.
    await tx.insert(surveyResponses).values({
      tenantId: ctx.tenantId,
      surveyId: s.id,
      employeeId: s.isAnonymous ? null : me,
      departmentId: emp?.departmentId ?? null,
      locationId: emp?.locationId ?? null,
      tenureBand: emp ? tenureBand(emp.joiningDate, today) : null,
      answers: check.answers,
      // Anonymous: never store the real response day. Participants keep their
      // own respondedOn (for reminders), so a real date here would let anyone
      // with database access match a response to the people who answered that day.
      submittedOn: s.isAnonymous ? (s.opensOn ?? today) : today,
    });
    return { respondedOn: today };
  });
}
