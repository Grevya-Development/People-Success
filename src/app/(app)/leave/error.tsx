"use client";

import { ErrorState, Page } from "@/components/page";
import { Button } from "@/components/ui/button";

export default function LeaveError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Page>
      <ErrorState
        title="Could not load leave"
        action={
          <Button variant="outline" onClick={() => reset()}>
            Try again
          </Button>
        }
      />
    </Page>
  );
}
