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

type Props<I, T> = {
  action: (input: I) => Promise<ActionResult<T>>;
  input: I;
  children: React.ReactNode;
  success?: string | ((data: T) => string);
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  disabled?: boolean;
  /** Ask before running (state changes that cannot be undone). */
  confirm?: { title: string; description: React.ReactNode; confirmLabel: string; destructive?: boolean };
};

/** Button that runs a Server Action with pending state and toasts. Usable from Server Components. */
export function RunButton<I, T>({ action, input, children, success, variant = "outline", size = "sm", className, disabled, confirm }: Props<I, T>) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const run = () =>
    new Promise<boolean>((resolve) =>
      start(async () => {
        const res = await action(input);
        if (res.ok) {
          const msg = typeof success === "function" ? success(res.data) : success;
          if (msg) toast.success(msg);
          resolve(true);
        } else {
          toast.error(res.error.message);
          resolve(false);
        }
      }),
    );

  if (!confirm) {
    return (
      <Button type="button" variant={variant} size={size} className={className} disabled={disabled || pending} onClick={() => void run()}>
        {pending ? <Spinner /> : null}
        {children}
      </Button>
    );
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant={variant} size={size} className={className} disabled={disabled || pending}>
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant={confirm.destructive ? "destructive" : "default"}
              disabled={pending}
              onClick={async (e) => {
                e.preventDefault();
                if (await run()) setOpen(false);
              }}
            >
              {pending ? <Spinner /> : null}
              {confirm.confirmLabel}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
