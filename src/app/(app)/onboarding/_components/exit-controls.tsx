"use client";

import { useRouter } from "next/navigation";
import { z } from "zod";
import { CalendarClock, ClipboardList, FileText, LogOut, MessageSquareQuote, PackageCheck, Send, ShieldOff, Undo2, UserX, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FieldGroup } from "@/components/ui/field";
import { FormDialog } from "@/components/forms/form-dialog";
import { CheckboxField, FormError, SelectField, SwitchField, TextField, TextareaField, type Option } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { ComboboxField } from "@/app/(app)/settings/_components/combobox-field";
import { ConfirmAction } from "@/app/(app)/settings/_components/run-action";
import { formatDate, todayIn } from "@/lib/format";
import {
  EXIT_REASON_CATEGORIES,
  EXIT_REASON_LABELS,
  EXIT_TYPE_LABELS,
  HR_EXIT_TYPES,
  INTERVIEW_RATING_KEYS,
  INTERVIEW_RATING_LABELS,
  RESIGNATION_REASONS,
  SETTLEMENT_LABELS,
  SHORTFALL_LABELS,
  SHORTFALL_TREATMENTS,
  cancelExitSchema,
  completeExitSchema,
  exitAssetReturnSchema,
  exitInterviewSchema,
  exitTermsSchema,
  hrExitSchema,
  resignationSchema,
  settlementInputsSchema,
} from "@/lib/validation/lifecycle";
import type { SettlementInputs } from "@/server/services/lifecycle/shared";
import type { StoredInterview } from "@/server/services/lifecycle/exits";
import {
  cancelExitAction,
  completeExitAction,
  generateLettersAction,
  initiateExitAction,
  returnExitAssetAction,
  saveExitInterviewAction,
  saveSettlementInputsAction,
  setSettlementStatusAction,
  submitResignationAction,
  suspendLoginAction,
  updateExitTermsAction,
  withdrawResignationAction,
} from "../actions";

const reasonOptions = (keys: readonly string[]): Option[] => keys.map((k) => ({ value: k, label: EXIT_REASON_LABELS[k as keyof typeof EXIT_REASON_LABELS] }));
const ratingOptions: Option[] = [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} · ${["", "Very poor", "Poor", "Average", "Good", "Excellent"][n]}` }));

/* ------------------------------------------------------------------ */
/* Employee self-service                                               */
/* ------------------------------------------------------------------ */

export function ResignationForm({ noticePeriodDays, defaultLastWorkingDate }: { noticePeriodDays: number; defaultLastWorkingDate: string }) {
  const { form, submit, pending } = useActionForm({
    schema: resignationSchema,
    defaultValues: { requestedLastWorkingDate: defaultLastWorkingDate, reasonCategory: undefined, reasonDetail: "" },
    action: submitResignationAction,
    successMessage: "Resignation submitted to your manager",
  });
  return (
    <form onSubmit={submit} noValidate className="max-w-xl">
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <TextField
          control={form.control}
          name="requestedLastWorkingDate"
          label="Requested last working day"
          type="date"
          required
          description={`Your notice period is ${noticePeriodDays} days, so the default is ${formatDate(defaultLastWorkingDate)}. An earlier date needs approval and may lead to a notice recovery.`}
        />
        <SelectField control={form.control} name="reasonCategory" label="Main reason" required options={reasonOptions(RESIGNATION_REASONS)} />
        <TextareaField control={form.control} name="reasonDetail" label="Anything you would like to add" rows={4} description="Shared with your manager and HR." />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : <Send />} Submit resignation
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

export function WithdrawResignationButton({ exitCaseId }: { exitCaseId: string }) {
  return (
    <ConfirmAction
      trigger={
        <Button size="sm" variant="outline">
          <Undo2 /> Withdraw resignation
        </Button>
      }
      title="Withdraw your resignation?"
      description="Your manager and HR will no longer be asked to approve it. You can resign again later."
      confirmLabel="Withdraw"
      action={withdrawResignationAction}
      input={{ exitCaseId }}
      success="Resignation withdrawn"
    />
  );
}

/* ------------------------------------------------------------------ */
/* HR                                                                  */
/* ------------------------------------------------------------------ */

export function InitiateExitDialog({ candidates }: { candidates: Option[] }) {
  const router = useRouter();
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline">
          <UserX /> Start an exit
        </Button>
      }
      title="Start an HR-initiated exit"
      description="Termination, end of contract, retirement and other separations are reviewed by HR approval before the employee is put on notice."
      schema={hrExitSchema}
      defaultValues={{ employeeId: "", type: undefined, lastWorkingDate: todayIn(), reasonCategory: undefined, reasonDetail: "", confirmation: "" }}
      action={initiateExitAction}
      submitLabel="Submit for approval"
      successMessage="Exit submitted for approval"
      onSuccess={(d) => router.push(`/onboarding/exits/${d.id}`)}
      destructive
      wide
    >
      {(form) => {
        const type = form.watch("type");
        const code = candidates.find((c) => c.value === form.watch("employeeId"))?.hint ?? null;
        return (
          <>
            <ComboboxField control={form.control} name="employeeId" label="Employee" options={candidates} placeholder="Choose an employee…" />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField control={form.control} name="type" label="Exit type" required options={HR_EXIT_TYPES.map((t) => ({ value: t, label: EXIT_TYPE_LABELS[t] }))} />
              <TextField control={form.control} name="lastWorkingDate" label="Last working day" type="date" required />
            </div>
            <SelectField control={form.control} name="reasonCategory" label="Reason" required options={reasonOptions(EXIT_REASON_CATEGORIES)} />
            <TextareaField control={form.control} name="reasonDetail" label="Details" required rows={3} description="Confidential to HR. Keep it factual." />
            {type === "termination" ? (
              <TextField
                control={form.control}
                name="confirmation"
                label={code ? `Type ${code} to confirm the termination` : "Type the employee code to confirm"}
                required
                autoComplete="off"
              />
            ) : null}
          </>
        );
      }}
    </FormDialog>
  );
}

export function ExitTermsDialog({ exitCaseId, lastWorkingDate, treatment, submittedOn }: { exitCaseId: string; lastWorkingDate: string | null; treatment: string; submittedOn: string }) {
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline">
          <CalendarClock /> Edit terms
        </Button>
      }
      title="Last working day and notice"
      description={`Submitted on ${formatDate(submittedOn)}. Open checklist due dates move with the last working day.`}
      schema={exitTermsSchema}
      defaultValues={{ exitCaseId, approvedLastWorkingDate: lastWorkingDate ?? todayIn(), shortfallTreatment: treatment as "none" }}
      action={updateExitTermsAction}
      successMessage="Exit terms updated"
    >
      {(form) => (
        <>
          <TextField control={form.control} name="approvedLastWorkingDate" label="Last working day" type="date" required />
          <SelectField
            control={form.control}
            name="shortfallTreatment"
            label="Notice shortfall"
            options={SHORTFALL_TREATMENTS.map((t) => ({ value: t, label: SHORTFALL_LABELS[t] }))}
            description="Applies when the notice served is shorter than the notice period."
          />
        </>
      )}
    </FormDialog>
  );
}

export function InterviewDialog({ exitCaseId, value }: { exitCaseId: string; value: StoredInterview | null }) {
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant={value ? "outline" : "default"}>
          <MessageSquareQuote /> {value ? "Edit interview" : "Record exit interview"}
        </Button>
      }
      title="Exit interview"
      description="Confidential to HR. Never shown to the employee or their manager."
      schema={exitInterviewSchema}
      defaultValues={{
        exitCaseId,
        conductedOn: value?.conductedOn ?? todayIn(),
        primaryReason: (value?.primaryReason as "other") ?? undefined,
        ratings: {
          role: value?.ratings?.role ?? 3,
          manager: value?.ratings?.manager ?? 3,
          growth: value?.ratings?.growth ?? 3,
          compensation: value?.ratings?.compensation ?? 3,
          culture: value?.ratings?.culture ?? 3,
          workLife: value?.ratings?.workLife ?? 3,
        },
        wouldRecommend: value?.wouldRecommend ?? false,
        regretted: value?.regretted ?? false,
        comments: value?.comments ?? "",
      }}
      action={saveExitInterviewAction}
      successMessage="Exit interview saved"
      wide
    >
      {(form) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField control={form.control} name="conductedOn" label="Conducted on" type="date" required />
            <SelectField control={form.control} name="primaryReason" label="Primary reason" required options={reasonOptions(EXIT_REASON_CATEGORIES)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {INTERVIEW_RATING_KEYS.map((k) => (
              <SelectField key={k} control={form.control} name={`ratings.${k}`} label={INTERVIEW_RATING_LABELS[k]} options={ratingOptions} />
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SwitchField control={form.control} name="wouldRecommend" label="Would recommend us" />
            <SwitchField control={form.control} name="regretted" label="Regretted loss" description="We would have wanted to keep this person." />
          </div>
          <TextareaField control={form.control} name="comments" label="Notes" rows={4} />
        </>
      )}
    </FormDialog>
  );
}

export function SettlementInputsDialog({
  exitCaseId,
  value,
  shortfallDays,
  treatment,
  leave,
  disabled,
}: {
  exitCaseId: string;
  value: SettlementInputs | null;
  shortfallDays: number;
  treatment: string;
  leave: { name: string; balance: number }[];
  disabled?: boolean;
}) {
  const earned = leave.reduce((s, l) => s + (l.name.toLowerCase().includes("earned") || l.name.toLowerCase().includes("privilege") ? l.balance : 0), 0);
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant={value ? "outline" : "default"} disabled={disabled}>
          <Wallet /> {value ? "Edit inputs" : "Prepare inputs"}
        </Button>
      }
      title="Settlement inputs"
      description="Inputs for payroll's full-and-final run. Amounts are computed by payroll; enter days and any other recoveries or payments here."
      schema={settlementInputsSchema}
      defaultValues={{
        exitCaseId,
        noticeRecoveryDays: value?.noticeRecoveryDays ?? (treatment === "recover" ? shortfallDays : 0),
        noticePayInLieuDays: value?.noticePayInLieuDays ?? 0,
        leaveEncashmentDays: value?.leaveEncashmentDays ?? earned,
        otherRecoveries: value ? value.otherRecoveries / 100 : 0,
        otherRecoveriesNote: value?.otherRecoveriesNote ?? "",
        otherPayments: value ? value.otherPayments / 100 : 0,
        otherPaymentsNote: value?.otherPaymentsNote ?? "",
        notes: value?.notes ?? "",
      }}
      action={saveSettlementInputsAction}
      successMessage="Settlement inputs saved"
      wide
    >
      {(form) => (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField control={form.control} name="noticeRecoveryDays" label="Notice recovery (days)" type="number" inputMode="numeric" description={shortfallDays ? `Shortfall: ${shortfallDays} days (${SHORTFALL_LABELS[treatment as "none"] ?? treatment})` : undefined} />
            <TextField control={form.control} name="noticePayInLieuDays" label="Notice pay in lieu (days)" type="number" inputMode="numeric" />
            <TextField control={form.control} name="leaveEncashmentDays" label="Leave encashment (days)" type="number" inputMode="decimal" description={leave.length ? "Pre-filled from earned leave balance." : "No leave balances on record."} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField control={form.control} name="otherRecoveries" label="Other recoveries (₹)" type="number" inputMode="decimal" />
            <TextField control={form.control} name="otherRecoveriesNote" label="Recovery details" placeholder="Loan balance, unreturned asset…" />
            <TextField control={form.control} name="otherPayments" label="Other payments (₹)" type="number" inputMode="decimal" />
            <TextField control={form.control} name="otherPaymentsNote" label="Payment details" placeholder="Pending reimbursement, bonus…" />
          </div>
          <TextareaField control={form.control} name="notes" label="Notes for payroll" rows={3} />
        </>
      )}
    </FormDialog>
  );
}

const SETTLEMENT_ACTIONS: Record<string, { status: "draft" | "pending_approval" | "approved" | "paid"; label: string; description: string; needs: "manage" | "approve" | "either" }[]> = {
  not_started: [{ status: "draft", label: "Start draft", description: "Marks the settlement as being prepared from the saved inputs.", needs: "manage" }],
  draft: [{ status: "pending_approval", label: "Submit for approval", description: "Inputs are locked and payroll approvers are notified.", needs: "manage" }],
  pending_approval: [
    { status: "approved", label: "Approve settlement", description: "Approves the full-and-final settlement for payment.", needs: "approve" },
    { status: "draft", label: "Send back to draft", description: "Unlocks the inputs for changes.", needs: "either" },
  ],
  approved: [{ status: "paid", label: "Mark as paid", description: "Records that the settlement amount was paid out.", needs: "approve" }],
  paid: [],
};

export function SettlementStatusActions({ exitCaseId, status, canManage, canApprove, hasInputs }: { exitCaseId: string; status: string; canManage: boolean; canApprove: boolean; hasInputs: boolean }) {
  if (status === "not_started" && !hasInputs) return null;
  const actions = (SETTLEMENT_ACTIONS[status] ?? []).filter((a) => (a.needs === "manage" ? canManage : a.needs === "approve" ? canApprove : canManage || canApprove));
  if (!actions.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) => (
        <ConfirmAction
          key={a.status}
          trigger={
            <Button size="sm" variant={a.status === "draft" && status === "pending_approval" ? "ghost" : "outline"}>
              <ClipboardList /> {a.label}
            </Button>
          }
          title={`${a.label}?`}
          description={`${a.description} New status: ${SETTLEMENT_LABELS[a.status]}.`}
          confirmLabel={a.label}
          action={setSettlementStatusAction}
          input={{ exitCaseId, status: a.status, confirm: true as const }}
          success={`Settlement: ${SETTLEMENT_LABELS[a.status]}`}
        />
      ))}
    </div>
  );
}

const lettersSchema = z
  .object({ exitCaseId: z.uuid(), experience: z.boolean(), relieving: z.boolean() })
  .refine((v) => v.experience || v.relieving, { path: ["experience"], message: "Choose at least one letter" });

export function GenerateLettersDialog({ exitCaseId, hasLetters, visibleNow }: { exitCaseId: string; hasLetters: boolean; visibleNow: boolean }) {
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant={hasLetters ? "outline" : "default"}>
          <FileText /> {hasLetters ? "Regenerate letters" : "Generate letters"}
        </Button>
      }
      title="Experience and relieving letters"
      description={
        visibleNow
          ? "Letters are generated as PDFs from your letter templates and are visible to the employee."
          : "Letters are generated as PDFs from your letter templates. They stay HR-only until the last working day."
      }
      schema={lettersSchema}
      defaultValues={{ exitCaseId, experience: true, relieving: true }}
      action={(v) => generateLettersAction({ exitCaseId: v.exitCaseId, kinds: [...(v.experience ? (["experience"] as const) : []), ...(v.relieving ? (["relieving"] as const) : [])] })}
      submitLabel="Generate"
      successMessage={(d) => `${d.count} ${d.count === 1 ? "letter" : "letters"} generated`}
    >
      {(form) => (
        <>
          <CheckboxField control={form.control} name="experience" label="Experience letter" />
          <CheckboxField control={form.control} name="relieving" label="Relieving letter" />
          {hasLetters ? <p className="text-xs text-muted-foreground">The previous version is kept in the document history.</p> : null}
        </>
      )}
    </FormDialog>
  );
}

export function ReturnAssetDialog({ exitCaseId, assignmentId, label }: { exitCaseId: string; assignmentId: string; label: string }) {
  return (
    <FormDialog
      trigger={
        <Button size="xs" variant="outline">
          <PackageCheck /> Record return
        </Button>
      }
      title={`Return ${label}`}
      schema={exitAssetReturnSchema}
      defaultValues={{ exitCaseId, assignmentId, condition: "" }}
      action={returnExitAssetAction}
      submitLabel="Record return"
      successMessage="Asset return recorded"
    >
      {(form) => <TextField control={form.control} name="condition" label="Condition on return" placeholder="Good, minor scratches…" />}
    </FormDialog>
  );
}

export function SuspendLoginButton({ exitCaseId, name }: { exitCaseId: string; name: string }) {
  return (
    <ConfirmAction
      trigger={
        <Button size="sm" variant="outline" className="text-danger">
          <ShieldOff /> Suspend login
        </Button>
      }
      title={`Suspend ${name}'s login?`}
      description="They will be signed out of PeopleSuccess and cannot sign in until reactivated in Settings → Users. Other systems are not affected."
      confirmLabel="Suspend login"
      destructive
      action={suspendLoginAction}
      input={{ exitCaseId, confirm: true as const }}
      success="Login suspended"
    />
  );
}

export function CompleteExitDialog({ exitCaseId, name, blockers, reason }: { exitCaseId: string; name: string; blockers: string[]; reason: string | null }) {
  const blocked = blockers.length > 0;
  return (
    <FormDialog
      trigger={
        <Button size="sm" disabled={blocked} title={blocked ? blockers.join(" ") : undefined}>
          <LogOut /> Complete exit
        </Button>
      }
      title={`Complete ${name}'s exit`}
      description="Marks the employee as exited from the last working day and closes their current employment record. History is kept."
      schema={completeExitSchema}
      defaultValues={{ exitCaseId, eligibleForRehire: true, exitReason: reason ?? "", confirm: false as unknown as true }}
      action={completeExitAction}
      submitLabel="Complete exit"
      successMessage="Exit completed"
      destructive
    >
      {(form) => (
        <>
          <TextField control={form.control} name="exitReason" label="Exit reason (for records)" />
          <SwitchField control={form.control} name="eligibleForRehire" label="Eligible for rehire" />
          <CheckboxField control={form.control} name="confirm" label={`I confirm ${name} has exited`} />
        </>
      )}
    </FormDialog>
  );
}

export function CancelExitDialog({ exitCaseId }: { exitCaseId: string }) {
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="ghost" className="text-danger">
          <Undo2 /> Cancel exit
        </Button>
      }
      title="Cancel this exit?"
      description="The employee returns to active, the last working day is cleared and open checklist tasks are cancelled."
      schema={cancelExitSchema}
      defaultValues={{ exitCaseId, reason: "" }}
      action={cancelExitAction}
      submitLabel="Cancel exit"
      successMessage="Exit cancelled"
      destructive
    >
      {(form) => <TextareaField control={form.control} name="reason" label="Reason" required rows={3} />}
    </FormDialog>
  );
}

