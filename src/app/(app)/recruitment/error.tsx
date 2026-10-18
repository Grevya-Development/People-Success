"use client";

import { Page, ErrorState } from "@/components/page";
import { Button } from "@/components/ui/button";

export default function RecruitmentError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Page>
      <ErrorState
        description="Something went wrong while loading recruitment. Please try again."
        action={
          <Button size="sm" variant="outline" onClick={reset}>
            Try again
          </Button>
        }
      />
    </Page>
  );
}
