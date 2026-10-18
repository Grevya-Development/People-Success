import Link from "next/link";
import { cn } from "cn";

export type LinkTab = { key: string; label: string; href: string; count?: number | null };

/**
 * URL-driven tabs (?tab=...). Each tab is a link, so only the active tab's
 * data is fetched, tabs are shareable, and Back works as expected.
 */
export function LinkTabs({ tabs, active, label }: { tabs: LinkTab[]; active: string; label: string }) {
  return (
    <nav aria-label={label} className="-mx-4 mb-5 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1">
        {tabs.map((t) => {
          const current = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                scroll={false}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-9 items-center gap-1.5 rounded-t-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  current && "text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground",
                )}
              >
                {t.label}
                {t.count ? (
                  <span className="tabular rounded-full bg-muted px-1.5 text-[11px] leading-4 text-muted-foreground">{t.count}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
