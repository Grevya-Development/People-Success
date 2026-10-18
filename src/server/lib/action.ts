import "server-only";
import { z } from "zod";
import { unstable_rethrow } from "next/navigation";
import { requireActionContext, type RequestContext } from "../auth/context";
import { AppError, toAppError } from "./errors";
import { logger } from "./logger";
import { authorize } from "../auth/context";
import type { Permission, Scope } from "@/lib/permissions";

import type { ActionError, ActionResult } from "@/lib/action-result";

export type { ActionError, ActionResult };

export function zodFieldErrors(err: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function failure(err: unknown): { ok: false; error: ActionError } {
  const appErr = toAppError(err);
  if (appErr.code === "INTERNAL") logger.error("action.failed", { err });
  return {
    ok: false,
    error: { code: appErr.code, message: appErr.message, fieldErrors: appErr.fieldErrors },
  };
}

/**
 * Define a Server Action: authenticates, validates input with Zod, checks the
 * coarse permission, runs the handler and maps errors to a serializable
 * result. Handlers still perform record-level authorization themselves.
 */
export function defineAction<S extends z.ZodType, R>(
  opts: { input: S; permission?: Permission; scope?: Scope },
  handler: (ctx: RequestContext, input: z.output<S>) => Promise<R>,
) {
  return async (raw: z.input<S>): Promise<ActionResult<R>> => {
    try {
      const ctx = await requireActionContext();
      if (opts.permission) authorize(ctx, opts.permission, opts.scope ?? "self");
      const parsed = opts.input.safeParse(raw);
      if (!parsed.success) {
        throw new AppError("VALIDATION", "Please correct the highlighted fields.", {
          fieldErrors: zodFieldErrors(parsed.error),
        });
      }
      const data = await handler(ctx, parsed.data);
      return { ok: true, data };
    } catch (err) {
      unstable_rethrow(err);
      return failure(err);
    }
  };
}
