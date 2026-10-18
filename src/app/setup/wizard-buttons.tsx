"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { SetupStepKey } from "@/lib/setup-steps";
import { completeSetupAction, markSetupStepAction } from "./actions";

export function MarkStepButton({ step }: { step: SetupStepKey }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await markSetupStepAction({ step });
          if (res.ok) toast.success("Step marked as done");
          else toast.error(res.error.message);
        })
      }
    >
      {pending ? <Spinner /> : null}
      Mark as done
    </Button>
  );
}

export function CompleteSetupButton({ warnings }: { warnings: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button>Complete setup</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Go live?</AlertDialogTitle>
          <AlertDialogDescription>
            {warnings
              ? `${warnings} readiness item${warnings === 1 ? " still needs" : "s still need"} attention. You can finish ${warnings === 1 ? "it" : "them"} after going live.`
              : "Your organization will be marked as live."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Not yet</AlertDialogCancel>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await completeSetupAction({});
                if (res.ok) {
                  toast.success("Setup complete. Welcome aboard.");
                  setOpen(false);
                  router.push("/overview");
                } else toast.error(res.error.message);
              })
            }
          >
            {pending ? <Spinner /> : null}
            Complete setup
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
