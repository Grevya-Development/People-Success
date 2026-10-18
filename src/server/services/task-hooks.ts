import type { Tx } from "../db/client";
import type { tasks } from "../db/schema";
import type { RequestContext } from "../auth/context";

/**
 * Task hooks let a module react when one of its tasks changes status (e.g.
 * onboarding progress), or refuse the change by throwing (the transaction
 * rolls back). Kept dependency-free so registration order never matters.
 */
export type TaskHook = (e: { tx: Tx; task: typeof tasks.$inferSelect; ctx: RequestContext }) => Promise<void>;

const hooks = new Map<string, TaskHook>();

export const registerTaskHook = (containerType: string, hook: TaskHook) => {
  hooks.set(containerType, hook);
};

export const taskHookFor = (containerType: string) => hooks.get(containerType);
