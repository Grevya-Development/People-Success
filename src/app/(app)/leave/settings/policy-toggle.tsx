"use client";

import { Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/app/(app)/settings/_components/run-action";
import { setLeavePolicyActiveAction } from "../actions";

export function PolicyToggle({ id, isActive, name }: { id: string; isActive: boolean; name: string }) {
  return (
    <ConfirmAction
      trigger={
        <Button variant="ghost" size="sm">
          <Power /> {isActive ? "Deactivate" : "Activate"}
        </Button>
      }
      title={`${isActive ? "Deactivate" : "Activate"} ${name}?`}
      description={isActive ? "Employees it covers stop accruing under it and cannot apply against it until another policy matches." : "All versions become active again."}
      confirmLabel={isActive ? "Deactivate" : "Activate"}
      destructive={isActive}
      action={setLeavePolicyActiveAction}
      input={{ id, isActive: !isActive }}
      success={isActive ? "Policy deactivated" : "Policy activated"}
    />
  );
}
