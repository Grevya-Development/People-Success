"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/** Run a Server Action from an event handler with pending state and toasts. */
export function useRunAction() {
  const [pending, startTransition] = useTransition();
  const run = <T,>(
    action: () => Promise<ActionResult<T>>,
    opts: { success?: string | ((data: T) => string); onSuccess?: (data: T) => void } = {},
  ) =>
    new Promise<boolean>((resolve) => {
      startTransition(async () => {
        const res = await action();
        if (res.ok) {
          const msg = typeof opts.success === "function" ? opts.success(res.data) : opts.success;
          if (msg) toast.success(msg);
          opts.onSuccess?.(res.data);
          resolve(true);
        } else {
          toast.error(res.error.message);
          resolve(false);
        }
      });
    });
  return { pending, run };
}

/**
 * Button that asks for confirmation before running a (usually destructive)
 * Server Action. Usable from Server Components: pass the action reference
 * and its input (both serializable) rather than a closure.
 */
export function ConfirmAction<I, T>({
  trigger,
  title,
  description,
  confirmLabel,
  destructive,
  action,
  input,
  success,
  outcomeMessages,
}: {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  action: (input: I) => Promise<ActionResult<T>>;
  input: I;
  success?: string;
  /** Message per `data.outcome` value, e.g. { deleted: "…", deactivated: "…" }. */
  outcomeMessages?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRunAction();
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant={destructive ? "destructive" : "default"}
              disabled={pending}
              onClick={async (e) => {
                e.preventDefault();
                const ok = await run(() => action(input), {
                  success: (data) => {
                    const outcome = (data as { outcome?: string } | null)?.outcome;
                    return (outcome && outcomeMessages?.[outcome]) || success || "Done";
                  },
                });
                if (ok) setOpen(false);
              }}
            >
              {pending ? <Spinner /> : null}
              {confirmLabel}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
