"use client";

import { useRouter } from "next/navigation";
import { useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FieldGroup } from "@/components/ui/field";
import { FormError, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import {
  KNOWN_PLACEHOLDERS,
  TEMPLATE_KINDS,
  TEMPLATE_KIND_LABELS,
  createTemplateSchema,
  extractPlaceholders,
  type CreateTemplateInput,
} from "@/lib/validation/documents";
import { createTemplateAction, updateTemplateAction } from "@/app/(app)/documents/actions";

const KNOWN = new Set(KNOWN_PLACEHOLDERS.map((p) => p.key));

type Props = { template?: CreateTemplateInput & { id: string; currentVersion: number } };

export function TemplateForm({ template }: Props) {
  const router = useRouter();
  const { form, submit, pending } = useActionForm<CreateTemplateInput, { id: string; newVersion?: boolean; version?: number }>({
    schema: createTemplateSchema,
    defaultValues: template
      ? { kind: template.kind, name: template.name, description: template.description ?? "", subject: template.subject ?? "", body: template.body }
      : { kind: "offer_letter", name: "", description: "", subject: "", body: "" },
    action: (values) => (template ? updateTemplateAction({ ...values, id: template.id }) : createTemplateAction(values)),
    successMessage: (d) => (template ? (d.newVersion ? `Saved as version ${d.version}` : "Template saved") : "Template created"),
    onSuccess: (d) => {
      if (!template) router.push(`/documents/templates/${d.id}`);
    },
  });
  const [subject, body] = useWatch({ control: form.control, name: ["subject", "body"] });
  const detected = extractPlaceholders(subject, body);

  async function copy(key: string) {
    try {
      await navigator.clipboard.writeText(`{{${key}}}`);
      toast.success(`Copied {{${key}}}`);
    } catch {
      toast.error("Copy failed. Type the placeholder instead.");
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <section className="rounded-xl border bg-card p-5">
        <FieldGroup className="gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField control={form.control} name="name" label="Name" required />
            <SelectField
              control={form.control}
              name="kind"
              label="Kind"
              required
              options={TEMPLATE_KINDS.map((k) => ({ value: k, label: TEMPLATE_KIND_LABELS[k] }))}
            />
          </div>
          <TextField control={form.control} name="description" label="Description" />
          <TextField control={form.control} name="subject" label="Subject" description="Used as the email subject or letter heading." />
          <TextareaField
            control={form.control}
            name="body"
            label="Body"
            rows={16}
            required
            description="Markdown with {{placeholders}}. Saving a changed body or subject creates a new version."
          />
        </FieldGroup>
      </section>

      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">Placeholders in this template</h2>
        {detected.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {detected.map((p) => (
              <li
                key={p}
                className={
                  KNOWN.has(p)
                    ? "rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs"
                    : "rounded-md bg-warning-soft px-1.5 py-0.5 font-mono text-xs text-warning"
                }
                title={KNOWN.has(p) ? undefined : "Not filled automatically; supply it when generating"}
              >
                {p}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">None yet.</p>
        )}
        <h3 className="mt-4 text-xs font-medium text-muted-foreground">Available placeholders (click to copy)</h3>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {KNOWN_PLACEHOLDERS.map((p) => (
            <li key={p.key}>
              <button
                type="button"
                onClick={() => copy(p.key)}
                title={p.label}
                className="rounded-md border px-1.5 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {`{{${p.key}}}`}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <FormError message={form.formState.errors.root?.message} />
      <div className="flex flex-wrap justify-end gap-2">
        {!template ? (
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {template ? "Save" : "Create template"}
        </Button>
      </div>
    </form>
  );
}
