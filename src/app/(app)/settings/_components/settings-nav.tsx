"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

export function SettingsNav({ items, showSetup }: { items: { href: string; label: string }[]; showSetup: boolean }) {
  const pathname = usePathname();
  const link = (href: string, label: string) => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "shrink-0 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )}
      >
        {label}
      </Link>
    );
  };
  return (
    <nav aria-label="Settings" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
      {items.map((i) => link(i.href, i.label))}
      {showSetup ? (
        <>
          <div className="hidden border-t lg:my-2 lg:block" />
          {link("/setup", "Setup checklist")}
        </>
      ) : null}
    </nav>
  );
}
