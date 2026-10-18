"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/app/(app)/settings/_components/run-action";
import { addStandardLeaveTypesAction } from "../actions";

export function StandardTypesButton({ variant = "default" }: { variant?: "default" | "outline" }) {
  return (
    <ConfirmAction
      trigger={
        <Button size="sm" variant={variant}>
          <Sparkles /> Add standard leave types
        </Button>
      }
      title="Add standard leave types?"
      description="Adds Earned (EL), Casual (CL), Sick (SL), Comp off (CO), Loss of pay (LOP), Maternity (ML), Paternity (PTL) and Bereavement (BRV) with default policies marked “review”. Types you already have (same code) are skipped. The defaults are common starting points, not a statement of statutory compliance: Shops & Establishments rules vary by state."
      confirmLabel="Add types"
      action={addStandardLeaveTypesAction}
      input={{}}
      success="Standard leave types added"
    />
  );
}
