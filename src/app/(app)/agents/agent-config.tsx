"use client";

import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { SwitchField, TextField, TextareaField } from "@/components/forms/fields";
import { agentConfigSchema } from "@/server/services/ai-admin-schema";
import { saveAgentConfigAction } from "./actions";

type Agent = { key: string; name: string; enabled: boolean; monthlyBudgetUsd: number; model: string; instructions: string };

export function AgentConfigButton({ agent }: { agent: Agent }) {
  return (
    <FormDialog
      title={agent.name}
      description="Changes apply to new runs. Budgets stop AI calls for the rest of the month once reached; features fall back to rule-based results."
      schema={agentConfigSchema}
      defaultValues={{ key: agent.key, enabled: agent.enabled, monthlyBudgetUsd: agent.monthlyBudgetUsd, model: agent.model, instructions: agent.instructions }}
      action={saveAgentConfigAction}
      successMessage="Agent updated"
      trigger={
        <Button size="xs" variant="outline">
          <Settings2 /> Configure
        </Button>
      }
    >
      {(f) => (
        <>
          <SwitchField control={f.control} name="enabled" label="Enabled" description="When off, this agent's features show rule-based results." />
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField control={f.control} name="monthlyBudgetUsd" label="Monthly budget (USD)" type="number" />
            <TextField control={f.control} name="model" label="Model override" placeholder="Default model" />
          </div>
          <TextareaField control={f.control} name="instructions" label="Organization guidance" rows={4} placeholder="e.g. Our probation is 6 months. Refer payroll questions to payroll@company.com." description="Added to the agent's instructions. Never include confidential data." />
        </>
      )}
    </FormDialog>
  );
}
