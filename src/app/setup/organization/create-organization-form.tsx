"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError, SelectField, TextField } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { createOrganizationInput } from "@/lib/validation/tenancy";
import { INDIAN_STATES, MONTHS } from "@/lib/india";
import { createOrganizationAction } from "../actions";

export function CreateOrganizationForm({ hasExisting }: { hasExisting: boolean }) {
  const router = useRouter();
  const { form, submit, pending } = useActionForm({
    schema: createOrganizationInput,
    defaultValues: { name: "", legalName: "", stateCode: "", fiscalYearStartMonth: 4, timezone: "Asia/Kolkata" },
    action: createOrganizationAction,
    successMessage: "Organization created",
    onSuccess: () => {
      router.replace("/setup");
      router.refresh();
    },
  });

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <TextField control={form.control} name="name" label="Organization name" placeholder="Acme Technologies" required />
        <TextField
          control={form.control}
          name="legalName"
          label="Registered legal name"
          placeholder="Acme Technologies Private Limited"
          description="As it appears on your incorporation certificate. Used on payslips and letters."
          required
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField
            control={form.control}
            name="stateCode"
            label="Registered state"
            options={INDIAN_STATES.map((s) => ({ value: s.code, label: s.name }))}
            description="Drives professional tax and labour welfare rules."
            required
          />
          <SelectField
            control={form.control}
            name="fiscalYearStartMonth"
            label="Financial year starts"
            options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
          />
        </div>
        <div className="flex items-center justify-between gap-3 pt-2">
          {hasExisting ? (
            <Button variant="ghost" asChild>
              <Link href="/overview">Cancel</Link>
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? <Spinner /> : null}
            Create organization
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
