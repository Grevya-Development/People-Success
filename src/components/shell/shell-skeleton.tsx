import { Skeleton } from "@/components/ui/skeleton";

/** Static stand-in for the shell while the session resolves (a few ms). */
export function ShellSkeleton() {
  return (
    <div className="flex min-h-svh">
      <aside className="hidden w-64 shrink-0 border-r bg-sidebar p-3 md:block">
        <Skeleton className="h-10 w-full" />
        <div className="mt-6 space-y-2">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full opacity-70" />
          ))}
        </div>
      </aside>
      <div className="flex-1">
        <div className="h-13 border-b" />
        <div className="space-y-4 p-6">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    </div>
  );
}
