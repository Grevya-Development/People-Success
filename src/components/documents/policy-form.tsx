"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWatch } from "react-hook-form";
import { Eye, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FieldGroup } from "@/components/ui/field";
import { FormError, SelectField, SwitchField, TextField, TextareaField, type Option } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { POLICY_CATEGORIES, POLICY_CATEGORY_LABELS, policySchema, type PolicyInput } from "@/lib/validation/documents";
import { createPolicyAction, updatePolicyAction } from "@/app/(app)/documents/actions";
import { Markdown } from "./markdown";

type Props = {
  policy?: PolicyInput & { id: string; status: string; version: number };
  documentOptions: Option[];
  today: string;
};

export function PolicyForm({ policy, documentOptions, today }: Props) {
  const router = useRouter();
  const [preview, setPreview] = useState(false);
  const published = policy?.status === "published";
  const { form, submit, pending } = useActionForm<PolicyInput, { id: string }>({
    schema: policySchema,
    defaultValues: policy
      ? {
          title: policy.title,
          category: policy.category,
          summary: policy.summary ?? "",
          body: policy.body,
          effectiveFrom: policy.effectiveFrom,
          requiresAcknowledgement: policy.requiresAcknowledgement,
          documentId: policy.documentId,
        }
      : { title: "", category: "general", summary: "", body: "", effectiveFrom: today, requiresAcknowledgement: true, documentId: null },
    action: (values) => (policy ? updatePolicyAction({ ...values, id: policy.id }) : createPolicyAction(values)),
    successMessage: policy ? (published ? "Policy saved" : "Draft saved") : "Draft created",
    onSuccess: (data) => router.push(`/documents/policies/${data.id}`),
  });
  const body = useWatch({ control: form.control, name: "body" });

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {published ? (
        <p className="rounded-lg border border-info/20 bg-info-soft px-4 py-2.5 text-sm text-info">
          This policy is published. Changing its title, text, effective date, attachment or acknowledgement setting publishes version {policy.version + 1} and asks employees to acknowledge again.
        </p>
      ) : null}
      <section className="rounded-xl border bg-card p-5">
        <FieldGroup className="gap-5">
          <TextField control={form.control} name="title" label="Title" required />
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField
              control={form.control}
              name="category"
              label="Category"
              required
              options={POLICY_CATEGORIES.map((c) => ({ value: c, label: POLICY_CATEGORY_LABELS[c] }))}
            />
            <TextField control={form.control} name="effectiveFrom" label="Effective from" type="date" required />
          </div>
          <TextareaField control={form.control} name="summary" label="Summary" rows={2} description="One or two sentences shown in the policy list." />
          <SwitchField
            control={form.control}
            name="requiresAcknowledgement"
            label="Requires acknowledgement"
            description="Employees are asked to confirm they have read this version."
          />
          {documentOptions.length ? (
            <SelectField
              control={form.control}
              name="documentId"
              label="Attached document"
              allowNone="No attachment"
              options={documentOptions}
              description="An employee-visible company document, e.g. the signed PDF."
            />
          ) : null}
        </FieldGroup>
      </section>

      <section className="rounded-xl border bg-card">
        <header className="flex items-center justify-between gap-3 border-b px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold">Policy text</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Markdown: # headings, - lists, **bold**, *italic*, [links](https://…).</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setPreview((p) => !p)} aria-pressed={preview}>
            {preview ? <Pencil data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
            {preview ? "Edit" : "Preview"}
          </Button>
        </header>
        <div className="p-5">
          {preview ? (
            body?.trim() ? (
              <Markdown source={body} className="min-h-64" />
            ) : (
              <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
            )
          ) : (
            <TextareaField control={form.control} name="body" label="Text" rows={18} required />
          )}
        </div>
      </section>

      <FormError message={form.formState.errors.root?.message} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {policy ? (published ? "Save changes" : "Save draft") : "Create draft"}
        </Button>
      </div>
    </form>
  );
}
