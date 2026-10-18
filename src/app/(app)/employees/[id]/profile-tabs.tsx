import Link from "next/link";
import { cn } from "cn";
import type { ProfileAccess } from "@/server/services/employees/queries";

export type TabKey = "overview" | "job" | "personal" | "compensation" | "statutory" | "documents" | "skills" | "assets" | "activity";

export function tabsFor(a: ProfileAccess): { key: TabKey; label: string }[] {
  const tabs: { key: TabKey; label: string; show: boolean }[] = [
    { key: "overview", label: "Overview", show: true },
    { key: "job", label: "Job & history", show: a.full },
    { key: "personal", label: "Personal", show: a.full },
    { key: "compensation", label: "Compensation", show: a.canViewCompensation },
    { key: "statutory", label: "Statutory & bank", show: a.canViewSensitive },
    { key: "documents", label: "Documents", show: a.canViewDocuments },
    { key: "skills", label: "Skills", show: true },
    { key: "assets", label: "Assets", show: a.full },
    { key: "activity", label: "Activity", show: a.canViewActivity },
  ];
  return tabs.filter((t) => t.show).map(({ key, label }) => ({ key, label }));
}

export function ProfileTabs({ tabs, active }: { tabs: { key: TabKey; label: string }[]; active: TabKey }) {
  return (
    <nav aria-label="Profile sections" className="-mx-1 overflow-x-auto border-b scrollbar-thin">
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((t) => (
          <li key={t.key}>
            <Link
              href={t.key === "overview" ? "?" : `?tab=${t.key}`}
              scroll={false}
              aria-current={t.key === active ? "page" : undefined}
              className={cn(
                "relative inline-flex h-10 items-center px-3 text-sm text-muted-foreground transition-colors hover:text-foreground",
                "focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                t.key === active && "font-medium text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground",
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
