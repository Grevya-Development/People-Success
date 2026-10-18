import { Suspense } from "react";
import { Page } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { requireContext, can } from "@/server/auth/context";
import { SettingsNav } from "./_components/settings-nav";
import { visibleSections } from "./_components/sections";

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <Page>
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <p className="mb-2 hidden px-2.5 text-xs font-medium text-muted-foreground lg:block">Settings</p>
          <Suspense fallback={<NavSkeleton />}>
            <Nav />
          </Suspense>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </Page>
  );
}

async function Nav() {
  const ctx = await requireContext();
  const items = visibleSections(ctx.grants).map((s) => ({ href: s.href, label: s.label }));
  return <SettingsNav items={items} showSetup={can(ctx, "settings.manage", "all")} />;
}

function NavSkeleton() {
  return (
    <div className="flex gap-2 lg:flex-col" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-7 w-28 lg:w-full" />
      ))}
    </div>
  );
}
