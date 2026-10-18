import { Suspense } from "react";
import { cookies } from "next/headers";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { AppHeader, type QuickCreateItem } from "@/components/shell/app-header";
import { ShellSkeleton } from "@/components/shell/shell-skeleton";
import { requireContext } from "@/server/auth/context";
import { visibleNavigation } from "@/lib/navigation";
import { quickCreateFor } from "@/lib/quick-create";
import { getShellBadges } from "@/server/services/shell";

/**
 * The shell resolves the session once and streams in; pages render their own
 * Suspense boundaries so client navigations keep the shell and stream content.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const [store, badges] = await Promise.all([cookies(), getShellBadges(ctx)]);
  const defaultOpen = store.get("sidebar_state")?.value !== "false";
  const groups = visibleNavigation(ctx.grants);
  const links = groups.flatMap((g) => g.items.map((i) => ({ label: i.label, href: i.href, icon: i.icon, group: g.label })));
  const quickCreate: QuickCreateItem[] = quickCreateFor(ctx.grants);

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar
        groups={groups}
        tenant={{ id: ctx.tenantId, name: ctx.tenantName }}
        tenants={ctx.tenants.map((t) => ({ id: t.id, name: t.name }))}
        badges={badges}
      />
      <SidebarInset className="min-w-0">
        <AppHeader
          user={{
            name: ctx.fullName ?? ctx.email,
            email: ctx.email,
            roles: ctx.roles.map((r) => r.name),
            employeeId: ctx.employeeId,
          }}
          links={links}
          quickCreate={quickCreate}
          canUseAssistant={!!ctx.grants["ai.use"]}
        />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
