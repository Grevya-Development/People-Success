import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, cache } from "react";
import { notFound } from "next/navigation";
import { ExternalLink, Pause, Pencil, Send, X } from "lucide-react";
import { NoAccess, Page, PageHeader, Section, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { LinkTabs } from "@/components/documents/link-tabs";
import { Markdown } from "@/components/documents/markdown";
import { requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { getOpening } from "@/server/services/recruitment/openings";
import { getBoard } from "@/server/services/recruitment/applications";
import { recruitmentLookups } from "@/server/services/recruitment/lookups";
import { approvedRequisitionOptions } from "@/server/services/recruitment/requisitions";
import { tenants } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { formatDate, formatMoney, titleCase } from "@/lib/format";
import { OpeningForm } from "../../_components/opening-form";
import { ActionButton } from "../../_components/client";
import { ClosedApplications, PipelineBoard, PipelineTable } from "../../_components/pipeline";
import { InterviewQuestions } from "../../_components/ai-panels";
import { transitionOpeningAction } from "../../actions";

export const metadata: Metadata = { title: "Job" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const load = cache(async (id: string) => {
  const ctx = await requireContext();
  if (!UUID.test(id)) notFound();
  try {
    const opening = await getOpening(ctx, id);
    const [tenant] = await ctx.db((tx) => tx.select({ name: tenants.name, slug: tenants.slug }).from(tenants).where(eq(tenants.id, ctx.tenantId)));
    return { ctx, opening, tenant };
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    if (err instanceof AppError && err.code === "FORBIDDEN") return { ctx, opening: null, tenant: null };
    throw err;
  }
});

export default function OpeningPage({ params, searchParams }: PageProps<"/recruitment/openings/[id]">) {
  return (
    <Page width="full" className="max-w-[1600px]">
      <Suspense fallback={<Skeleton className="mb-6 h-14 w-96" />}>
        <Header params={params} />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={5} columns={6} />}>
        <Body params={params} searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Header({ params }: { params: PageProps<"/recruitment/openings/[id]">["params"] }) {
  const { id } = await params;
  const { opening: o, tenant } = await load(id);
  if (!o) return null;
  return (
    <PageHeader
      eyebrow={
        <Link href="/recruitment?tab=openings" className="hover:underline">
          Jobs
        </Link>
      }
      title={
        <span className="flex flex-wrap items-center gap-2">
          {o.title} <StatusBadge status={o.status} />
        </span>
      }
      description={[o.department, o.location, titleCase(o.workMode), `${o.hired}/${o.openings} hired`, o.requisition ? o.requisition.code : null].filter(Boolean).join(" · ")}
      actions={
        <>
          {o.status === "published" && tenant ? (
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/careers/${tenant.slug}/${o.slug}`} target="_blank">
                <ExternalLink /> Careers page
              </Link>
            </Button>
          ) : null}
          {o.canManage && o.status !== "closed" ? (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/recruitment/openings/${o.id}?tab=details&edit=1`}>
                <Pencil /> Edit
              </Link>
            </Button>
          ) : null}
          {o.canManage && o.status === "published" ? (
            <ActionButton action={transitionOpeningAction} input={{ id: o.id, to: "paused" as const }} success="Job paused">
              <Pause /> Pause
            </ActionButton>
          ) : null}
          {o.canManage && o.status !== "closed" ? (
            <ActionButton
              action={transitionOpeningAction}
              input={{ id: o.id, to: "closed" as const }}
              success="Job closed"
              variant="ghost"
              confirm={{ title: "Close this job?", description: "It disappears from the careers page and stops taking applications. Candidates already in the pipeline stay where they are.", label: "Close job", destructive: true }}
            >
              <X /> Close
            </ActionButton>
          ) : null}
          {o.canManage && (o.status === "draft" || o.status === "paused") ? (
            <ActionButton action={transitionOpeningAction} input={{ id: o.id, to: "published" as const }} success="Job published" variant="default">
              <Send /> Publish
            </ActionButton>
          ) : null}
        </>
      }
    />
  );
}

async function Body({ params, searchParams }: { params: PageProps<"/recruitment/openings/[id]">["params"]; searchParams: PageProps<"/recruitment/openings/[id]">["searchParams"] }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, opening: o, tenant } = await load(id);
  if (!o) return <NoAccess message="You need recruitment access to view jobs." />;
  const tab = sp.tab === "table" || sp.tab === "details" ? sp.tab : "board";
  const tabs = [
    { key: "board", label: "Board", href: `/recruitment/openings/${o.id}` },
    { key: "table", label: "Table", href: `/recruitment/openings/${o.id}?tab=table` },
    { key: "details", label: "Details", href: `/recruitment/openings/${o.id}?tab=details` },
  ];
  let content: React.ReactNode;
  if (tab === "details") {
    if (sp.edit === "1" && o.canManage && o.status !== "closed") {
      const [lookups, requisitions] = await Promise.all([recruitmentLookups(ctx), approvedRequisitionOptions(ctx)]);
      content = (
        <div className="mx-auto max-w-3xl">
          <OpeningForm lookups={lookups} requisitions={o.requisition && !requisitions.some((r) => r.value === o.requisition!.id) ? [...requisitions, { value: o.requisition.id, label: o.requisition.code }] : requisitions} initial={o.raw} id={o.id} />
        </div>
      );
    } else {
      content = (
        <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
          <Section title="Description">
            <div className="space-y-4 p-5">
              <Markdown source={o.description} />
              {o.requirements ? (
                <div>
                  <h3 className="mb-1 text-sm font-semibold">Requirements</h3>
                  <Markdown source={o.requirements} />
                </div>
              ) : null}
            </div>
          </Section>
          <div className="space-y-5">
            <Section title="Summary">
              <dl className="grid gap-3 p-5 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Skills</dt>
                  <dd>{o.skills.length ? o.skills.join(", ") : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Experience</dt>
                  <dd>{o.experienceMinYears != null || o.experienceMaxYears != null ? `${o.experienceMinYears ?? 0}–${o.experienceMaxYears ?? "any"} years` : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Salary range</dt>
                  <dd className="tabular">
                    {o.salaryMinAnnual != null || o.salaryMaxAnnual != null
                      ? `${formatMoney(o.salaryMinAnnual, "INR", { compact: true })} – ${formatMoney(o.salaryMaxAnnual, "INR", { compact: true })} (${o.showSalary ? "shown publicly" : "internal"})`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Hiring manager / recruiter</dt>
                  <dd>
                    {o.hiringManager ?? "—"} / {o.recruiter ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Published / closes</dt>
                  <dd>
                    {o.publishedAt ? formatDate(o.publishedAt) : "Not yet"} / {o.closesOn ? formatDate(o.closesOn) : "Open-ended"}
                  </dd>
                </div>
                {o.requisition ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Requisition</dt>
                    <dd>
                      <Link href={`/recruitment/requisitions/${o.requisition.id}`} className="hover:underline">
                        {o.requisition.code}
                      </Link>{" "}
                      <StatusBadge status={o.requisition.status} />
                    </dd>
                  </div>
                ) : null}
                {o.questions.length ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Screening questions</dt>
                    <dd>
                      <ul className="list-disc pl-4">
                        {o.questions.map((q) => (
                          <li key={q.id}>
                            {q.label}
                            {q.required ? " *" : ""}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </Section>
            <InterviewQuestions openingId={o.id} />
          </div>
        </div>
      );
    }
  } else {
    const board = await getBoard(ctx, o.id);
    const companyName = tenant?.name ?? "";
    content = (
      <div className="space-y-4">
        {tab === "board" ? (
          <PipelineBoard board={board} canManage={o.canManage} jobTitle={o.title} companyName={companyName} />
        ) : (
          <PipelineTable board={board} canManage={o.canManage} jobTitle={o.title} companyName={companyName} />
        )}
        <ClosedApplications cards={board.closed} canManage={o.canManage} />
      </div>
    );
  }
  return (
    <>
      <LinkTabs label="Job views" active={tab} tabs={tabs} />
      <div className="animate-enter" key={tab}>
        {content}
      </div>
    </>
  );
}
