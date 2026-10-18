import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Briefcase, Gift, Handshake } from "lucide-react";
import { EmptyState, Page, PageHeader, Reveal, Section, TableSkeleton } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { LinkTabs } from "@/components/documents/link-tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext, type RequestContext } from "@/server/auth/context";
import { activeRewardPolicy, allReferrals, canManageReferrals, listRewardPolicies, myReferrals, referralFunnel, referralJobs } from "@/server/services/recruitment/referrals";
import { canViewRecruitment } from "@/server/services/recruitment/shared";
import { formatDate, formatMoney, titleCase } from "@/lib/format";
import { ReferDialog } from "./refer-dialog";
import { PolicyDialog, RewardActions } from "./program-controls";

export const metadata: Metadata = { title: "Referrals" };

export default function ReferralsPage({ searchParams }: PageProps<"/referrals">) {
  return (
    <Page>
      <PageHeader title="Referrals" description="Know someone great? Refer them for an open role and follow their progress." />
      <Suspense fallback={<TableSkeleton rows={5} columns={4} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

const REWARD_TONE: Record<string, "neutral" | "warning" | "info" | "success" | "danger"> = {
  not_applicable: "neutral",
  pending: "neutral",
  eligible: "warning",
  approved: "info",
  paid: "success",
  cancelled: "neutral",
};
const REWARD_LABEL: Record<string, string> = {
  not_applicable: "—",
  pending: "Waiting period",
  eligible: "Eligible",
  approved: "Approved",
  paid: "Paid",
  cancelled: "Not payable",
};

async function Body({ searchParams }: { searchParams: PageProps<"/referrals">["searchParams"] }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const manage = canManageReferrals(ctx);
  const tabs = [
    { key: "jobs", label: "Open jobs", href: "/referrals" },
    { key: "mine", label: "My referrals", href: "/referrals?tab=mine" },
    ...(manage ? [{ key: "rewards", label: "Program", href: "/referrals?tab=rewards" }] : []),
  ];
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? "jobs";
  return (
    <>
      <LinkTabs label="Referral sections" active={tab} tabs={tabs} />
      <Reveal key={tab}>
        {tab === "jobs" ? <Jobs ctx={ctx} /> : null}
        {tab === "mine" ? <Mine ctx={ctx} /> : null}
        {tab === "rewards" && manage ? <Program ctx={ctx} /> : null}
      </Reveal>
    </>
  );
}

async function Jobs({ ctx }: { ctx: RequestContext }) {
  const [jobs, policy] = await Promise.all([referralJobs(ctx), activeRewardPolicy(ctx)]);
  return (
    <div className="space-y-4">
      {policy ? (
        <div className="flex items-start gap-3 rounded-xl border bg-brand-soft/40 p-4 text-sm">
          <Gift className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          <p>
            Earn <span className="font-medium tabular">{formatMoney(policy.amount, "INR", { compact: true })}</span> when someone you refer is hired and completes {policy.eligibleAfterDays} days with us. Paid through payroll.
          </p>
        </div>
      ) : null}
      {!ctx.employeeId ? (
        <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">Your login is not linked to an employee record, so you cannot submit referrals yet. Ask HR to link it.</p>
      ) : null}
      {!jobs.length ? (
        <EmptyState icon={Briefcase} title="No open jobs right now" description="Jobs appear here as soon as recruiters publish them." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {jobs.map((j) => (
            <li key={j.id} className="flex flex-col justify-between gap-3 rounded-xl border bg-card p-5">
              <div>
                <h2 className="font-semibold">{j.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{[j.department, j.location, titleCase(j.workMode), titleCase(j.employmentType)].filter(Boolean).join(" · ")}</p>
                {j.skills.length ? <p className="mt-2 text-xs text-muted-foreground">Skills: {j.skills.slice(0, 6).join(", ")}</p> : null}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{j.publishedAt ? `Posted ${formatDate(j.publishedAt)}` : ""}</span>
                {ctx.employeeId ? <ReferDialog openingId={j.id} jobTitle={j.title} /> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function Mine({ ctx }: { ctx: RequestContext }) {
  const rows = await myReferrals(ctx);
  if (!rows.length) return <EmptyState icon={Handshake} title="No referrals yet" description="When you refer someone, you can follow their progress here." action={<Link href="/referrals" className="text-sm font-medium underline-offset-4 hover:underline">See open jobs</Link>} />;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Candidate</TableHead>
            <TableHead>Job</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Reward</TableHead>
            <TableHead>Referred</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.candidateName}</TableCell>
              <TableCell className="text-muted-foreground">{r.openingTitle ?? "—"}</TableCell>
              <TableCell>
                <StatusBadge status={r.status} tone={r.status === "duplicate" ? "neutral" : r.status === "interviewing" ? "info" : undefined} label={r.status === "duplicate" ? "Already considered" : undefined} />
              </TableCell>
              <TableCell>
                {r.rewardStatus === "not_applicable" ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={r.rewardStatus} label={REWARD_LABEL[r.rewardStatus]} tone={REWARD_TONE[r.rewardStatus]} />
                    {r.rewardAmount ? <span className="text-xs tabular text-muted-foreground">{formatMoney(r.rewardAmount, "INR", { compact: true })}</span> : null}
                    {r.rewardStatus === "pending" && r.rewardEligibleOn ? <span className="text-xs text-muted-foreground">from {formatDate(r.rewardEligibleOn)}</span> : null}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">{formatDate(r.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

async function Program({ ctx }: { ctx: RequestContext }) {
  const [funnel, rows, policies] = await Promise.all([referralFunnel(ctx), allReferrals(ctx), listRewardPolicies(ctx)]);
  const recruiter = canViewRecruitment(ctx);
  const tiles: [string, string, string?][] = [
    ["Referred", String(funnel.referred), `${funnel.duplicates} duplicate(s) not counted`],
    ["Interviewing or beyond", String(funnel.interviewing)],
    ["Hired", String(funnel.hired)],
    ["Rewards paid", String(funnel.rewardsPaid), formatMoney(funnel.rewardsPaidAmount, "INR", { compact: true })],
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
        {tiles.map(([label, value, hint]) => (
          <div key={label} className="space-y-1 bg-card p-5">
            <div className="text-xs font-medium text-muted-foreground">{label}</div>
            <div className="text-2xl font-semibold tabular">{value}</div>
            {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
          </div>
        ))}
      </div>
      <Section title="Reward policies" actions={<PolicyDialog />}>
        {policies.length ? (
          <ul className="divide-y">
            {policies.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <span>
                  <span className="font-medium">{p.name}</span> · <span className="tabular">{formatMoney(p.amount, p.currency, { compact: true })}</span> after {p.eligibleAfterDays} days {p.isActive ? <StatusBadge status="active" className="ml-1" /> : <StatusBadge status="inactive" tone="neutral" className="ml-1" />}
                </span>
                <PolicyDialog policy={p} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-4 text-sm text-muted-foreground">No reward policy yet. Referrals are tracked, but no reward is offered until you add one.</p>
        )}
      </Section>
      <Section title="All referrals" description="Rewards become eligible automatically after the waiting period if the hire is still active. Approving posts the reward to the referrer's next open payroll period.">
        {rows.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Candidate</TableHead>
                  <TableHead>Referred by</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reward</TableHead>
                  <TableHead className="w-44" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {recruiter ? (
                        <Link href={`/recruitment/candidates/${r.candidateId}`} className="hover:underline">
                          {r.candidateName}
                        </Link>
                      ) : (
                        r.candidateName
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.referrerName}</TableCell>
                    <TableCell className="text-muted-foreground">{r.openingTitle ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell>
                      {r.rewardStatus === "not_applicable" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={r.rewardStatus} label={REWARD_LABEL[r.rewardStatus]} tone={REWARD_TONE[r.rewardStatus]} />
                          {r.rewardAmount ? <span className="text-xs tabular text-muted-foreground">{formatMoney(r.rewardAmount, "INR", { compact: true })}</span> : null}
                          {r.rewardStatus === "pending" && r.rewardEligibleOn ? <span className="text-xs text-muted-foreground">from {formatDate(r.rewardEligibleOn)}</span> : null}
                          {r.rewardStatus === "approved" && !r.payrollInputId ? <span className="text-xs text-muted-foreground">awaiting payroll period</span> : null}
                          {r.rewardStatus === "paid" ? <span className="text-xs text-muted-foreground">{r.payrollInputId ? "via payroll" : "marked paid"}</span> : null}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <RewardActions referralId={r.id} rewardStatus={r.rewardStatus} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="px-5 py-4 text-sm text-muted-foreground">No referrals yet.</p>
        )}
      </Section>
    </div>
  );
}
