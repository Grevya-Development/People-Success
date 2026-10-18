"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError, TextField, TextareaField } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { kbArticleSchema, type KbArticleInput } from "@/lib/validation/helpdesk";
import { createKbArticleAction, updateKbArticleAction } from "../actions";

export function KbArticleForm({ article }: { article?: KbArticleInput & { id: string; status: string } }) {
  const router = useRouter();
  const { form, submit, pending } = useActionForm({
    schema: kbArticleSchema,
    defaultValues: article ? { title: article.title, category: article.category, body: article.body } : { title: "", category: "general", body: "" },
    action: (values) => (article ? updateKbArticleAction({ ...values, id: article.id }) : createKbArticleAction(values)),
    successMessage: article ? (article.status === "published" ? "Saved and reindexed" : "Saved") : "Draft created",
    onSuccess: (d) => router.push(`/helpdesk/kb/${d.id}`),
  });
  return (
    <form onSubmit={submit} noValidate className="rounded-xl border bg-card p-5">
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <TextField control={form.control} name="title" label="Title" required />
          <TextField control={form.control} name="category" label="Category" placeholder="payroll" />
        </div>
        <TextareaField
          control={form.control}
          name="body"
          label="Article"
          rows={16}
          description="Markdown: # headings, **bold**, lists. Each heading becomes a citable section for the HR assistant."
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null} {article ? "Save" : "Create draft"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
