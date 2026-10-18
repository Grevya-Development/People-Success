"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarCheck2, Plus, RefreshCw, Sparkles, UserPlus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, TextField, type Option } from "@/components/forms/fields";
import { ComboboxField } from "@/app/(app)/settings/_components/combobox-field";
import { ConfirmAction, useRunAction } from "@/app/(app)/settings/_components/run-action";
import { markJoinedSchema, setBuddySchema, startPlanSchema } from "@/lib/validation/lifecycle";
import { todayIn } from "@/lib/format";
import { cancelPlanAction, installStandardLifecycleTemplatesAction, markJoinedAction, refreshPlanAction, setBuddyAction, startOnboardingAction } from "../actions";

export function StartPlanDialog({ candidates, templates, buddies }: { candidates: Option[]; templates: Option[]; buddies: Option[] }) {
  const router = useRouter();
  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <Plus /> Start onboarding
        </Button>
      }
      title="Start onboarding"
      description="Creates the checklist from the best-matching template, assigns owners and sets due dates from the joining date."
      schema={startPlanSchema}
      defaultValues={{ employeeId: "", templateId: null, buddyEmployeeId: null }}
      action={startOnboardingAction}
      submitLabel="Start onboarding"
      successMessage="Onboarding started"
      onSuccess={(d) => router.push(`/onboarding/plans/${d.id}`)}
    >
      {(form) => (
        <>
          <ComboboxField
            control={form.control}
            name="employeeId"
            label="New joiner"
            options={candidates}
            placeholder="Choose an employee…"
            emptyText="No pre-joining or recently joined employees without a plan."
          />
          <SelectField
            control={form.control}
            name="templateId"
            label="Template"
            options={templates}
            allowNone="Best match (automatic)"
            description="Automatic picks the highest-priority active template whose conditions match the employee."
          />
          <ComboboxField control={form.control} name="buddyEmployeeId" label="Buddy" options={buddies} placeholder="Optional" description="Buddy tasks are assigned to this person." />
        </>
      )}
    </FormDialog>
  );
}

export function InstallStandardTemplatesButton({ variant = "default" }: { variant?: "default" | "outline" }) {
  const { pending, run } = useRunAction();
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={pending}
      onClick={() =>
        run(() => installStandardLifecycleTemplatesAction({}), {
          success: (d) => (d.added ? `${d.added} standard ${d.added === 1 ? "template" : "templates"} added` : "Standard templates are already installed"),
        })
      }
    >
      {pending ? <Spinner /> : <Sparkles />} Add standard templates
    </Button>
  );
}

export function BuddyDialog({ planId, current, buddies }: { planId: string; current: string | null; buddies: Option[] }) {
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline">
          <UserPlus /> {current ? "Change buddy" : "Assign buddy"}
        </Button>
      }
      title="Onboarding buddy"
      description="Open buddy tasks move to the new buddy."
      schema={setBuddySchema}
      defaultValues={{ planId, buddyEmployeeId: current }}
      action={setBuddyAction}
      successMessage="Buddy updated"
    >
      {(form) => <ComboboxField control={form.control} name="buddyEmployeeId" label="Buddy" options={buddies} placeholder="Choose a colleague…" />}
    </FormDialog>
  );
}

export function MarkJoinedDialog({ employeeId, name, joiningDate }: { employeeId: string; name: string; joiningDate: string }) {
  const today = todayIn();
  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <CalendarCheck2 /> Mark as joined
        </Button>
      }
      title={`Mark ${name} as joined`}
      description="Activates the employee from the joining date you confirm. This does not happen automatically."
      schema={markJoinedSchema}
      defaultValues={{ employeeId, joinedOn: joiningDate <= today ? joiningDate : today }}
      action={markJoinedAction}
      submitLabel="Confirm joining"
      successMessage={`${name} is now active`}
    >
      {(form) => <TextField control={form.control} name="joinedOn" label="Joined on" type="date" required />}
    </FormDialog>
  );
}

export function CancelPlanButton({ planId }: { planId: string }) {
  return (
    <ConfirmAction
      trigger={
        <Button size="sm" variant="ghost" className="text-danger">
          <XCircle /> Cancel plan
        </Button>
      }
      title="Cancel this plan?"
      description="Open tasks are cancelled and disappear from people's inboxes. Completed tasks stay in the history."
      confirmLabel="Cancel plan"
      destructive
      action={cancelPlanAction}
      input={{ id: planId }}
      success="Plan cancelled"
    />
  );
}

export function RefreshEvidenceButton({ planId }: { planId: string }) {
  const { pending, run } = useRunAction();
  const [last, setLast] = useState<string | null>(null);
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      title="Re-check uploaded documents, acknowledgements and asset returns"
      onClick={() =>
        run(() => refreshPlanAction({ id: planId }), {
          onSuccess: (d) => setLast(d.completed ? `${d.completed} completed` : "Up to date"),
          success: (d) => (d.completed ? `${d.completed} ${d.completed === 1 ? "task" : "tasks"} completed from existing evidence` : "Everything is up to date"),
        })
      }
    >
      {pending ? <Spinner /> : <RefreshCw />} {last ?? "Re-check evidence"}
    </Button>
  );
}
