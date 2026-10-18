import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState, Page } from "@/components/page";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <Page>
      <EmptyState
        icon={SearchX}
        title="Page not found"
        description="This record does not exist, was removed, or belongs to another organization."
        action={
          <Button size="sm" asChild>
            <Link href="/overview">Back to overview</Link>
          </Button>
        }
      />
    </Page>
  );
}
