import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { can, getTeamEmployeeIds, type RequestContext } from "../auth/context";
import { approvalRequests, approvalSteps, employees, tasks, tenants } from "../db/schema";
import type { TenantSettings } from "../db/schema";

/**
 * Metric definitions (documented in docs/METRICS.md):
 * - activeHeadcount: employees with status active or on_notice, not deleted.
 * - joinersThisMonth: employees whose joining_date falls in the current calendar month and who have joined (status != pending).
 * - upcomingJoiners: employees in status pending (offer accepted / created, not yet joined).
 * - exitsThisMonth: employees whose exit_date falls in the current calendar month.
 * - myPendingApprovals: active approval steps where the user is an approver.
 * - myOpenTasks: open / in-progress / blocked tasks assigned to the user.
 */
export type OverviewData = {
  scope: "organization" | "team" | "self";
  activeHeadcount: number | null;
  joinersThisMonth: number | null;
  upcomingJoiners: number | null;
  exitsThisMonth: number | null;
  myPendingApprovals: number;
  myOpenTasks: number;
  setup: TenantSettings["setup"] | null;
  tenantStatus: string;
};

export async function getOverview(ctx: RequestContext): Promise<OverviewData> {
  const now = new Date();
  const monthStart = format(startOfMonth(now), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(now), "yyyy-MM-dd");
  const orgWide = can(ctx, "employees.view", "all");
  const team = !orgWide && can(ctx, "employees.view", "team") ? await getTeamEmployeeIds(ctx) : null;
  const scope: OverviewData["scope"] = orgWide ? "organization" : team ? "team" : "self";

  return ctx.db(async (tx) => {
    const scoped = (cond: ReturnType<typeof and>) =>
      team ? and(cond, team.length ? inArray(employees.id, team) : sql`false`) : cond;

    const workforce =
      scope === "self"
        ? null
        : await tx
            .select({
              active: sql<number>`count(*) filter (where ${employees.status} in ('active','on_notice'))`.mapWith(Number),
              joiners: sql<number>`count(*) filter (where ${employees.status} <> 'pending' and ${employees.joiningDate} between ${monthStart} and ${monthEnd})`.mapWith(Number),
              upcoming: sql<number>`count(*) filter (where ${employees.status} = 'pending')`.mapWith(Number),
              exits: sql<number>`count(*) filter (where ${employees.exitDate} between ${monthStart} and ${monthEnd})`.mapWith(Number),
            })
            .from(employees)
            .where(scoped(and(isNull(employees.deletedAt))))
            .then((r) => r[0]);

    const [[approvals], [openTasks], [tenant]] = await Promise.all([
      tx
        .select({ n: count() })
        .from(approvalSteps)
        .innerJoin(approvalRequests, eq(approvalRequests.id, approvalSteps.requestId))
        .where(
          and(
            eq(approvalSteps.status, "pending"),
            eq(approvalRequests.status, "pending"),
            sql`${approvalSteps.stepNo} = ${approvalRequests.currentStep}`,
            sql`${ctx.userId}::uuid = any(${approvalSteps.approverUserIds})`,
          ),
        ),
      tx
        .select({ n: count() })
        .from(tasks)
        .where(and(eq(tasks.assigneeUserId, ctx.userId), inArray(tasks.status, ["open", "in_progress", "blocked"]))),
      tx.select({ settings: tenants.settings, status: tenants.status }).from(tenants).where(eq(tenants.id, ctx.tenantId)),
    ]);

    return {
      scope,
      activeHeadcount: workforce?.active ?? null,
      joinersThisMonth: workforce?.joiners ?? null,
      upcomingJoiners: workforce?.upcoming ?? null,
      exitsThisMonth: workforce?.exits ?? null,
      myPendingApprovals: approvals?.n ?? 0,
      myOpenTasks: openTasks?.n ?? 0,
      setup: can(ctx, "settings.manage", "all") ? (tenant?.settings.setup ?? null) : null,
      tenantStatus: tenant?.status ?? "active",
    };
  });
}
