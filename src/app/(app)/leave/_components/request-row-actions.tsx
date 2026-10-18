"use client";

import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/app/(app)/settings/_components/run-action";
import { cancelLeaveAction } from "../actions";

export function CancelLeaveButton({ requestId, status, label = "Cancel", size = "sm" }: { requestId: string; status: string; label?: string; size?: "sm" | "default" }) {
  return (
    <ConfirmAction
      trigger={
        <Button variant="ghost" size={size}>
          <XCircle /> {label}
        </Button>
      }
      title={status === "pending" ? "Withdraw this leave request?" : "Cancel this approved leave?"}
      description={
        status === "pending"
          ? "The approval request is withdrawn and the pending days are released."
          : "The days are credited back to the balance and attendance is recalculated for these dates."
      }
      confirmLabel={status === "pending" ? "Withdraw" : "Cancel leave"}
      destructive
      action={cancelLeaveAction}
      input={{ requestId, reason: null }}
      success={status === "pending" ? "Request withdrawn" : "Leave cancelled and balance restored"}
    />
  );
}
