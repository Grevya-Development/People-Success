import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Briefcase, MapPin } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/page";
import { getCareerSite } from "@/server/services/recruitment/careers";
import { titleCase } from "@/lib/format";
import { salaryLabel } from "../format";

export async function generateMetadata({ params }: PageProps<"/careers/[tenantSlug]">): Promise<Metadata> {
  const { tenantSlug } = await params;
  const site = await getCareerSite(tenantSlug);
  if (!site) return { title: "Careers", robots: { index: false } };
  return {
    title: { absolute: `Careers at ${site.tenant.name}` },
    description: `${site.jobs.length} open role${site.jobs.length === 1 ? "" : "s"} at ${site.tenant.name}. Apply online.`,
    robots: { index: true, follow: true },
    alternates: { canonical: `/careers/${site.tenant.slug}` },
  };
}

export default function CareersPage({ params }: PageProps<"/careers/[tenantSlug]">) {
  return (
    <div className="min-h-svh bg-sidebar">
      <Suspense fallback={<ListSkeleton />}>
        <Body params={params} />
      </Suspense>
      <footer className="px-6 py-8 text-center text-xs text-muted-foreground">Powered by PeopleSuccess by Grevya</footer>
    </div>
  );
}

function ListSkeleton() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-3 h-4 w-80" />
      <div className="mt-8 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    </main>
  );
}

async function Body({ params }: { params: PageProps<"/careers/[tenantSlug]">["params"] }) {
  const { tenantSlug } = await params;
  const site = await getCareerSite(tenantSlug);
  if (!site) notFound();
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 animate-enter sm:px-6">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Careers</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance">Work at {site.tenant.name}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {site.jobs.length ? `${site.jobs.length} open role${site.jobs.length === 1 ? "" : "s"}. Choose one to read more and apply.` : "There are no open roles right now."}
      </p>
      {site.jobs.length ? (
        <ul className="mt-8 space-y-3">
          {site.jobs.map((j) => (
            <li key={j.slug}>
              <Link
                href={`/careers/${site.tenant.slug}/${j.slug}`}
                className="block rounded-xl border bg-card p-5 transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <h2 className="font-semibold">{j.title}</h2>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  {j.department ? (
                    <span className="inline-flex items-center gap-1">
                      <Briefcase className="size-3.5" aria-hidden /> {j.department}
                    </span>
                  ) : null}
                  {j.location ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3.5" aria-hidden /> {j.location}
                    </span>
                  ) : null}
                  <span>{titleCase(j.workMode)}</span>
                  <span>{titleCase(j.employmentType)}</span>
                  {j.experienceMinYears != null ? <span>{j.experienceMinYears}+ years</span> : null}
                  {salaryLabel(j.salary) ? <span className="tabular">{salaryLabel(j.salary)}</span> : null}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState className="mt-8 bg-card" icon={Briefcase} title="No open roles" description="Please check back later." />
      )}
    </main>
  );
}
