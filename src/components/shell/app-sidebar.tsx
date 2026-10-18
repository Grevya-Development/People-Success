"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrandMark } from "@/components/brand";
import { NavIcon } from "./nav-icon";
import type { NavGroup } from "@/lib/navigation";
import { switchTenantAction } from "@/app/(app)/shell-actions";

export type ShellTenant = { id: string; name: string };

export function AppSidebar({
  groups,
  tenant,
  tenants,
  badges,
}: {
  groups: NavGroup[];
  tenant: ShellTenant;
  tenants: ShellTenant[];
  badges: Record<string, number>;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="pt-3">
        <TenantSwitcher tenant={tenant} tenants={tenants} />
      </SidebarHeader>
      <SidebarContent className="scrollbar-thin">
        {groups.map((group) => (
          <SidebarGroup key={group.label} className="py-1">
            <SidebarGroupLabel className="text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.label}>
                      <Link href={item.href}>
                        <NavIcon name={item.icon} />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {badges[item.key] ? (
                      <SidebarMenuBadge className="tabular text-muted-foreground">{badges[item.key]}</SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="px-4 pb-3 group-data-[collapsible=icon]:hidden">
        <p className="text-[11px] text-muted-foreground">PeopleSuccess by Grevya</p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function TenantSwitcher({ tenant, tenants }: { tenant: ShellTenant; tenants: ShellTenant[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const switchTo = (id: string) =>
    start(async () => {
      const res = await switchTenantAction({ tenantId: id });
      if (!res.ok) toast.error(res.error.message);
      else {
        router.replace("/overview");
        router.refresh();
      }
    });

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent" disabled={pending}>
              <BrandMark size={28} className="rounded-md" />
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-semibold">{tenant.name}</span>
                <span className="truncate text-xs text-muted-foreground">PeopleSuccess</span>
              </span>
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Organizations</DropdownMenuLabel>
            {tenants.map((t) => (
              <DropdownMenuItem key={t.id} onSelect={() => t.id !== tenant.id && switchTo(t.id)}>
                <span className="truncate">{t.name}</span>
                {t.id === tenant.id ? <Check className="ml-auto size-4" /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/setup/organization">
                <Plus className="size-4" />
                Create organization
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
