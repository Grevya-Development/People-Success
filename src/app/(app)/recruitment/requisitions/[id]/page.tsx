import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, cache } from "react";
import { notFound } from "next/navigation";
import { Briefcase, Check, Clock, X } from "lucide-react";
import { NoAccess, Page, PageHeader, Section } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { getRequisition } from "@/server/services/recruitment/requisitions";
import { recruitmentLookups } from "@/server/services/recruitment/lookups";
import { formatDate, formatDateTime, formatMoney, titleCase } from "@/lib/format";
import { RequisitionForm } from "../../_components/requisition-form";
import { RequisitionActions } from "./requisition-actions";

export const metadata: Metadata = { title: "Requisition" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const load = cache(async (id: string) => {
  const ctx = await requireContext();
  if (!UUID.test(id)) notFound();
  try {
    return { ctx, r: await getRequisition(ctx, id) };
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    if (err instanceof AppError && err.code === "FORBIDDEN") return { ctx, r: null };
    throw err;
  }
});

export default function RequisitionPage({ params, searchParams }: PageProps<"/recruitment/requisitions/[id]">) {
  return (
    <Page>
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <Body params={params} searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children ?? "—"}</dd>
    </div>
  );
}

async function Body({ params, searchParams }: { params: PageProps<"/recruitment/requisitions/[id]">["params"]; searchParams: PageProps<"/recruitment/requisitions/[id]">["searchParams"] }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, r } = await load(id);
  if (!r) return <NoAccess message="You do not have access to this requisition." />;

  if (sp.edit === "1" && r.canEdit) {
    const lookups = await recruitmentLookups(ctx);
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader eyebrow={r.code} title="Edit requisition" />
        <RequisitionForm lookups={lookups} canSeeBudget={r.canSeeBudget} initial={r.raw} id={r.id} />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/recruitment?tab=requisitions" className="hover:underline">
            Requisitions
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {r.title} <StatusBadge status={r.status} />
          </span>
        }
        description={`${r.code} · raised by ${r.createdByName ?? "—"} on ${formatDate(r.createdAt)}`}
        actions={<RequisitionActions r={{ id: r.id, status: r.status, canEdit: r.canEdit, canSubmit: r.canSubmit, canWithdraw: r.canWithdraw, canManageStatus: r.canManageStatus, canCreateOpening: r.canCreateOpening, canCreatePosition: r.canCreatePosition }} />}
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Section title="Details">
            <dl className="grid gap-4 p-5 sm:grid-cols-3">
              <Item label="Headcount">
                <span className="tabular">
                  {r.hiredCount}/{r.headcount} hired
                </span>
              </Item>
              <Item label="Employment type">{titleCase(r.employmentType)}</Item>
              <Item label="Reason">{r.reason === "backfill" ? `Backfill${r.backfillFor ? ` for ${r.backfillFor.name}` : ""}` : "New role"}</Item>
              <Item label="Department">{r.department?.name}</Item>
              <Item label="Designation">{r.designation?.name}</Item>
              <Item label="Location">{r.location?.name}</Item>
              <Item label="Legal entity">{r.legalEntity?.name}</Item>
              <Item label="Hiring manager">{r.hiringManager?.name}</Item>
              <Item label="Recruiter">{r.recruiter?.name}</Item>
              <Item label="Target start">{r.targetStartDate ? formatDate(r.targetStartDate) : null}</Item>
              <Item label="Position">{r.position ? `${r.position.code} · ${titleCase(r.position.status)}` : null}</Item>
              {r.budget ? (
                <Item label="Budget (annual CTC)">
                  <span className="tabular">
                    {r.budget.min == null && r.budget.max == null ? "Not set" : `${formatMoney(r.budget.min, r.budget.currency, { compact: true })} – ${formatMoney(r.budget.max, r.budget.currency, { compact: true })}`}
                  </span>
                </Item>
              ) : null}
            </dl>
            {r.justification ? (
              <div className="border-t px-5 py-4">
                <div className="text-xs text-muted-foreground">Justification</div>
                <p className="mt-1 text-sm whitespace-pre-line">{r.justification}</p>
              </div>
            ) : null}
          </Section>
          <Section title="Jobs" description="Openings created from this requisition.">
            {r.openings.length ? (
              <ul className="divide-y">
                {r.openings.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <Link href={`/recruitment/openings/${o.id}`} className="font-medium hover:underline">
                      {o.title}
                    </Link>
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="tabular">
                        {o.hired}/{o.openings} hired
                      </span>
                      <StatusBadge status={o.status} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-3 px-5 py-5 text-sm text-muted-foreground">
                <Briefcase className="size-4" aria-hidden />
                {r.status === "approved" ? "No job opened yet." : "Jobs can be opened once the requisition is approved."}
              </div>
            )}
          </Section>
        </div>
        <Section title="Approval">
          {r.approval ? (
            <ol className="space-y-4 p-5">
              {r.approval.steps.map((s) => (
                <li key={s.stepNo} className="flex gap-3">
                  <span
                    className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${s.status === "approved" ? "bg-success-soft text-success" : s.status === "rejected" ? "bg-danger-soft text-danger" : "bg-muted text-muted-foreground"}`}
                    aria-hidden
                  >
                    {s.status === "approved" ? <Check className="size-3.5" /> : s.status === "rejected" ? <X className="size-3.5" /> : <Clock className="size-3.5" />}
                  </span>
                  <div className="min-w-0 text-sm">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {titleCase(s.status)}
                      {s.decidedAt ? ` · ${formatDateTime(s.decidedAt)}` : ""}
                    </div>
                    {s.comment ? <p className="mt-1 text-xs text-muted-foreground">“{s.comment}”</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="p-5 text-sm text-muted-foreground">Not submitted yet. Submitting starts the approval chain configured in Settings → Approvals.</p>
          )}
        </Section>
      </div>
    </>
  );
}
