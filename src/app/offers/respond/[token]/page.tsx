import type { Metadata } from "next";
import { Suspense } from "react";
import { CircleAlert, CircleCheck, Download } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getOfferByToken } from "@/server/services/recruitment/offer-response";
import { formatDate, formatDateTime, formatMoney, titleCase } from "@/lib/format";
import { ResponseForm } from "./response-form";

export const metadata: Metadata = { title: "Your offer", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function OfferResponsePage({ params }: PageProps<"/offers/respond/[token]">) {
  return (
    <div className="min-h-svh bg-sidebar">
      <header className="px-6 py-5 sm:px-10">
        <Wordmark />
      </header>
      <main className="mx-auto max-w-2xl px-4 pt-4 pb-16 animate-enter sm:px-6">
        <Suspense fallback={<Skeleton className="h-[520px] w-full rounded-xl" />}>
          <Body params={params} />
        </Suspense>
      </main>
    </div>
  );
}

const MESSAGES = {
  invalid: { title: "This offer link is not valid", body: "The link may be incomplete or was replaced by a newer one. Please use the latest email from the company, or contact your recruiter." },
  rescinded: { title: "This offer is no longer available", body: "The company has withdrawn or replaced this offer. Please check your email for an updated offer or contact your recruiter." },
  expired: { title: "This offer has expired", body: "The response period has ended. Please contact your recruiter if you are still interested." },
} as const;

async function Body({ params }: { params: PageProps<"/offers/respond/[token]">["params"] }) {
  const { token } = await params;
  const view = await getOfferByToken(token);
  if (view.state === "invalid" || view.state === "rescinded" || (view.state === "expired" && !view.offer)) {
    const m = MESSAGES[view.state];
    return (
      <div className="space-y-3 rounded-xl border bg-card p-6">
        <CircleAlert className="size-5 text-warning" aria-hidden />
        <h1 className="text-lg font-semibold tracking-tight">{m.title}</h1>
        <p className="text-sm text-muted-foreground">{m.body}</p>
      </div>
    );
  }
  const o = view.offer!;
  const total = o.components.reduce((s, c) => s + c.annualAmount, 0);
  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-card p-6">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Offer of employment · {view.companyName}</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-balance">
          {o.candidateFirstName}, you have an offer for {o.designation}
        </h1>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          {[
            ["Company", o.legalEntity],
            ["Role", o.designation],
            ["Department", o.department],
            ["Location", o.location],
            ["Employment type", titleCase(o.employmentType)],
            ["Date of joining", formatDate(o.joiningDate)],
            ["Probation", o.probationMonths ? `${o.probationMonths} months` : "None"],
            ["Notice period", `${o.noticePeriodDays} days`],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="mt-0.5">{v ?? "—"}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Component</th>
                <th className="px-3 py-2 text-right font-medium">Annual</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {o.components.map((c) => (
                <tr key={c.code}>
                  <td className="px-3 py-2">{c.name}</td>
                  <td className="px-3 py-2 text-right tabular">{formatMoney(c.annualAmount, o.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t font-medium">
              <tr>
                <td className="px-3 py-2">Annual cost to company</td>
                <td className="px-3 py-2 text-right tabular">{formatMoney(total, o.currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {o.defaultSplit ? <p className="mt-2 text-xs text-muted-foreground">Indicative split. Your appointment letter confirms the final structure; statutory deductions apply as per law.</p> : null}
        {o.hasLetter ? (
          <Button variant="outline" size="sm" className="mt-5" asChild>
            <a href={`/offers/respond/${token}/letter`} rel="noreferrer">
              <Download /> Download offer letter (PDF)
            </a>
          </Button>
        ) : null}
      </div>

      {view.state === "open" ? (
        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-base font-semibold">Your response</h2>
          <p className="mt-1 text-sm text-muted-foreground">Please respond by {formatDate(o.expiresOn)}.</p>
          <ResponseForm token={token} />
        </div>
      ) : (
        <div className="flex gap-3 rounded-xl border bg-card p-6 text-sm">
          {view.state === "accepted" ? <CircleCheck className="size-5 shrink-0 text-success" aria-hidden /> : <CircleAlert className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
          <div>
            <p className="font-medium">
              {view.state === "accepted" ? "You accepted this offer" : view.state === "declined" ? "You declined this offer" : "This offer has expired"}
              {o.respondedAt ? ` on ${formatDateTime(o.respondedAt)}` : ""}.
            </p>
            <p className="mt-1 text-muted-foreground">
              {view.state === "accepted"
                ? "Accepted electronically by click-through. No electronic signature was applied. The people team will contact you about onboarding."
                : "Contact your recruiter if you have any questions."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
