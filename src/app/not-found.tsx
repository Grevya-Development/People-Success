import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-6 text-center">
      <Wordmark />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">The link may be wrong or the page may have moved.</p>
      </div>
      <Button asChild>
        <Link href="/">Go to PeopleSuccess</Link>
      </Button>
    </main>
  );
}
