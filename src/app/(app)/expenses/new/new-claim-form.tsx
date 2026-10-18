"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError, SelectField, TextField } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { REIMBURSEMENT_METHODS, REIMBURSEMENT_METHOD_LABELS, createClaimSchema } from "@/lib/validation/expenses";
import { createClaimAction } from "../actions";

export function NewClaimForm() {
  const router = useRouter();
  const { form, submit, pending } = useActionForm({
    schema: createClaimSchema,
    defaultValues: { title: "", reimbursementMethod: "payroll" },
    action: createClaimAction,
    successMessage: (d) => `Draft ${d.number} created`,
    onSuccess: (d) => router.push(`/expenses/${d.id}`),
  });
  return (
    <form onSubmit={submit} noValidate className="rounded-xl border bg-card p-5">
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <TextField control={form.control} name="title" label="Claim name" required placeholder="Client visit to Pune, Oct 2026" />
        <SelectField
          control={form.control}
          name="reimbursementMethod"
          label="Reimbursement"
          required
          options={REIMBURSEMENT_METHODS.map((m) => ({ value: m, label: REIMBURSEMENT_METHOD_LABELS[m] }))}
          description="With salary: added to the next open payroll period after approval. Bank transfer: paid by finance."
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null} Create draft
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
