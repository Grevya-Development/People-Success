"use client";

import { useState } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ASSISTANT_DISCLAIMER } from "@/lib/validation/helpdesk";
import { AssistantPanel } from "./assistant-panel";

/** Header entry point for the HR assistant (rendered only for users with ai.use). */
export function AssistantButton() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground" aria-label="Ask the HR assistant">
              <MessageCircleQuestion className="size-4" />
              <span className="hidden md:inline">Ask HR</span>
            </Button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent>HR assistant — answers from your company&apos;s policies</TooltipContent>
      </Tooltip>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md" aria-describedby="assistant-disclaimer">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-base">HR assistant</SheetTitle>
          <SheetDescription id="assistant-disclaimer" className="text-xs">
            {ASSISTANT_DISCLAIMER}
          </SheetDescription>
        </SheetHeader>
        {open ? <AssistantPanel onNavigate={() => setOpen(false)} /> : null}
      </SheetContent>
    </Sheet>
  );
}
