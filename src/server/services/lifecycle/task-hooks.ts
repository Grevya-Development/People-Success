import { eq } from "drizzle-orm";
import { lifecyclePlans } from "../../db/schema";
import { invalidState } from "../../lib/errors";
import { registerTaskHook, type TaskHook } from "../task-hooks";
import { PLAN_CONTAINER, missingEvidence, recalcPlan } from "./shared";

type Hook = TaskHook;

/**
 * Inbox status changes on lifecycle tasks: refuse "done" without the
 * required evidence (the thrown error rolls the inbox update back), then
 * recalculate the plan's progress.
 */
const hook: Hook = async ({ tx, task, ctx }) => {
  if (!task.containerId) return;
  const [plan] = await tx.select().from(lifecyclePlans).where(eq(lifecyclePlans.id, task.containerId));
  if (!plan) return;
  if (plan.status === "cancelled") throw invalidState("This plan was cancelled.");
  if (task.status === "done") {
    const missing = await missingEvidence(tx, task, plan);
    if (missing) throw invalidState(missing);
  }
  await recalcPlan(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, plan.id);
};

/** Registration is order-independent (the registry has no dependencies). */
export function registerLifecycleTaskHook() {
  registerTaskHook(PLAN_CONTAINER, hook);
}
