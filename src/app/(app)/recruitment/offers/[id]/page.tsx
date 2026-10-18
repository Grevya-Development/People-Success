import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Check, Clock, Download, Mail, Pencil, RotateCw, Send, UserRoundCheck, X } from "lucide-react";
import { NoAccess, Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { getOffer } from "@/server/services/recruitment/offers";
import { recruitmentLookups } from "@/server/services/recruitment/lookups";
import { formatDate, formatDateTime, formatMoney, titleCase } from "@/lib/format";
import { OfferForm } from "../../_components/offer-form";
import { ActionButton, ReasonDialog } from "../../_components/client";
import { rescindOfferAction, resendOfferAction, sendOfferAction, submitOfferAction } from "../../actions";

export const metadata: Metadata = { title: "Offer", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function OfferPage({ params, searchParams }: PageProps<"/recruitment/offers/[id]">) {
  return (
    <Page>
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <Body params={params} searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

const EVENT_LABEL: Record<string, string> = {
  offer_created: "Drafted",
  offer_updated: "Edited",
  offer_submitted: "Sent for approval",
  offer_approved: "Approved; letter generated",
  offer_approval_rejected: "Not approved",
  offer_sent: "Sent to candidate",
  offer_resent: "New link sent",
  offer_revised: "Revised",
  offer_rescinded: "Rescinded",
  offer_expired: "Expired",
  offer_accepted: "Accepted",
  offer_declined: "Declined",
  hired: "Employee record created",
};

async function Body({ params, searchParams }: { params: PageProps<"/recruitment/offers/[id]">["params"]; searchParams: PageProps<"/recruitment/offers/[id]">["searchParams"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const ctx = await requireContext();
  let o: Awaited<ReturnType<typeof getOffer>>;
  try {
    o = await getOffer(ctx, id);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    if (err instanceof AppError && err.code === "FORBIDDEN") return <NoAccess message="Offers are visible to people who create or approve them." />;
    throw err;
  }
  const editable = o.canManage && ["draft", "pending_approval", "approved", "sent"].includes(o.status);
  if (sp.edit === "1" && editable) {
    const lookups = await recruitmentLookups(ctx);
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader eyebrow={`${o.candidateName} · v${o.version}`} title="Edit offer" />
        <OfferForm
          lookups={lookups}
          applications={[]}
          offerId={o.id}
          revisingSent={o.status === "approved" || o.status === "sent"}
          initial={{
            applicationId: o.applicationId,
            designationId: o.designation.id,
            departmentId: o.department.id,
            locationId: o.location.id,
            legalEntityId: o.legalEntity.id,
            reportingManagerId: o.reportingManager.id,
            employmentType: o.employmentType as never,
            joiningDate: o.joiningDate,
            annualCtc: o.annualCtc / 100,
            probationMonths: o.probationMonths,
            noticePeriodDays: o.noticePeriodDays,
            expiresOn: o.expiresOn,
          }}
        />
      </div>
    );
  }
  const total = o.components.reduce((s, c) => s + c.annualAmount, 0);
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/recruitment?tab=offers" className="hover:underline">
            Offers
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {o.candidateName} <StatusBadge status={o.status} tone={o.status === "sent" ? "info" : o.status === "pending_approval" ? "warning" : undefined} />
          </span>
        }
        description={`${o.openingTitle} · version ${o.version} · created by ${o.createdByName ?? "—"}`}
        actions={
          <>
            {o.document ? (
              <Button size="sm" variant="outline" asChild>
                <a href={`/api/recruitment/documents/${o.document.id}`}>
                  <Download /> Offer letter
                </a>
              </Button>
            ) : null}
            {o.employeeId ? (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/employees/${o.employeeId}`}>
                  <UserRoundCheck /> Employee
                </Link>
              </Button>
            ) : null}
            {editable ? (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/recruitment/offers/${o.id}?edit=1`}>
                  <Pencil /> {o.status === "approved" || o.status === "sent" ? "Revise" : "Edit"}
                </Link>
              </Button>
            ) : null}
            {o.canManage && editable ? (
              <ReasonDialog
                trigger={
                  <Button size="sm" variant="ghost">
                    <X /> Rescind
                  </Button>
                }
                title="Rescind this offer?"
                description={o.status === "sent" ? "The candidate's link stops working and they are told the offer was withdrawn." : "The offer is withdrawn. You can create a new one later."}
                label="Reason"
                confirmLabel="Rescind offer"
                destructive
                run={(reason) => rescindOfferAction({ offerId: o.id, reason })}
                success="Offer rescinded"
              />
            ) : null}
            {o.canManage && o.status === "sent" ? (
              <ActionButton
                action={resendOfferAction}
                input={{ offerId: o.id }}
                success="A new link was emailed"
                confirm={{ title: "Send a new link?", description: "The candidate gets a fresh link by email; the previous link stops working.", label: "Send new link" }}
              >
                <RotateCw /> Resend link
              </ActionButton>
            ) : null}
            {o.canManage && o.status === "draft" ? (
              <ActionButton action={submitOfferAction} input={{ offerId: o.id }} variant="default" success="Sent for approval">
                <Send /> Submit for approval
              </ActionButton>
            ) : null}
            {o.canManage && o.status === "approved" ? (
              <ActionButton
                action={sendOfferAction}
                input={{ offerId: o.id }}
                variant="default"
                success="Offer emailed to the candidate"
                confirm={{ title: `Send the offer to ${o.candidateName}?`, description: `They receive a secure link (${o.candidateEmail}) to download the letter and accept or decline until ${formatDate(o.expiresOn)}.`, label: "Send offer" }}
              >
                <Mail /> Send to candidate
              </ActionButton>
            ) : null}
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-5">
          <Section title="Terms">
            <dl className="grid gap-4 p-5 text-sm sm:grid-cols-3">
              {[
                ["Designation", o.designation.name],
                ["Department", o.department.name],
                ["Location", o.location.name],
                ["Legal entity", o.legalEntity.name],
                ["Reporting manager", o.reportingManager.name],
                ["Employment type", titleCase(o.employmentType)],
                ["Joining date", formatDate(o.joiningDate)],
                ["Probation", o.probationMonths ? `${o.probationMonths} months` : "None"],
                ["Notice period", `${o.noticePeriodDays} days`],
                ["Valid until", formatDate(o.expiresOn)],
                ["Sent", o.sentAt ? formatDateTime(o.sentAt) : "Not yet"],
                ["Letter", o.document ? (o.templateUsed ? "From your offer letter template" : "Built-in letter layout") : "Generated on approval"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="mt-0.5">{v ?? "—"}</dd>
                </div>
              ))}
            </dl>
          </Section>
          <Section title="Compensation" description={o.defaultSplit ? "Default split: Basic 50% and HRA 20% of CTC, Special allowance balances. Configure a salary structure in Payroll to use your own components." : "From your default salary structure."}>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Component</TableHead>
                    <TableHead className="text-right">Monthly</TableHead>
                    <TableHead className="text-right">Annual</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {o.components.map((c) => (
                    <TableRow key={c.code}>
                      <TableCell>{c.name}</TableCell>
                      <TableCell className="text-right tabular">{formatMoney(Math.round(c.annualAmount / 12))}</TableCell>
                      <TableCell className="text-right tabular">{formatMoney(c.annualAmount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-medium">Annual CTC</TableCell>
                    <TableCell className="text-right tabular">{formatMoney(Math.round(total / 12))}</TableCell>
                    <TableCell className="text-right font-medium tabular">{formatMoney(o.annualCtc)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </Section>
          {o.status === "accepted" || o.status === "declined" ? (
            <Section title="Candidate response">
              <div className="space-y-1 p-5 text-sm">
                <p>
                  {o.status === "accepted" ? "Accepted electronically by click-through" : "Declined"} on {o.respondedAt ? formatDateTime(o.respondedAt) : "—"}
                  {o.responseIp ? ` from IP ${o.responseIp}` : ""}.
                </p>
                {o.responseNote ? <p className="text-muted-foreground">Note: “{o.responseNote}”</p> : null}
                <p className="text-xs text-muted-foreground">{o.esign.provider ? `E-signature: ${o.esign.provider} (${o.esign.status})` : "No electronic signature was applied."}</p>
              </div>
            </Section>
          ) : null}
          <Section title="History">
            {o.events.length ? (
              <ol className="space-y-3 p-5">
                {o.events.map((e) => (
                  <li key={e.id} className="border-l-2 pl-3 text-sm">
                    <span className="font-medium">{EVENT_LABEL[e.type] ?? titleCase(e.type)}</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(e.createdAt)}
                      {e.actorName ? ` · ${e.actorName}` : ""}
                    </span>
                    {e.body ? <p className="text-muted-foreground">{e.body}</p> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="p-5 text-sm text-muted-foreground">No history yet.</p>
            )}
          </Section>
        </div>
        <div className="space-y-5">
          <Section title="Approval">
            {o.approval ? (
              <ol className="space-y-4 p-5">
                {o.approval.steps.map((s) => (
                  <li key={s.stepNo} className="flex gap-3 text-sm">
                    <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${s.status === "approved" ? "bg-success-soft text-success" : s.status === "rejected" ? "bg-danger-soft text-danger" : "bg-muted text-muted-foreground"}`} aria-hidden>
                      {s.status === "approved" ? <Check className="size-3.5" /> : s.status === "rejected" ? <X className="size-3.5" /> : <Clock className="size-3.5" />}
                    </span>
                    <div>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {titleCase(s.status)}
                        {s.decidedBy ? ` · ${s.decidedBy}` : ""}
                        {s.decidedAt ? ` · ${formatDateTime(s.decidedAt)}` : ""}
                      </div>
                      {s.comment ? <p className="mt-1 text-xs text-muted-foreground">“{s.comment}”</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="p-5 text-sm text-muted-foreground">Not submitted yet.</p>
            )}
          </Section>
          <Section title="E-signature">
            <p className="p-5 text-sm text-muted-foreground">{o.esign.label}</p>
          </Section>
          {o.versions.length > 1 ? (
            <Section title="Versions">
              <ul className="divide-y">
                {o.versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    {v.id === o.id ? (
                      <span className="font-medium">Version {v.version} (this)</span>
                    ) : (
                      <Link href={`/recruitment/offers/${v.id}`} className="hover:underline">
                        Version {v.version}
                      </Link>
                    )}
                    <StatusBadge status={v.status} />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          <Section title="Candidate">
            <div className="p-5 text-sm">
              <Link href={`/recruitment/candidates/${o.candidateId}`} className="font-medium hover:underline">
                {o.candidateName}
              </Link>
              <div className="break-all text-muted-foreground">{o.candidateEmail}</div>
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
