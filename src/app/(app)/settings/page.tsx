import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { NoAccess, PageHeader, Reveal } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { requireContext } from "@/server/auth/context";
import { visibleSections } from "./_components/sections";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsIndexPage() {
  return (
    <>
      <PageHeader title="Settings" description="Configure your organization, people structure, access and approvals." />
      <Suspense fallback={<IndexSkeleton />}>
        <SectionList />
      </Suspense>
    </>
  );
}

async function SectionList() {
  const ctx = await requireContext();
  const sections = visibleSections(ctx.grants);
  if (!sections.length) return <NoAccess message="Your role does not include any settings." />;
  return (
    <Reveal className="grid gap-3 sm:grid-cols-2">
      {sections.map((s) => (
        <Link
          key={s.key}
          href={s.href}
          className="group flex items-start justify-between gap-4 rounded-xl border bg-card p-5 transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <div>
            <p className="text-sm font-medium">{s.label}</p>
            <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
          </div>
          <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      ))}
    </Reveal>
  );
}

function IndexSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}
