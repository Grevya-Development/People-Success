"use client";

import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FormDialog } from "@/components/forms/form-dialog";
import { SwitchField, TextField } from "@/components/forms/fields";
import { useRunAction } from "@/components/documents/use-run-action";
import { rewardPolicySchema } from "@/lib/validation/recruitment";
import { decideRewardAction, saveRewardPolicyAction } from "./actions";

export function RewardActions({ referralId, rewardStatus }: { referralId: string; rewardStatus: string }) {
  const { pending, run } = useRunAction();
  const done = (d: { status: string; awaitingPeriod: boolean }) => {
    if (d.awaitingPeriod) toast.info("Approved. It will be posted to payroll when the referrer's next payroll period opens.");
    else toast.success(d.status === "paid" ? "Reward posted to payroll" : "Updated");
  };
  if (rewardStatus === "eligible") {
    return (
      <div className="flex justify-end gap-1">
        <Button size="xs" disabled={pending} onClick={() => run(() => decideRewardAction({ referralId, action: "approve" }), { onSuccess: done })}>
          {pending ? <Spinner /> : null}
          Approve
        </Button>
        <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => decideRewardAction({ referralId, action: "cancel" }), { success: "Reward cancelled" })}>
          Cancel
        </Button>
      </div>
    );
  }
  if (rewardStatus === "approved") {
    return (
      <div className="flex justify-end gap-1">
        <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => decideRewardAction({ referralId, action: "post_to_payroll" }), { onSuccess: done })}>
          {pending ? <Spinner /> : null}
          Post to payroll
        </Button>
        <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => decideRewardAction({ referralId, action: "mark_paid" }), { success: "Marked as paid" })}>
          Mark paid
        </Button>
      </div>
    );
  }
  return null;
}

type Policy = { id: string; name: string; amount: number; eligibleAfterDays: number; isActive: boolean };

export function PolicyDialog({ policy }: { policy?: Policy }) {
  return (
    <FormDialog
      trigger={
        policy ? (
          <Button size="icon-sm" variant="ghost" aria-label={`Edit ${policy.name}`}>
            <Pencil />
          </Button>
        ) : (
          <Button size="sm" variant="outline">
            <Plus /> Reward policy
          </Button>
        )
      }
      title={policy ? "Edit reward policy" : "New reward policy"}
      description="The newest active policy applies to referrals hired from now on. Rewards become eligible after the hire has stayed this many days."
      schema={rewardPolicySchema}
      defaultValues={{
        id: policy?.id ?? null,
        name: policy?.name ?? "Employee referral bonus",
        amount: (policy ? policy.amount / 100 : "") as unknown as number,
        eligibleAfterDays: policy?.eligibleAfterDays ?? 90,
        isActive: policy?.isActive ?? true,
      }}
      action={saveRewardPolicyAction}
      submitLabel="Save policy"
      successMessage="Reward policy saved"
    >
      {(form) => (
        <>
          <TextField control={form.control} name="name" label="Name" required />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField control={form.control} name="amount" label="Reward (₹)" inputMode="decimal" required />
            <TextField control={form.control} name="eligibleAfterDays" label="Eligible after (days)" type="number" inputMode="numeric" />
          </div>
          <SwitchField control={form.control} name="isActive" label="Active" />
        </>
      )}
    </FormDialog>
  );
}
