"use client";

import { Pencil, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FormDialog } from "@/components/forms/form-dialog";
import { SwitchField, TextField } from "@/components/forms/fields";
import { useRunAction } from "@/components/documents/use-run-action";
import type { UseFormReturn } from "react-hook-form";
import { expenseCategorySchema, paiseToRupees, type ExpenseCategoryInput } from "@/lib/validation/expenses";
import { createExpenseCategoryAction, seedExpenseCategoriesAction, updateExpenseCategoryAction } from "../actions";

export type CategoryValues = {
  id: string;
  name: string;
  code: string;
  maxPerItem: number | null;
  maxPerMonth: number | null;
  receiptRequiredAbove: number;
  glCode: string | null;
  isTaxable: boolean;
  isActive: boolean;
};

function Fields({ form }: { form: UseFormReturn<ExpenseCategoryInput> }) {
  const c = form.control;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
        <TextField control={c} name="name" label="Name" required />
        <TextField control={c} name="code" label="Code" required placeholder="TRAVEL" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField control={c} name="maxPerItem" label="Per-item limit (₹)" inputMode="decimal" description="Blank = no limit" />
        <TextField control={c} name="maxPerMonth" label="Monthly limit (₹)" inputMode="decimal" description="Per employee" />
        <TextField control={c} name="receiptRequiredAbove" label="Receipt above (₹)" inputMode="decimal" description="0 = always" />
      </div>
      <TextField control={c} name="glCode" label="GL code" placeholder="6100" />
      <SwitchField control={c} name="isTaxable" label="Taxable reimbursement" description="Posted to payroll as a taxable input." />
      <SwitchField control={c} name="isActive" label="Active" description="Inactive categories cannot be used on new items." />
    </>
  );
}

export function NewCategoryButton() {
  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <Plus data-icon="inline-start" /> New category
        </Button>
      }
      title="New expense category"
      schema={expenseCategorySchema}
      defaultValues={{ name: "", code: "", maxPerItem: null, maxPerMonth: null, receiptRequiredAbove: 0, glCode: null, isTaxable: false, isActive: true }}
      action={createExpenseCategoryAction}
      successMessage="Category created"
      submitLabel="Create"
    >
      {(form) => <Fields form={form} />}
    </FormDialog>
  );
}

export function EditCategoryButton({ category }: { category: CategoryValues }) {
  return (
    <FormDialog
      trigger={
        <Button size="icon-sm" variant="ghost" aria-label={`Edit ${category.name}`}>
          <Pencil />
        </Button>
      }
      title={`Edit ${category.name}`}
      schema={expenseCategorySchema}
      defaultValues={{
        name: category.name,
        code: category.code,
        maxPerItem: paiseToRupees(category.maxPerItem),
        maxPerMonth: paiseToRupees(category.maxPerMonth),
        receiptRequiredAbove: paiseToRupees(category.receiptRequiredAbove) ?? 0,
        glCode: category.glCode,
        isTaxable: category.isTaxable,
        isActive: category.isActive,
      }}
      action={(values) => updateExpenseCategoryAction({ ...values, id: category.id })}
      successMessage="Category saved"
    >
      {(form) => <Fields form={form} />}
    </FormDialog>
  );
}

export function SeedCategoriesButton({ variant = "outline" }: { variant?: "outline" | "default" }) {
  const { pending, run } = useRunAction();
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={pending}
      onClick={() =>
        run(() => seedExpenseCategoriesAction({}), {
          success: (r) => (r.added ? `Added ${r.added} standard categories` : "All standard categories already exist"),
        })
      }
    >
      {pending ? <Spinner /> : <Sparkles data-icon="inline-start" />} Add standard categories
    </Button>
  );
}
