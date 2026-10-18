"use client";

import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { createRegularRunAction } from "../actions";
import { useRunAction } from "./use-run-action";

export function StartRunButton({ periodId, label = "Start payroll run", size = "sm" }: { periodId: string; label?: string; size?: "sm" | "default" }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  return (
    <Button size={size} disabled={pending} onClick={() => run(() => createRegularRunAction({ periodId }), { onSuccess: (d) => router.push(`/payroll/runs/${d.runId}`) })}>
      {pending ? <Spinner /> : <Play />}
      {label}
    </Button>
  );
}
