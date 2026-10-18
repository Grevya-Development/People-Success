"use client";

import Link from "next/link";
import { Pause, Pencil, Play, Plus, Send, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionButton, ReasonDialog } from "../../_components/client";
import { createPositionForRequisitionAction, submitRequisitionAction, transitionRequisitionAction } from "../../actions";

type R = {
  id: string;
  status: string;
  canEdit: boolean;
  canSubmit: boolean;
  canWithdraw: boolean;
  canManageStatus: boolean;
  canCreateOpening: boolean;
  canCreatePosition: boolean;
};

export function RequisitionActions({ r }: { r: R }) {
  const cancellable = r.canManageStatus && ["draft", "pending_approval", "approved", "on_hold", "rejected"].includes(r.status);
  return (
    <>
      {r.canEdit ? (
        <Button size="sm" variant="outline" asChild>
          <Link href={`/recruitment/requisitions/${r.id}?edit=1`}>
            <Pencil /> Edit
          </Link>
        </Button>
      ) : null}
      {r.canSubmit ? (
        <ActionButton action={submitRequisitionAction} input={{ id: r.id }} variant="default" success="Submitted for approval">
          <Send /> Submit for approval
        </ActionButton>
      ) : null}
      {r.canWithdraw ? (
        <ActionButton
          action={transitionRequisitionAction}
          input={{ id: r.id, to: "draft" as const, reason: null }}
          success="Withdrawn from approval"
          confirm={{ title: "Withdraw from approval?", description: "The approval request is cancelled and the requisition goes back to draft so you can edit it.", label: "Withdraw" }}
        >
          <Undo2 /> Withdraw
        </ActionButton>
      ) : null}
      {r.canManageStatus && r.status === "approved" ? (
        <ActionButton
          action={transitionRequisitionAction}
          input={{ id: r.id, to: "on_hold" as const, reason: null }}
          success="Requisition on hold"
          confirm={{ title: "Put this requisition on hold?", description: "Published jobs from it are paused until you resume.", label: "Put on hold" }}
        >
          <Pause /> Hold
        </ActionButton>
      ) : null}
      {r.canManageStatus && r.status === "on_hold" ? (
        <ActionButton action={transitionRequisitionAction} input={{ id: r.id, to: "approved" as const, reason: null }} success="Requisition resumed">
          <Play /> Resume
        </ActionButton>
      ) : null}
      {r.canCreatePosition ? (
        <ActionButton
          action={createPositionForRequisitionAction}
          input={{ id: r.id }}
          success="Position created"
          confirm={{ title: "Create a position?", description: "Adds an open position in Organization for this role and links it to the requisition. The hire fills it on joining.", label: "Create position" }}
        >
          <Plus /> Create position
        </ActionButton>
      ) : null}
      {cancellable ? (
        <ReasonDialog
          trigger={
            <Button size="sm" variant="ghost">
              <X /> Cancel requisition
            </Button>
          }
          title="Cancel this requisition?"
          description="Open jobs from it are closed. This cannot be undone."
          label="Reason"
          confirmLabel="Cancel requisition"
          destructive
          run={(reason) => transitionRequisitionAction({ id: r.id, to: "cancelled", reason })}
          success="Requisition cancelled"
        />
      ) : null}
      {r.canCreateOpening ? (
        <Button size="sm" asChild>
          <Link href={`/recruitment/openings/new?requisition=${r.id}`}>
            <Plus /> Open a job
          </Link>
        </Button>
      ) : null}
    </>
  );
}
