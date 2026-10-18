"use client";

import Link from "next/link";
import { Fragment } from "react";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SECTION_LABELS } from "@/lib/navigation";
import { CommandMenu, type CommandLink } from "./command-menu";
import { NotificationsMenu } from "./notifications-menu";
import { AssistantButton } from "@/components/assistant/assistant-button";
import { UserMenu, type ShellUser } from "./user-menu";

export type QuickCreateItem = { label: string; href: string };

const SEGMENT_LABELS: Record<string, string> = {
  new: "New",
  edit: "Edit",
  import: "Import",
  roles: "Roles",
  users: "Users",
  audit: "Audit log",
  approvals: "Approvals",
  "legal-entities": "Legal entities",
  locations: "Locations",
  departments: "Departments",
  designations: "Designations",
  general: "General",
};

function Crumbs() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return null;
  const crumbs = parts.map((seg, i) => {
    const href = "/" + parts.slice(0, i + 1).join("/");
    const label =
      (i === 0 ? SECTION_LABELS[seg] : SEGMENT_LABELS[seg]) ??
      (/^[0-9a-f-]{36}$/i.test(seg) ? "Details" : decodeURIComponent(seg).replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase()));
    return { href, label };
  });
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((c, i) => (
          <Fragment key={c.href}>
            {i > 0 ? <BreadcrumbSeparator className="hidden sm:block" /> : null}
            <BreadcrumbItem className={i < crumbs.length - 1 ? "hidden sm:inline-flex" : "truncate"}>
              {i === crumbs.length - 1 ? (
                <BreadcrumbPage className="truncate">{c.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link href={c.href}>{c.label}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function AppHeader({
  user,
  links,
  quickCreate,
  canUseAssistant = false,
}: {
  user: ShellUser;
  links: CommandLink[];
  quickCreate: QuickCreateItem[];
  canUseAssistant?: boolean;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-13 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-4">
      <SidebarTrigger className="-ml-1 text-muted-foreground" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <Crumbs />
      <div className="ml-auto flex items-center gap-1.5">
        <CommandMenu links={links} />
        {quickCreate.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-1">
                <Plus className="size-3.5" />
                <span className="hidden sm:inline">New</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {quickCreate.map((q) => (
                <DropdownMenuItem key={q.href} asChild>
                  <Link href={q.href}>{q.label}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {canUseAssistant ? <AssistantButton /> : null}
        <NotificationsMenu />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
