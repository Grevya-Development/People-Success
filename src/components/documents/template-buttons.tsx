"use client";

import { Library } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { installStandardTemplatesAction, setTemplateActiveAction } from "@/app/(app)/documents/actions";
import { useRunAction } from "./use-run-action";

export function InstallStandardTemplatesButton({ variant = "outline" }: { variant?: "outline" | "default" }) {
  const { pending, run } = useRunAction();
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={pending}
      onClick={() =>
        run(() => installStandardTemplatesAction({}), {
          success: (d) => (d.added ? `Added ${d.added} standard template${d.added === 1 ? "" : "s"}` : "Standard templates are already installed"),
        })
      }
    >
      {pending ? <Spinner data-icon="inline-start" /> : <Library data-icon="inline-start" />}
      Add standard templates
    </Button>
  );
}

export function TemplateActiveSwitch({ id, isActive, name }: { id: string; isActive: boolean; name: string }) {
  const { pending, run } = useRunAction();
  return (
    <Switch
      checked={isActive}
      disabled={pending}
      aria-label={`${isActive ? "Deactivate" : "Activate"} ${name}`}
      onCheckedChange={(v) => run(() => setTemplateActiveAction({ id, isActive: v }), { success: v ? "Template activated" : "Template deactivated" })}
    />
  );
}
