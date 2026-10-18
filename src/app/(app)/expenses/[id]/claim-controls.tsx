"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Pencil, Plus, Send, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { FormDialog } from "@/components/forms/form-dialog";
import { FormError, SelectField, TextField } from "@/components/forms/fields";
import { useRunAction } from "@/components/documents/use-run-action";
import { ACCEPT_ATTRIBUTE, MAX_UPLOAD_BYTES } from "@/lib/validation/documents";
import { REIMBURSEMENT_METHODS, REIMBURSEMENT_METHOD_LABELS, markReimbursedSchema, updateClaimSchema, type ReimbursementMethod } from "@/lib/validation/expenses";
import { formatMoney } from "@/lib/format";
import {
  addClaimItemAction,
  cancelClaimAction,
  markReimbursedAction,
  removeClaimItemAction,
  submitClaimAction,
  updateClaimAction,
  withdrawClaimAction,
} from "../actions";

type Category = { id: string; name: string; maxPerItem: number | null; receiptRequiredAbove: number };

export function AddItemDialog({ claimId, categories, today }: { claimId: string; categories: Category[]; today: string }) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [spentOn, setSpentOn] = useState(today);
  const [merchant, setMerchant] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [root, setRoot] = useState<string>();
  const [pending, start] = useTransition();
  const category = categories.find((c) => c.id === categoryId);

  const reset = () => {
    setCategoryId("");
    setSpentOn(today);
    setMerchant("");
    setDescription("");
    setAmount("");
    setFile(null);
    setErrors({});
    setRoot(undefined);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setRoot(undefined);
    const next: Record<string, string> = {};
    if (!categoryId) next.categoryId = "Choose a category";
    if (!description.trim()) next.description = "Describe the expense";
    if (!/^\d[\d,]*(\.\d{1,2})?$/.test(amount.trim())) next.amount = "Enter an amount in rupees, e.g. 1250.50";
    if (file && file.size > MAX_UPLOAD_BYTES) next.receipt = "Files can be at most 25 MB";
    setErrors(next);
    if (Object.keys(next).length) return;
    const fd = new FormData();
    fd.set("claimId", claimId);
    fd.set("categoryId", categoryId);
    fd.set("spentOn", spentOn);
    fd.set("merchant", merchant);
    fd.set("description", description);
    fd.set("amount", amount);
    if (file) fd.set("receipt", file);
    start(async () => {
      try {
        const r = await addClaimItemAction(fd);
        if (r.ok) {
          if (r.data.violations.length) toast.warning(`Added with ${r.data.violations.length} policy flag(s): ${r.data.violations[0]}`);
          else toast.success("Expense added");
          reset();
          setOpen(false);
        } else {
          setErrors(Object.fromEntries(Object.entries(r.error.fieldErrors ?? {}).map(([k, v]) => [k, v[0]])));
          setRoot(r.error.message);
        }
      } catch {
        setRoot("The expense could not be sent. The receipt may be too large, or the connection dropped.");
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && pending) return;
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus data-icon="inline-start" /> Add expense
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Add expense</DialogTitle>
            <DialogDescription>Policy checks run as you add each expense. Limits are flagged to approvers; missing receipts must be fixed before submitting.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="max-h-[65vh] overflow-y-auto px-0.5 py-5">
            <FormError message={root} />
            <Field data-invalid={!!errors.categoryId}>
              <FieldLabel htmlFor={`${id}-cat`}>Category</FieldLabel>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger id={`${id}-cat`} className="w-full" aria-invalid={!!errors.categoryId}>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {category ? (
                <FieldDescription>
                  {category.maxPerItem != null ? `Limit ${formatMoney(category.maxPerItem)} per item. ` : ""}
                  {category.receiptRequiredAbove ? `Receipt needed above ${formatMoney(category.receiptRequiredAbove)}.` : "Receipt always needed."}
                </FieldDescription>
              ) : null}
              <FieldError>{errors.categoryId}</FieldError>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!errors.spentOn}>
                <FieldLabel htmlFor={`${id}-date`}>Date</FieldLabel>
                <Input id={`${id}-date`} type="date" value={spentOn} max={today} onChange={(e) => setSpentOn(e.target.value)} />
                <FieldError>{errors.spentOn}</FieldError>
              </Field>
              <Field data-invalid={!!errors.amount}>
                <FieldLabel htmlFor={`${id}-amt`}>Amount (₹)</FieldLabel>
                <Input id={`${id}-amt`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!errors.amount} placeholder="1250.00" />
                <FieldError>{errors.amount}</FieldError>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor={`${id}-merchant`}>Merchant</FieldLabel>
              <Input id={`${id}-merchant`} value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Uber, Taj Hotels…" />
            </Field>
            <Field data-invalid={!!errors.description}>
              <FieldLabel htmlFor={`${id}-desc`}>Description</FieldLabel>
              <Input id={`${id}-desc`} value={description} onChange={(e) => setDescription(e.target.value)} aria-invalid={!!errors.description} placeholder="Cab from airport to client office" />
              <FieldError>{errors.description}</FieldError>
            </Field>
            <Field data-invalid={!!errors.receipt || !!errors.file}>
              <FieldLabel htmlFor={`${id}-file`}>Receipt</FieldLabel>
              <Input id={`${id}-file`} ref={fileRef} type="file" accept={ACCEPT_ATTRIBUTE} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <FieldDescription>PDF or image, up to 25 MB. Stored privately; visible to you, your approvers and finance.</FieldDescription>
              <FieldError>{errors.receipt ?? errors.file}</FieldError>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null} Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveItemButton({ id, label }: { id: string; label: string }) {
  const { pending, run } = useRunAction();
  return (
    <Button size="icon-sm" variant="ghost" aria-label={`Remove ${label}`} disabled={pending} onClick={() => run(() => removeClaimItemAction({ id }), { success: "Expense removed" })}>
      {pending ? <Spinner /> : <X />}
    </Button>
  );
}

export function EditClaimButton({ id, title, reimbursementMethod }: { id: string; title: string; reimbursementMethod: ReimbursementMethod }) {
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="ghost">
          <Pencil data-icon="inline-start" /> Edit
        </Button>
      }
      title="Edit claim"
      schema={updateClaimSchema.omit({ id: true })}
      defaultValues={{ title, reimbursementMethod }}
      action={(v) => updateClaimAction({ ...v, id })}
      successMessage="Claim updated"
    >
      {(form) => (
        <>
          <TextField control={form.control} name="title" label="Claim name" required />
          <SelectField
            control={form.control}
            name="reimbursementMethod"
            label="Reimbursement"
            options={REIMBURSEMENT_METHODS.map((m) => ({ value: m, label: REIMBURSEMENT_METHOD_LABELS[m] }))}
          />
        </>
      )}
    </FormDialog>
  );
}

export function SubmitClaimButton({ id, total }: { id: string; total: number }) {
  const { pending, run } = useRunAction();
  return (
    <Button size="sm" disabled={pending} onClick={() => run(() => submitClaimAction({ id }), { success: `Submitted ${formatMoney(total)} for approval` })}>
      {pending ? <Spinner /> : <Send data-icon="inline-start" />} Submit for approval
    </Button>
  );
}

export function WithdrawClaimButton({ id }: { id: string }) {
  const { pending, run } = useRunAction();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={pending}>
          <Undo2 data-icon="inline-start" /> Withdraw
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Withdraw this claim?</AlertDialogTitle>
          <AlertDialogDescription>The approval is cancelled and the claim goes back to draft so you can edit and resubmit it.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={() => run(() => withdrawClaimAction({ id }), { success: "Claim withdrawn to draft" })}>Withdraw</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function CancelClaimButton({ id }: { id: string }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" disabled={pending}>
          <Trash2 data-icon="inline-start" /> Discard draft
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
          <AlertDialogDescription>The claim is marked cancelled and can no longer be submitted.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => run(() => cancelClaimAction({ id }), { success: "Draft discarded", onSuccess: () => router.push("/expenses") })}>
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function MarkReimbursedButton({ id, total }: { id: string; total: number }) {
  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <Banknote data-icon="inline-start" /> Mark reimbursed
        </Button>
      }
      title="Record bank transfer"
      description={`Confirm that ${formatMoney(total)} was paid to the employee.`}
      schema={markReimbursedSchema.omit({ id: true })}
      defaultValues={{ paymentReference: "" }}
      action={(v) => markReimbursedAction({ ...v, id })}
      successMessage="Marked reimbursed"
      submitLabel="Mark reimbursed"
    >
      {(form) => <TextField control={form.control} name="paymentReference" label="UTR / payment reference" required />}
    </FormDialog>
  );
}
