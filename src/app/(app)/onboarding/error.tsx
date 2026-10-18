"use client";

import { ErrorState } from "@/components/page";
import { Button } from "@/components/ui/button";

export default function OnboardingError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <ErrorState
        title="Could not load onboarding"
        description="Please try again. If it keeps happening, contact support."
        action={
          <Button variant="outline" onClick={() => reset()}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
