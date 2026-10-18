import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, Inbox } from "lucide-react";
import { cn } from "cn";
import { NoAccess, Page, PageHeader, Reveal, Section } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { getLeaveRequest } from "@/server/services/time/leave-requests";
import { formatDate, formatDateTime } from "@/lib/format";
import { CancelLeaveButton } from "../../_components/request-row-actions";
import { daysLabel, dotClass, rangeLabel } from "../../_components/tones";

export const metadata: Metadata = { title: "Leave request" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function LeaveRequestPage({ params }: PageProps<"/leave/requests/[id]">) {
  return (
    <Page width="narrow">
      <Suspense
        fallback={
          <>
            <Skeleton className="mb-6 h-12 w-72" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </>
        }
      >
        <Content params={params} />
      </Suspense>
    </Page>
  );
}

async function Content({ params }: { params: PageProps<"/leave/requests/[id]">["params"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireContext();
  let data: Awaited<ReturnType<typeof getLeaveRequest>>;
  try {
    data = await getLeaveRequest(ctx, id);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    if (err instanceof AppError && err.code === "FORBIDDEN") return <NoAccess message="You do not have access to this leave request." />;
    throw err;
  }
  const r = data.request;
  const activeStep = data.steps.find((s) => s.status === "pending");
  const canDecide = r.status === "pending" && !!activeStep && activeStep.approverUserIds.includes(ctx.userId);
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/leave" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3" /> Leave
          </Link>
        }
        title={
          <span className="inline-flex items-center gap-2">
            <span className={cn("size-2.5 rounded-full", dotClass(r.typeColor))} aria-hidden />
            {r.typeName} · {r.employeeName}
          </span>
        }
        description={`${rangeLabel(r, (d) => formatDate(d, "EEE, dd MMM yyyy"))} · ${daysLabel(r.days)}${r.isPaid ? "" : " · unpaid"}`}
        actions={
          <>
            {canDecide ? (
              <Button size="sm" asChild>
                <Link href={`/inbox?tab=approvals&request=${data.approval?.id}`}>
                  <Inbox /> Review in inbox
                </Link>
              </Button>
            ) : null}
            {data.canCancel ? <CancelLeaveButton requestId={r.id} status={r.status} label={r.status === "pending" ? "Withdraw" : "Cancel leave"} size="default" /> : null}
          </>
        }
      />
      <Reveal className="space-y-6">
        <Section>
          <dl className="grid gap-x-6 gap-y-4 p-5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="mt-1">
                <StatusBadge status={r.status} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Employee</dt>
              <dd className="mt-1 font-medium">
                {r.employeeName} <span className="font-normal text-muted-foreground">{r.employeeCode}</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Applied</dt>
              <dd className="mt-1">{formatDateTime(r.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{r.status === "cancelled" ? "Cancelled" : "Decided"}</dt>
              <dd className="mt-1">{formatDateTime(r.cancelledAt ?? r.decidedAt)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Reason</dt>
              <dd className="mt-1 whitespace-pre-wrap">{r.reason ?? "—"}</dd>
            </div>
            {r.policyVersion ? (
              <div>
                <dt className="text-xs text-muted-foreground">Policy version</dt>
                <dd className="mt-1">v{r.policyVersion}</dd>
              </div>
            ) : null}
            {r.documentId ? (
              <div>
                <dt className="text-xs text-muted-foreground">Supporting document</dt>
                <dd className="mt-1">
                  <a href={`/api/documents/${r.documentId}/download`} className="underline underline-offset-2">
                    Download
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
        </Section>
        <Section title="Approval">
          {data.steps.length ? (
            <ol className="divide-y">
              {data.steps.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span>
                    Step {s.stepNo}: <span className="font-medium">{s.name}</span>
                    {s.comment ? <span className="block text-xs text-muted-foreground">“{s.comment}”</span> : null}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {s.decidedAt ? formatDateTime(s.decidedAt) : null}
                    <StatusBadge status={s.status} />
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-5 py-4 text-sm text-muted-foreground">Recorded by HR on the employee&apos;s behalf, without an approval step.</p>
          )}
        </Section>
      </Reveal>
    </>
  );
}
