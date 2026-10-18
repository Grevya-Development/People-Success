import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { RequestContext } from "../auth/context";
import { approvalRequests, approvalSteps, tasks } from "../db/schema";

/** Counts shown next to sidebar items. Kept to two cheap indexed queries. */
export async function getShellBadges(ctx: RequestContext): Promise<Record<string, number>> {
  const [approvals, openTasks] = await ctx.db((tx) =>
    Promise.all([
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
    ]),
  );
  return { inbox: (approvals[0]?.n ?? 0) + (openTasks[0]?.n ?? 0) };
}
