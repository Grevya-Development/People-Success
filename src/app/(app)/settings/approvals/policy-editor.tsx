"use client";

import { useRouter } from "next/navigation";
import type { z } from "zod";
import { useFieldArray, useWatch } from "react-hook-form";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Section } from "@/components/page";
import { FormError, SelectField, SwitchField, TextField, type Option } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import {
  APPROVER_KINDS,
  APPROVER_LABELS,
  approvalPolicySchema,
  CONDITION_FIELD_SUGGESTIONS,
  CONDITION_OP_LABELS,
  CONDITION_OPS,
} from "@/lib/validation/settings";
import { ComboboxField } from "../_components/combobox-field";
import { saveApprovalPolicyAction } from "./actions";

export type PolicyFormValues = z.input<typeof approvalPolicySchema>;

export function PolicyEditor({
  values,
  roles,
  members,
  subjectLabel,
}: {
  values: PolicyFormValues;
  roles: Option[];
  members: Option[];
  subjectLabel: string;
}) {
  const router = useRouter();
  const editing = !!values.id;
  const { form, submit, pending } = useActionForm({
    schema: approvalPolicySchema,
    defaultValues: values as z.output<typeof approvalPolicySchema>,
    action: saveApprovalPolicyAction,
    successMessage: (d) => (editing ? `Policy saved as version ${d.version}` : "Policy created"),
    onSuccess: () => router.push("/settings/approvals"),
  });
  const c = form.control;
  const steps = useFieldArray({ control: c, name: "steps" });
  const conditions = useFieldArray({ control: c, name: "conditions" });
  const stepValues = useWatch({ control: c, name: "steps" });
  const stepsError = form.formState.errors.steps?.root?.message ?? form.formState.errors.steps?.message;

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <FormError message={form.formState.errors.root?.message} />
      <Section title="Policy" description={subjectLabel}>
        <FieldGroup className="p-5">
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <TextField control={c} name="name" label="Name" required placeholder="Leave over 5 days: manager, then HR" />
            <TextField control={c} name="priority" label="Priority" type="number" inputMode="numeric" description="Higher wins." />
          </div>
          <SwitchField control={c} name="isActive" label="Active" description="Inactive policies are never selected for new requests." />
        </FieldGroup>
      </Section>

      <Section
        title="Conditions"
        description="Leave empty for a default policy that applies to every request. All conditions must match."
        actions={
          <Button type="button" variant="ghost" size="sm" onClick={() => conditions.append({ field: "", op: "eq", value: "" })} disabled={conditions.fields.length >= 10}>
            <Plus /> Add condition
          </Button>
        }
      >
        <div className="space-y-3 p-5">
          {conditions.fields.length === 0 ? <p className="text-sm text-muted-foreground">No conditions: this is a default policy.</p> : null}
          {conditions.fields.map((f, i) => (
            <div key={f.id} className="grid items-start gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)_auto]">
              <TextField control={c} name={`conditions.${i}.field`} label="Field" placeholder="amount" />
              <SelectField control={c} name={`conditions.${i}.op`} label="Operator" options={CONDITION_OPS.map((o) => ({ value: o, label: CONDITION_OP_LABELS[o] }))} />
              <TextField control={c} name={`conditions.${i}.value`} label="Value" placeholder="5000" />
              <Button type="button" variant="ghost" size="icon" className="sm:mt-6" aria-label="Remove condition" onClick={() => conditions.remove(i)}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Common fields: {CONDITION_FIELD_SUGGESTIONS.join(", ")}. Use comma-separated values with “is one of”. Amounts are in paise.
          </p>
        </div>
      </Section>

      <Section
        title="Approval steps"
        description="Steps run in order. If an approver cannot be resolved, HR administrators and the owner approve instead."
        actions={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => steps.append({ name: "", kind: "manager", roleKey: undefined, userId: undefined, escalateAfterHours: undefined })}
            disabled={steps.fields.length >= 10}
          >
            <Plus /> Add step
          </Button>
        }
      >
        <ol className="space-y-3 p-5">
          {steps.fields.map((f, i) => {
            const kind = stepValues?.[i]?.kind;
            return (
              <li key={f.id} className="rounded-lg border p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium">Step {i + 1}</p>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Move up" disabled={i === 0} onClick={() => steps.move(i, i - 1)}>
                      <ArrowUp />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Move down" disabled={i === steps.fields.length - 1} onClick={() => steps.move(i, i + 1)}>
                      <ArrowDown />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove step" disabled={steps.fields.length === 1} onClick={() => steps.remove(i)}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                <FieldGroup>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <TextField control={c} name={`steps.${i}.name`} label="Step name" required placeholder="Manager approval" />
                    <SelectField control={c} name={`steps.${i}.kind`} label="Approver" options={APPROVER_KINDS.map((k) => ({ value: k, label: APPROVER_LABELS[k] }))} />
                  </div>
                  <div className="grid gap-5 sm:grid-cols-2">
                    {kind === "role" ? (
                      <SelectField control={c} name={`steps.${i}.roleKey`} label="Role" options={roles} placeholder="Choose a role" />
                    ) : kind === "user" ? (
                      <ComboboxField control={c} name={`steps.${i}.userId`} label="Person" options={members} placeholder="Choose a member" />
                    ) : (
                      <div className="hidden sm:block" />
                    )}
                    <TextField
                      control={c}
                      name={`steps.${i}.escalateAfterHours`}
                      label="Escalate after (hours)"
                      inputMode="numeric"
                      placeholder="No escalation"
                    />
                  </div>
                </FieldGroup>
              </li>
            );
          })}
          {stepsError ? (
            <p role="alert" className="text-sm text-destructive">
              {stepsError}
            </p>
          ) : null}
        </ol>
      </Section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.push("/settings/approvals")}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          {editing ? "Save new version" : "Create policy"}
        </Button>
      </div>
    </form>
  );
}
