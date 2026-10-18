"use client";

import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { CheckboxField, SelectField, SwitchField, TextField, TextareaField, type Option } from "@/components/forms/fields";
import { ConfirmAction } from "@/app/(app)/settings/_components/run-action";
import { DOCUMENT_CATEGORY_LABELS, SELF_UPLOAD_CATEGORIES } from "@/lib/validation/documents";
import {
  FORM_TARGETS,
  OWNER_GROUPS,
  OWNER_GROUP_LABELS,
  TASK_CODES,
  TASK_CODE_LABELS,
  TASK_KINDS,
  TASK_KIND_LABELS,
  templateSchema,
  templateTaskSchema,
  type PlanKind,
} from "@/lib/validation/lifecycle";
import { deleteTemplateAction, deleteTemplateTaskAction, saveTemplateAction, saveTemplateTaskAction } from "../actions";

export type ConditionLookups = { departments: Option[]; locations: Option[]; legalEntities: Option[] };

const EMPLOYMENT_TYPE_OPTIONS: Option[] = [
  { value: "full_time", label: "Full time" },
  { value: "part_time", label: "Part time" },
  { value: "contract", label: "Contract" },
  { value: "intern", label: "Intern" },
  { value: "consultant", label: "Consultant" },
  { value: "temporary", label: "Temporary" },
];

type TemplateValue = {
  id: string;
  kind: PlanKind;
  name: string;
  description: string | null;
  priority: number;
  isActive: boolean;
  departmentId: string | null;
  locationId: string | null;
  legalEntityId: string | null;
  employmentType: string | null;
};

export function TemplateDialog({ value, lookups, defaultKind = "onboarding" }: { value?: TemplateValue; lookups: ConditionLookups; defaultKind?: PlanKind }) {
  const router = useRouter();
  return (
    <FormDialog
      trigger={
        value ? (
          <Button size="sm" variant="outline">
            <Pencil /> Edit template
          </Button>
        ) : (
          <Button size="sm" variant="outline">
            <Plus /> New template
          </Button>
        )
      }
      title={value ? "Edit template" : "New template"}
      description="Conditions decide which employees the template applies to. Leave a condition as Any to match everyone; higher priority wins."
      schema={templateSchema}
      defaultValues={{
        id: value?.id ?? null,
        kind: value?.kind ?? defaultKind,
        name: value?.name ?? "",
        description: value?.description ?? "",
        priority: value?.priority ?? 0,
        isActive: value?.isActive ?? true,
        departmentId: value?.departmentId ?? null,
        locationId: value?.locationId ?? null,
        legalEntityId: value?.legalEntityId ?? null,
        employmentType: (value?.employmentType as "full_time" | null) ?? null,
      }}
      action={saveTemplateAction}
      successMessage="Template saved"
      onSuccess={(d) => {
        if (!value) router.push(`/onboarding/templates/${d.id}`);
      }}
      wide
    >
      {(form) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              control={form.control}
              name="kind"
              label="Type"
              required
              disabled={!!value}
              options={[
                { value: "onboarding", label: "Onboarding" },
                { value: "offboarding", label: "Offboarding" },
              ]}
            />
            <TextField control={form.control} name="name" label="Name" required />
          </div>
          <TextareaField control={form.control} name="description" label="Description" rows={2} />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField control={form.control} name="departmentId" label="Department" options={lookups.departments} allowNone="Any department" />
            <SelectField control={form.control} name="locationId" label="Location" options={lookups.locations} allowNone="Any location" />
            <SelectField control={form.control} name="legalEntityId" label="Legal entity" options={lookups.legalEntities} allowNone="Any legal entity" />
            <SelectField control={form.control} name="employmentType" label="Employment type" options={EMPLOYMENT_TYPE_OPTIONS} allowNone="Any type" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField control={form.control} name="priority" label="Priority" type="number" inputMode="numeric" description="Higher wins when several templates match." />
            <SwitchField control={form.control} name="isActive" label="Active" description="Inactive templates are never selected." />
          </div>
        </>
      )}
    </FormDialog>
  );
}

export type TemplateTaskValue = {
  id: string;
  title: string;
  description: string | null;
  ownerGroup: string;
  dueOffsetDays: number;
  kind: string;
  sortOrder: number;
  config: { documentCategory?: string; policyId?: string; checkinDay?: number; formTarget?: string; code?: string; required?: boolean };
};

const CATEGORY_OPTIONS: Option[] = SELF_UPLOAD_CATEGORIES.map((c) => ({ value: c, label: DOCUMENT_CATEGORY_LABELS[c] }));

export function TemplateTaskDialog({
  templateId,
  kind,
  value,
  policies,
  nextSortOrder = 0,
}: {
  templateId: string;
  kind: PlanKind;
  value?: TemplateTaskValue;
  policies: Option[];
  nextSortOrder?: number;
}) {
  return (
    <FormDialog
      trigger={
        value ? (
          <Button size="icon-sm" variant="ghost" aria-label={`Edit ${value.title}`}>
            <Pencil />
          </Button>
        ) : (
          <Button size="sm">
            <Plus /> Add task
          </Button>
        )
      }
      title={value ? "Edit task" : "Add task"}
      description={kind === "onboarding" ? "Due dates are relative to the joining date (negative = before joining)." : "Due dates are relative to the last working day (negative = before)."}
      schema={templateTaskSchema}
      defaultValues={{
        id: value?.id ?? null,
        templateId,
        title: value?.title ?? "",
        description: value?.description ?? "",
        ownerGroup: (value?.ownerGroup as "hr") ?? "hr",
        dueOffsetDays: value?.dueOffsetDays ?? 0,
        kind: (value?.kind as "checklist") ?? "checklist",
        documentCategory: (value?.config.documentCategory as "identity") ?? null,
        policyId: value?.config.policyId ?? null,
        checkinDay: value?.config.checkinDay ?? null,
        formTarget: (value?.config.formTarget as "personal") ?? null,
        code: (value?.config.code as "handover") ?? null,
        required: value?.config.required !== false,
        sortOrder: value?.sortOrder ?? nextSortOrder,
      }}
      action={saveTemplateTaskAction}
      successMessage="Task saved"
      wide
    >
      {(form) => {
        const taskKind = form.watch("kind");
        return (
          <>
            <TextField control={form.control} name="title" label="Title" required />
            <TextareaField control={form.control} name="description" label="Instructions" rows={2} />
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField control={form.control} name="ownerGroup" label="Owner" required options={OWNER_GROUPS.map((g) => ({ value: g, label: OWNER_GROUP_LABELS[g] }))} />
              <TextField control={form.control} name="dueOffsetDays" label="Due (days from anchor)" type="number" inputMode="numeric" required />
              <TextField control={form.control} name="sortOrder" label="Order" type="number" inputMode="numeric" />
            </div>
            <SelectField control={form.control} name="kind" label="Kind" required options={TASK_KINDS.map((k) => ({ value: k, label: TASK_KIND_LABELS[k] }))} />
            {taskKind === "document_upload" ? (
              <SelectField control={form.control} name="documentCategory" label="Document category" required options={CATEGORY_OPTIONS} description="The task completes once a document of this category is on the employee's record." />
            ) : null}
            {taskKind === "acknowledgement" ? (
              <SelectField
                control={form.control}
                name="policyId"
                label="Policy"
                options={policies}
                allowNone="All policies that need acknowledgement"
                description="Completes when the employee acknowledges the current version."
              />
            ) : null}
            {taskKind === "checkin" ? <TextField control={form.control} name="checkinDay" label="Check-in day" type="number" inputMode="numeric" description="e.g. 30, 60 or 90." /> : null}
            {taskKind === "form" && kind === "onboarding" ? (
              <SelectField
                control={form.control}
                name="formTarget"
                label="Profile section"
                options={FORM_TARGETS.map((f) => ({ value: f, label: { personal: "Personal details", bank: "Bank & statutory", address: "Address", emergency: "Emergency contacts" }[f] }))}
                allowNone="None"
              />
            ) : null}
            {kind === "offboarding" ? (
              <SelectField control={form.control} name="code" label="Exit behaviour" options={TASK_CODES.map((c) => ({ value: c, label: TASK_CODE_LABELS[c] }))} allowNone="Plain task" />
            ) : null}
            <CheckboxField control={form.control} name="required" label="Required for completion" description="Optional tasks do not block the plan from completing." />
          </>
        );
      }}
    </FormDialog>
  );
}

export function DeleteTemplateButton({ id, used }: { id: string; used: boolean }) {
  const router = useRouter();
  return (
    <ConfirmAction
      trigger={
        <Button size="sm" variant="ghost" className="text-danger">
          <Trash2 /> {used ? "Deactivate" : "Delete"}
        </Button>
      }
      title={used ? "Deactivate this template?" : "Delete this template?"}
      description={used ? "It started plans before, so it is kept for history and simply stops being selected." : "The template and its tasks are removed. Existing plans are not affected."}
      confirmLabel={used ? "Deactivate" : "Delete"}
      destructive
      action={async (input: { id: string }) => {
        const res = await deleteTemplateAction(input);
        if (res.ok && res.data.outcome === "deleted") router.push("/onboarding?tab=templates");
        return res;
      }}
      input={{ id }}
      outcomeMessages={{ deleted: "Template deleted", deactivated: "Template deactivated" }}
    />
  );
}

export function DeleteTemplateTaskButton({ id, title }: { id: string; title: string }) {
  return (
    <ConfirmAction
      trigger={
        <Button size="icon-sm" variant="ghost" aria-label={`Remove ${title}`} className="text-muted-foreground hover:text-danger">
          <Trash2 />
        </Button>
      }
      title="Remove this task?"
      description="New plans will no longer include it. Plans already started keep their copy."
      confirmLabel="Remove"
      destructive
      action={deleteTemplateTaskAction}
      input={{ id }}
      success="Task removed"
    />
  );
}
