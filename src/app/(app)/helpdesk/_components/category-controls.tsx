"use client";

import type { UseFormReturn } from "react-hook-form";
import { Pencil, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, SwitchField, TextField, TextareaField } from "@/components/forms/fields";
import { useRunAction } from "@/components/documents/use-run-action";
import { OWNER_ROLE_KEYS, OWNER_ROLE_LABELS, ticketCategorySchema, type TicketCategoryInput } from "@/lib/validation/helpdesk";
import { createTicketCategoryAction, seedTicketCategoriesAction, updateTicketCategoryAction } from "../actions";

function Fields({ form }: { form: UseFormReturn<TicketCategoryInput> }) {
  const c = form.control;
  return (
    <>
      <TextField control={c} name="name" label="Name" required />
      <TextareaField control={c} name="description" label="Description" rows={2} description="Shown to employees when they raise a ticket." />
      <SelectField
        control={c}
        name="ownerRoleKey"
        label="Owned by role"
        required
        options={OWNER_ROLE_KEYS.map((k) => ({ value: k, label: OWNER_ROLE_LABELS[k] }))}
        description="New tickets are assigned round-robin to people with this role."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={c} name="firstResponseHours" label="First response (hours)" type="number" inputMode="numeric" />
        <TextField control={c} name="resolutionHours" label="Resolution (hours)" type="number" inputMode="numeric" />
      </div>
      <SwitchField control={c} name="isSensitive" label="Confidential" description="Only helpdesk managers (and the requester) can see these tickets. Never sent to AI." />
      <SwitchField control={c} name="isActive" label="Active" />
    </>
  );
}

export type TicketCategoryValues = TicketCategoryInput & { id: string };

export function CategoryDialog({ category }: { category?: TicketCategoryValues }) {
  const defaults: TicketCategoryInput = category
    ? { name: category.name, description: category.description, ownerRoleKey: category.ownerRoleKey, firstResponseHours: category.firstResponseHours, resolutionHours: category.resolutionHours, isSensitive: category.isSensitive, isActive: category.isActive }
    : { name: "", description: null, ownerRoleKey: "hr_admin", firstResponseHours: 8, resolutionHours: 48, isSensitive: false, isActive: true };
  return (
    <FormDialog
      trigger={
        category ? (
          <Button size="icon-sm" variant="ghost" aria-label={`Edit ${category.name}`}>
            <Pencil />
          </Button>
        ) : (
          <Button size="sm">
            <Plus data-icon="inline-start" /> New category
          </Button>
        )
      }
      title={category ? `Edit ${category.name}` : "New ticket category"}
      description="SLA times are calendar hours from when the ticket is raised."
      schema={ticketCategorySchema}
      defaultValues={defaults}
      action={(values) => (category ? updateTicketCategoryAction({ ...values, id: category.id }) : createTicketCategoryAction(values))}
      successMessage={category ? "Category saved" : "Category created"}
    >
      {(form) => <Fields form={form} />}
    </FormDialog>
  );
}

export function SeedTicketCategoriesButton({ variant = "outline" }: { variant?: "outline" | "default" }) {
  const { pending, run } = useRunAction();
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={pending}
      onClick={() => run(() => seedTicketCategoriesAction({}), { success: (r) => (r.added ? `Added ${r.added} default categories` : "All default categories already exist") })}
    >
      {pending ? <Spinner /> : <Sparkles data-icon="inline-start" />} Add default categories
    </Button>
  );
}
