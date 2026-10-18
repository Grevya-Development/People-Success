"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";

/** Run a Server Action from a button: pending state plus success / error toasts. */
export function useRunAction() {
  const [pending, startTransition] = useTransition();
  function run<T>(fn: () => Promise<ActionResult<T>>, opts: { success?: string | ((data: T) => string); onSuccess?: (data: T) => void } = {}) {
    startTransition(async () => {
      try {
        const r = await fn();
        if (r.ok) {
          const msg = typeof opts.success === "function" ? opts.success(r.data) : opts.success;
          if (msg) toast.success(msg);
          opts.onSuccess?.(r.data);
        } else {
          toast.error(r.error.message);
        }
      } catch {
        toast.error("Something went wrong. Please try again.");
      }
    });
  }
  return { pending, run };
}
