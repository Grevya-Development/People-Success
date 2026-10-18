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
  const run = <T,>(action: () => Promise<ActionResult<T>>, opts: { success?: string | ((data: T) => string); onSuccess?: (data: T) => void } = {}) =>
    new Promise<ActionResult<T>>((resolve) => {
      startTransition(async () => {
        const res = await action();
        if (res.ok) {
          const msg = typeof opts.success === "function" ? opts.success(res.data) : opts.success;
          if (msg) toast.success(msg);
          opts.onSuccess?.(res.data);
        } else toast.error(res.error.message);
        resolve(res);
      });
    });
  return { pending, run };
}

/** Button that confirms, then runs an action. */
export function ConfirmButton<T>({
  trigger,
  title,
  description,
  confirmLabel,
  destructive,
  action,
  success,
  onSuccess,
}: {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  action: () => Promise<ActionResult<T>>;
  success?: string | ((data: T) => string);
  onSuccess?: (data: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRunAction();
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant={destructive ? "destructive" : "default"}
              disabled={pending}
              onClick={async (e) => {
                e.preventDefault();
                const res = await run(action, { success, onSuccess });
                if (res.ok) setOpen(false);
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
