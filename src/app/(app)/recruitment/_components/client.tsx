"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useRunAction } from "@/components/documents/use-run-action";

/**
 * Button that runs a Server Action (optionally after a confirmation). The
 * action and its input are passed separately so Server Components can render it.
 */
export function ActionButton<I, T>({
  action,
  input,
  children,
  success,
  confirm,
  variant = "outline",
  size = "sm",
  redirectTo,
  disabled,
}: {
  action: (input: I) => Promise<ActionResult<T>>;
  input: I;
  children: React.ReactNode;
  success?: string;
  confirm?: { title: string; description: string; label: string; destructive?: boolean };
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary";
  size?: "sm" | "default" | "xs";
  redirectTo?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [open, setOpen] = useState(false);
  const go = () =>
    run(() => action(input), {
      success,
      onSuccess: () => {
        setOpen(false);
        if (redirectTo) router.push(redirectTo);
      },
    });
  if (!confirm) {
    return (
      <Button variant={variant} size={size} disabled={pending || disabled} onClick={go}>
        {pending ? <Spinner /> : null}
        {children}
      </Button>
    );
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size={size} disabled={pending || disabled}>
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
              onClick={(e) => {
                e.preventDefault();
                go();
              }}
            >
              {pending ? <Spinner /> : null}
              {confirm.label}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Dialog asking for a short reason, then running an action with it. */
export function ReasonDialog<T>({
  trigger,
  title,
  description,
  label,
  required = true,
  confirmLabel,
  destructive,
  run: runAction,
  success,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  label: string;
  required?: boolean;
  confirmLabel: string;
  destructive?: boolean;
  run: (reason: string) => Promise<ActionResult<T>>;
  success: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { pending, run } = useRunAction();
  const invalid = required && reason.trim().length < 3;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (pending) return;
        setOpen(o);
        if (!o) setReason("");
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="reason-text">
            {label}
            {required ? <span className="text-destructive" aria-hidden>*</span> : null}
          </FieldLabel>
          <Textarea id="reason-text" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          {required ? <FieldDescription>At least 3 characters. Kept internal.</FieldDescription> : null}
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={pending || invalid}
            onClick={() => run(() => runAction(reason.trim()), { success, onSuccess: () => setOpen(false) })}
          >
            {pending ? <Spinner /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function copyText(text: string, message = "Copied") {
  navigator.clipboard.writeText(text).then(
    () => toast.success(message),
    () => toast.error("Could not copy"),
  );
}
