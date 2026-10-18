import { and, desc, eq, inArray, max } from "drizzle-orm";
import type { RequestContext } from "../../../auth/context";
import { withSystem } from "../../../db/tx";
import { departments, employees, goalCheckins, goals, oneOnOnes, surveyResponses, surveys } from "../../../db/schema";
import { todayIn } from "@/lib/format";
import { enpsScore, overallScaleAverage, type ResponseLite } from "@/lib/talent/aggregation";
import { addDaysIso } from "@/lib/talent/learning";
import { directReportIds, employeeBasics } from "../shared";

/**
 * Manager's people-success overview. Built only from explicit records
 * (1:1 dates, goal check-ins, joining dates, aggregated survey scores).
 * It does not monitor activity, infer mental health or score individuals.
 */

export type PeopleOverview = {
  reports: number;
  overdueOneOnOnes: { employeeId: string; name: string; lastHeldOn: string | null }[];
  overdueCheckins: { goalId: string; title: string; employeeId: string; name: string; lastCheckinOn: string | null }[];
  anniversaries: { employeeId: string; name: string; date: string; years: number }[];
  departmentTrend: { departmentName: string | null; points: { surveyId: string; title: string; date: string; suppressed: boolean; average: number | null; enps: number | null }[] };
};

const STALE_DAYS = 30;

export async function peopleSuccessOverview(ctx: RequestContext): Promise<PeopleOverview> {
  const empty: PeopleOverview = { reports: 0, overdueOneOnOnes: [], overdueCheckins: [], anniversaries: [], departmentTrend: { departmentName: null, points: [] } };
  if (!ctx.employeeId) return empty;
  const me = ctx.employeeId;
  const today = todayIn();
  const staleBefore = addDaysIso(today, -STALE_DAYS);

  const base = await ctx.db(async (tx) => {
    const reportIds = await directReportIds(tx, me);
    const people = await employeeBasics(tx, [me, ...reportIds]);
    if (!reportIds.length) return { reportIds, people, overdueOneOnOnes: [], overdueCheckins: [], anniversaries: [] };

    // RLS: only 1:1s where I am a participant are visible.
    const last = await tx
      .select({ employeeId: oneOnOnes.employeeId, last: max(oneOnOnes.heldOn) })
      .from(oneOnOnes)
      .where(and(eq(oneOnOnes.managerEmployeeId, me), inArray(oneOnOnes.employeeId, reportIds)))
      .groupBy(oneOnOnes.employeeId);
    const lastMap = new Map(last.map((l) => [l.employeeId, l.last]));
    const overdueOneOnOnes = reportIds
      .filter((id) => {
        const l = lastMap.get(id);
        return !l || l < staleBefore;
      })
      .map((id) => ({ employeeId: id, name: people.get(id)?.name ?? "Unknown", lastHeldOn: lastMap.get(id) ?? null }));

    const activeGoals = await tx
      .select({ id: goals.id, title: goals.title, employeeId: goals.employeeId, createdAt: goals.createdAt })
      .from(goals)
      .where(and(inArray(goals.employeeId, reportIds), eq(goals.status, "active")));
    const checkins = activeGoals.length
      ? await tx
          .select({ goalId: goalCheckins.goalId, last: max(goalCheckins.createdAt) })
          .from(goalCheckins)
          .where(inArray(goalCheckins.goalId, activeGoals.map((g) => g.id)))
          .groupBy(goalCheckins.goalId)
      : [];
    const checkMap = new Map(checkins.map((c) => [c.goalId, c.last]));
    const overdueCheckins = activeGoals
      .map((g) => {
        const lastAt = checkMap.get(g.id) ?? null;
        const ref = (lastAt ?? g.createdAt).toISOString().slice(0, 10);
        return { goal: g, lastAt, stale: ref < staleBefore };
      })
      .filter((x) => x.stale)
      .map((x) => ({ goalId: x.goal.id, title: x.goal.title, employeeId: x.goal.employeeId!, name: people.get(x.goal.employeeId!)?.name ?? "Unknown", lastCheckinOn: x.lastAt ? x.lastAt.toISOString().slice(0, 10) : null }));

    const horizon = addDaysIso(today, 30);
    const anniversaries = reportIds
      .map((id) => {
        const p = people.get(id)!;
        const [jy, jm, jd] = p.joiningDate.split("-");
        let year = Number(today.slice(0, 4));
        let date = `${year}-${jm}-${jd}`;
        if (date < today) {
          year += 1;
          date = `${year}-${jm}-${jd}`;
        }
        return { employeeId: id, name: p.name, date, years: year - Number(jy) };
      })
      .filter((a) => a.years >= 1 && a.date <= horizon)
      .sort((a, b) => a.date.localeCompare(b.date));
    return { reportIds, people, overdueOneOnOnes, overdueCheckins, anniversaries };
  });

  // Department engagement trend. Managers cannot read raw responses (RLS), so
  // aggregates are computed in system context for the manager's own
  // department only, and every point below the survey's minimum group size is
  // suppressed. Only scores leave this function.
  const deptId = base.people.get(me)?.departmentId ?? null;
  const departmentTrend: PeopleOverview["departmentTrend"] = { departmentName: null, points: [] };
  if (deptId && base.reportIds.length) {
    const result = await withSystem(async (tx) => {
      const [dep] = await tx.select({ name: departments.name }).from(departments).where(and(eq(departments.tenantId, ctx.tenantId), eq(departments.id, deptId)));
      const list = await tx
        .select()
        .from(surveys)
        .where(and(eq(surveys.tenantId, ctx.tenantId), inArray(surveys.status, ["active", "closed"])))
        .orderBy(desc(surveys.opensOn))
        .limit(6);
      const rows = list.length
        ? await tx
            .select({ surveyId: surveyResponses.surveyId, answers: surveyResponses.answers })
            .from(surveyResponses)
            .where(and(eq(surveyResponses.tenantId, ctx.tenantId), eq(surveyResponses.departmentId, deptId), inArray(surveyResponses.surveyId, list.map((s) => s.id))))
        : [];
      const points = list
        .map((s) => {
          const rs = rows.filter((r) => r.surveyId === s.id).map((r) => ({ departmentId: deptId, locationId: null, tenureBand: null, answers: r.answers })) as ResponseLite[];
          const suppressed = rs.length < Math.max(3, s.minGroupSize);
          const enpsQ = s.questions.find((q) => q.type === "enps");
          return {
            surveyId: s.id,
            title: s.title,
            date: s.opensOn ?? s.createdAt.toISOString().slice(0, 10),
            suppressed,
            average: suppressed ? null : overallScaleAverage(s.questions, rs),
            enps: suppressed || !enpsQ ? null : (enpsScore(rs.map((r) => Number(r.answers[enpsQ.id])))?.score ?? null),
          };
        })
        .reverse();
      return { departmentName: dep?.name ?? null, points };
    }, ctx.tenantId);
    Object.assign(departmentTrend, result);
  }

  return {
    reports: base.reportIds.length,
    overdueOneOnOnes: base.overdueOneOnOnes,
    overdueCheckins: base.overdueCheckins,
    anniversaries: base.anniversaries,
    departmentTrend,
  };
}

/** Manager of an employee (system context helper for milestone suggestions). */
export async function managerUserFor(tenantId: string, employeeId: string) {
  return withSystem(async (tx) => {
    const [e] = await tx
      .select({ name: employees.displayName, managerId: employees.managerId })
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.id, employeeId)));
    if (!e?.managerId) return null;
    const [m] = await tx.select({ userId: employees.userId }).from(employees).where(and(eq(employees.tenantId, tenantId), eq(employees.id, e.managerId)));
    return m?.userId ? { userId: m.userId, employeeName: e.name } : null;
  }, tenantId);
}
