import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Markdown } from "@/components/documents/markdown";
import { getPublicJob } from "@/server/services/recruitment/careers";
import { env } from "@/server/env";
import { formatDate, titleCase } from "@/lib/format";
import { consentText } from "@/lib/validation/recruitment";
import { salaryLabel } from "../../format";
import { ApplyForm } from "./apply-form";

export async function generateMetadata({ params }: PageProps<"/careers/[tenantSlug]/[jobSlug]">): Promise<Metadata> {
  const { tenantSlug, jobSlug } = await params;
  const found = await getPublicJob(tenantSlug, jobSlug);
  if (!found) return { title: "Job not found", robots: { index: false } };
  const { tenant, job } = found;
  const plain = job.description.replace(/[#*_>`-]/g, " ").replace(/\s+/g, " ").trim();
  return {
    title: { absolute: `${job.title} at ${tenant.name}` },
    description: plain.slice(0, 160),
    robots: { index: true, follow: true },
    alternates: { canonical: `/careers/${tenant.slug}/${job.slug}` },
    openGraph: { title: `${job.title} at ${tenant.name}`, description: plain.slice(0, 200), type: "website" },
  };
}

export default function JobPage({ params }: PageProps<"/careers/[tenantSlug]/[jobSlug]">) {
  return (
    <div className="min-h-svh bg-sidebar">
      <Suspense fallback={<JobSkeleton />}>
        <Body params={params} />
      </Suspense>
      <footer className="px-6 py-8 text-center text-xs text-muted-foreground">Powered by PeopleSuccess by Grevya</footer>
    </div>
  );
}

function JobSkeleton() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-4 h-8 w-80" />
      <Skeleton className="mt-6 h-64 w-full rounded-xl" />
      <Skeleton className="mt-6 h-96 w-full rounded-xl" />
    </main>
  );
}

const EMPLOYMENT: Record<string, string> = { full_time: "FULL_TIME", part_time: "PART_TIME", contract: "CONTRACTOR", intern: "INTERN", temporary: "TEMPORARY", consultant: "CONTRACTOR" };

async function Body({ params }: { params: PageProps<"/careers/[tenantSlug]/[jobSlug]">["params"] }) {
  const { tenantSlug, jobSlug } = await params;
  const found = await getPublicJob(tenantSlug, jobSlug);
  if (!found) notFound();
  const { tenant, job } = found;
  const salary = salaryLabel(job.salary);
  // Structured data for search engines: only the public job fields, never applicant data.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: job.description,
    datePosted: job.publishedAt?.slice(0, 10),
    ...(job.closesOn ? { validThrough: job.closesOn } : {}),
    employmentType: EMPLOYMENT[job.employmentType] ?? "OTHER",
    hiringOrganization: { "@type": "Organization", name: tenant.name },
    ...(job.workMode === "remote" ? { jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "India" } } : {}),
    ...(job.location ? { jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: job.location, addressCountry: "IN" } } } : {}),
    ...(job.salary && (job.salary.min || job.salary.max)
      ? { baseSalary: { "@type": "MonetaryAmount", currency: "INR", value: { "@type": "QuantitativeValue", minValue: (job.salary.min ?? job.salary.max)! / 100, maxValue: (job.salary.max ?? job.salary.min)! / 100, unitText: "YEAR" } } }
      : {}),
    url: `${env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/careers/${tenant.slug}/${job.slug}`,
  };
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 animate-enter sm:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <Link href={`/careers/${tenant.slug}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden /> All jobs at {tenant.name}
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-balance">{job.title}</h1>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
        {[job.department, job.location, titleCase(job.workMode), titleCase(job.employmentType)].filter(Boolean).map((x) => (
          <span key={x}>{x}</span>
        ))}
        {job.experienceMinYears != null || job.experienceMaxYears != null ? <span>{`${job.experienceMinYears ?? 0}–${job.experienceMaxYears ?? "+"} years`}</span> : null}
        {salary ? <span className="tabular">{salary}</span> : null}
        {job.closesOn ? <span>Apply by {formatDate(job.closesOn)}</span> : null}
      </p>
      <article className="mt-6 space-y-5 rounded-xl border bg-card p-6">
        <Markdown source={job.description} />
        {job.requirements ? (
          <section>
            <h2 className="mb-2 text-base font-semibold">What we’re looking for</h2>
            <Markdown source={job.requirements} />
          </section>
        ) : null}
        {job.skills.length ? (
          <section>
            <h2 className="mb-2 text-base font-semibold">Skills</h2>
            <ul className="flex flex-wrap gap-1.5">
              {job.skills.map((s) => (
                <li key={s} className="rounded-full bg-muted px-2.5 py-0.5 text-xs">
                  {s}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>
      <section className="mt-6 rounded-xl border bg-card p-6" aria-labelledby="apply-heading">
        <h2 id="apply-heading" className="text-lg font-semibold">
          Apply for this role
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">It takes about three minutes. Fields marked * are required.</p>
        <ApplyForm tenantSlug={tenant.slug} jobSlug={job.slug} jobTitle={job.title} questions={job.questions} consent={consentText(tenant.name)} />
      </section>
    </main>
  );
}
