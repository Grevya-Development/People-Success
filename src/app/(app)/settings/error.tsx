"use client";

import { ErrorState } from "@/components/page";
import { Button } from "@/components/ui/button";

export default function SettingsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="Could not load these settings"
      description="Please try again. If it keeps happening, contact support."
      action={
        <Button variant="outline" onClick={() => reset()}>
          Try again
        </Button>
      }
    />
  );
}
