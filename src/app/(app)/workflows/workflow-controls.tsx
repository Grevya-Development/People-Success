"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Square, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cancelRunAction, retryRunAction, seedStartersAction, setWorkflowActiveAction } from "./actions";

export function ActiveToggle({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Switch
      checked={active}
      disabled={pending}
      aria-label={active ? "Deactivate workflow" : "Activate workflow"}
      onCheckedChange={(v) =>
        start(async () => {
          const res = await setWorkflowActiveAction({ id, active: v });
          if (res.ok) toast.success(v ? "Workflow activated" : "Workflow paused");
          else toast.error(res.error.message);
        })
      }
    />
  );
}

export function SeedStartersButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await seedStartersAction({});
          if (res.ok) toast.success(`${res.data.created} starter workflows added (inactive)`);
          else toast.error(res.error.message);
        })
      }
    >
      {pending ? <Spinner /> : <Sparkles />} Add starter workflows
    </Button>
  );
}

export function RunControls({ runId, status }: { runId: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, msg: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(msg);
        router.refresh();
      } else toast.error(res.error?.message ?? "Failed");
    });
  return (
    <div className="flex gap-2">
      {status === "failed" ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => retryRunAction({ runId }), "Retry queued")}>
          <RotateCcw /> Retry
        </Button>
      ) : null}
      {["queued", "running", "waiting"].includes(status) ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => cancelRunAction({ runId }), "Run cancelled")}>
          <Square /> Cancel
        </Button>
      ) : null}
    </div>
  );
}
