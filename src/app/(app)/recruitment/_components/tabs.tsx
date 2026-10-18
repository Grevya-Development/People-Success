import Link from "next/link";
import { BarChart3, Briefcase, CalendarClock, ClipboardList, FileSignature, Users } from "lucide-react";
import { EmptyState, NoAccess, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { PersonCell } from "@/components/person";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, type RequestContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { listRequisitions } from "@/server/services/recruitment/requisitions";
import { listOpenings } from "@/server/services/recruitment/openings";
import { candidateFilterOptions, listCandidates } from "@/server/services/recruitment/candidates";
import { myInterviews, upcomingInterviews, type InterviewListItem } from "@/server/services/recruitment/interviews";
import { listOffers } from "@/server/services/recruitment/offers";
import { recruitmentAnalytics } from "@/server/services/recruitment/analytics";
import { listScorecards, listStages } from "@/server/services/recruitment/stages";
import { canManageOffers, canManageRecruitment, canSeeOffers, canViewRecruitment } from "@/server/services/recruitment/shared";
import { openingOptions } from "@/server/services/recruitment/openings";
import { formatDate, formatMoney, formatPercent, titleCase } from "@/lib/format";
import { candidateListSchema, formatIst, SOURCE_LABELS } from "@/lib/validation/recruitment";
import { CandidateFilters } from "./candidate-filters";
import { AddCandidateDialog } from "./add-candidate-dialog";
import { StagesManager, ScorecardsManager } from "./settings";
import { tenants } from "@/server/db/schema";
import { eq } from "drizzle-orm";

async function guard<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof AppError && err.code === "FORBIDDEN") return { ok: false };
    throw err;
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto rounded-xl border bg-card">{children}</div>;
}

/* Requisitions ---------------------------------------------------------- */

export async function RequisitionsTab({ ctx, status }: { ctx: RequestContext; status?: string }) {
  const res = await guard(() => listRequisitions(ctx, { status }));
  if (!res.ok) return <NoAccess />;
  const rows = res.data;
  if (!rows.length) {
    return (
      <EmptyState
        icon={ClipboardList}
        title={status ? `No ${status.replace(/_/g, " ")} requisitions` : "No requisitions yet"}
        description="A requisition asks for approved headcount. Once the department head and finance approve it, recruiters can open the job."
        action={
          can(ctx, "requisitions.create", "all") ? (
            <Button size="sm" asChild>
              <Link href="/recruitment/requisitions/new">Raise a requisition</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }
  const filters = ["pending_approval", "approved", "draft", "filled"];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
        <Button size="xs" variant={!status ? "secondary" : "ghost"} asChild>
          <Link href="/recruitment?tab=requisitions">All</Link>
        </Button>
        {filters.map((f) => (
          <Button key={f} size="xs" variant={status === f ? "secondary" : "ghost"} asChild>
            <Link href={`/recruitment?tab=requisitions&status=${f}`}>{titleCase(f)}</Link>
          </Button>
        ))}
      </div>
      <Shell>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Requisition</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Hiring manager</TableHead>
              <TableHead className="text-right">Headcount</TableHead>
              <TableHead className="text-right">Jobs</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Raised</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="min-w-56">
                  <Link href={`/recruitment/requisitions/${r.id}`} className="font-medium hover:underline">
                    {r.title}
                  </Link>
                  <div className="text-xs text-muted-foreground tabular">{r.code}</div>
                </TableCell>
                <TableCell className="text-muted-foreground">{r.department ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{r.hiringManager ?? "—"}</TableCell>
                <TableCell className="text-right tabular">{r.headcount}</TableCell>
                <TableCell className="text-right tabular">{r.openings}</TableCell>
                <TableCell>
                  <StatusBadge status={r.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(r.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Shell>
    </div>
  );
}

/* Openings -------------------------------------------------------------- */

export async function OpeningsTab({ ctx }: { ctx: RequestContext }) {
  const res = await guard(() => listOpenings(ctx));
  if (!res.ok) return <NoAccess />;
  const rows = res.data;
  const [tenant] = await ctx.db((tx) => tx.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, ctx.tenantId)));
  if (!rows.length) {
    return (
      <EmptyState
        icon={Briefcase}
        title="No jobs yet"
        description="Open a job from an approved requisition, write the description, then publish it to your careers page."
        action={
          canManageRecruitment(ctx) ? (
            <Button size="sm" asChild>
              <Link href="/recruitment/openings/new">Create a job</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="space-y-3">
      {tenant ? (
        <p className="text-sm text-muted-foreground">
          Published jobs appear on your public careers page:{" "}
          <Link href={`/careers/${tenant.slug}`} className="font-medium text-foreground underline-offset-4 hover:underline" target="_blank">
            /careers/{tenant.slug}
          </Link>
        </p>
      ) : null}
      <Shell>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Job</TableHead>
              <TableHead>Location</TableHead>
              <TableHead className="text-right">In pipeline</TableHead>
              <TableHead className="text-right">Hired</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Published</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="min-w-56">
                  <Link href={`/recruitment/openings/${o.id}`} className="font-medium hover:underline">
                    {o.title}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {[o.department, titleCase(o.workMode), o.requisitionCode].filter(Boolean).join(" · ")}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{o.location ?? "—"}</TableCell>
                <TableCell className="text-right tabular">{o.activeApplicants}</TableCell>
                <TableCell className="text-right tabular">
                  {o.hired}/{o.openings}
                </TableCell>
                <TableCell>
                  <StatusBadge status={o.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">{o.publishedAt ? formatDate(o.publishedAt) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Shell>
    </div>
  );
}

/* Candidates ------------------------------------------------------------ */

export async function CandidatesTab({ ctx, params }: { ctx: RequestContext; params: Record<string, string | undefined> }) {
  if (!canViewRecruitment(ctx)) return <NoAccess />;
  const query = candidateListSchema.parse(params);
  const [result, filters, openings] = await Promise.all([listCandidates(ctx, query), candidateFilterOptions(ctx), canManageRecruitment(ctx) ? openingOptions(ctx, { onlyOpen: true }) : Promise.resolve([])]);
  const filtered = !!(query.q || query.source || query.tag || query.poolId);
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <CandidateFilters pools={filters.pools.map((p) => ({ value: p.id, label: `${p.name} (${p.members})` }))} tags={filters.tags} canManage={canManageRecruitment(ctx)} />
        {canManageRecruitment(ctx) ? <AddCandidateDialog openings={openings} /> : null}
      </div>
      {!result.items.length ? (
        <EmptyState
          icon={Users}
          title={filtered ? "No matching candidates" : "No candidates yet"}
          description={filtered ? "Try another search or clear the filters." : "Candidates appear when people apply on your careers page, are referred by employees, or are added by a recruiter."}
        />
      ) : (
        <>
          <Shell>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Candidate</TableHead>
                  <TableHead>Latest application</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead className="text-right">Applications</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="min-w-56">
                      <PersonCell id={c.id} name={c.name} subtitle={[c.currentTitle, c.currentCompany].filter(Boolean).join(" · ") || c.email} href={`/recruitment/candidates/${c.id}`} />
                    </TableCell>
                    <TableCell className="min-w-48 text-muted-foreground">
                      {c.latest ? (
                        <>
                          <span className="text-foreground">{c.latest.openingTitle}</span>
                          <div className="text-xs">
                            {c.latest.status === "active" ? c.latest.stage : titleCase(c.latest.status)} · {formatDate(c.latest.appliedAt)}
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{SOURCE_LABELS[c.source] ?? titleCase(c.source)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {c.tags.slice(0, 3).map((t) => (
                          <StatusBadge key={t} status={t} tone={t === "possible-duplicate" ? "warning" : "neutral"} className="normal-case" />
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular">{c.applications}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Shell>
          {result.pageCount > 1 ? (
            <nav className="flex items-center justify-between text-sm text-muted-foreground" aria-label="Pagination">
              <span className="tabular">
                Page {result.page} of {result.pageCount} · {result.total} candidates
              </span>
              <div className="flex gap-2">
                {result.page > 1 ? (
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/recruitment?${new URLSearchParams({ ...stripEmpty(params), tab: "candidates", page: String(result.page - 1) })}`}>Previous</Link>
                  </Button>
                ) : null}
                {result.page < result.pageCount ? (
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/recruitment?${new URLSearchParams({ ...stripEmpty(params), tab: "candidates", page: String(result.page + 1) })}`}>Next</Link>
                  </Button>
                ) : null}
              </div>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

function stripEmpty(p: Record<string, string | undefined>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) if (v && k !== "page") out[k === "poolId" ? "pool" : k] = v;
  return out;
}

/* Interviews ------------------------------------------------------------ */

function InterviewTable({ rows, empty, action }: { rows: InterviewListItem[]; empty: string; action?: "feedback" }) {
  if (!rows.length) return <p className="px-5 py-6 text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>When</TableHead>
            <TableHead>Candidate</TableHead>
            <TableHead>Round</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-32" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="whitespace-nowrap tabular">{formatIst(i.scheduledStart)}</TableCell>
              <TableCell className="min-w-48">
                <span className="font-medium">{i.candidateName}</span>
                <div className="text-xs text-muted-foreground">{i.openingTitle}</div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {i.roundName} · {titleCase(i.mode)}
              </TableCell>
              <TableCell>
                <StatusBadge status={i.status} tone={i.status === "scheduled" ? "info" : undefined} />
              </TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant={action === "feedback" ? "default" : "outline"} asChild>
                  <Link href={`/recruitment/interviews/${i.id}`}>{action === "feedback" ? "Give feedback" : "Open"}</Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export async function InterviewsTab({ ctx }: { ctx: RequestContext }) {
  const mine = await guard(() => myInterviews(ctx));
  if (!mine.ok) return <NoAccess />;
  const all = canViewRecruitment(ctx) ? await upcomingInterviews(ctx) : null;
  const nothing = !mine.data.upcoming.length && !mine.data.awaitingFeedback.length && !all?.length;
  if (nothing) {
    return <EmptyState icon={CalendarClock} title="No interviews" description="Interviews you are on the panel for, and ones awaiting your feedback, appear here." />;
  }
  return (
    <div className="space-y-5">
      <Section title="Awaiting your feedback" description="Submit your scorecard before reading others'.">
        <InterviewTable rows={mine.data.awaitingFeedback} empty="You're all caught up." action="feedback" />
      </Section>
      <Section title="Your upcoming interviews">
        <InterviewTable rows={mine.data.upcoming} empty="No upcoming interviews on your calendar." />
      </Section>
      {all ? (
        <Section title="All upcoming interviews" description="Next 30 days, across every job.">
          <InterviewTable rows={all} empty="No interviews scheduled in the next 30 days." />
        </Section>
      ) : null}
    </div>
  );
}

/* Offers ---------------------------------------------------------------- */

export async function OffersTab({ ctx, status }: { ctx: RequestContext; status?: string }) {
  if (!canSeeOffers(ctx)) return <NoAccess />;
  const rows = await listOffers(ctx, { status: status as never });
  if (!rows.length) {
    return (
      <EmptyState
        icon={FileSignature}
        title="No offers yet"
        description="Move a candidate to the Offer stage, then create an offer. Offers go through HR and finance approval before they are sent."
        action={
          canManageOffers(ctx) ? (
            <Button size="sm" asChild>
              <Link href="/recruitment/offers/new">Create an offer</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="space-y-3">
      {canManageOffers(ctx) ? (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" asChild>
            <Link href="/recruitment/offers/new">New offer</Link>
          </Button>
        </div>
      ) : null}
      <Shell>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Candidate</TableHead>
              <TableHead className="text-right">Annual CTC</TableHead>
              <TableHead>Joining</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="min-w-56">
                  <Link href={`/recruitment/offers/${o.id}`} className="font-medium hover:underline">
                    {o.candidateName}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {o.openingTitle} · v{o.version}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular">{formatMoney(o.annualCtc, "INR", { compact: true })}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(o.joiningDate)}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(o.expiresOn)}</TableCell>
                <TableCell>
                  <StatusBadge status={o.status} tone={o.status === "sent" ? "info" : o.status === "pending_approval" ? "warning" : undefined} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Shell>
    </div>
  );
}

/* Analytics ------------------------------------------------------------- */

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="space-y-1 bg-card p-5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular">{value}</div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export async function AnalyticsTab({ ctx, openingId }: { ctx: RequestContext; openingId?: string }) {
  if (!canViewRecruitment(ctx)) return <NoAccess />;
  const valid = openingId && /^[0-9a-f-]{36}$/i.test(openingId) ? openingId : null;
  const [a, openings] = await Promise.all([recruitmentAnalytics(ctx, { openingId: valid }), openingOptions(ctx)]);
  if (!a.totalApplications) {
    return <EmptyState icon={BarChart3} title="No pipeline data yet" description="Analytics fill in as candidates apply and move through your stages." />;
  }
  const max = Math.max(1, ...a.funnel.map((f) => f.reached));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by job">
        <Button size="xs" variant={!valid ? "secondary" : "ghost"} asChild>
          <Link href="/recruitment?tab=analytics">All jobs</Link>
        </Button>
        {openings.slice(0, 12).map((o) => (
          <Button key={o.value} size="xs" variant={valid === o.value ? "secondary" : "ghost"} asChild>
            <Link href={`/recruitment?tab=analytics&opening=${o.value}`}>{o.label}</Link>
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
        <Stat label="Applications" value={String(a.totalApplications)} />
        <Stat label="Median time to hire" value={a.timeToHire.medianDays == null ? "—" : `${a.timeToHire.medianDays} days`} hint={`Applied → hired, ${a.timeToHire.hires} hire(s)`} />
        <Stat label="Average time to hire" value={a.timeToHire.averageDays == null ? "—" : `${a.timeToHire.averageDays} days`} />
        <Stat
          label="Offer acceptance"
          value={a.offers ? formatPercent(a.offers.rate) : "—"}
          hint={a.offers ? `${a.offers.accepted} accepted · ${a.offers.declined} declined · ${a.offers.expired} expired` : "Visible to offer managers and approvers"}
        />
      </div>
      <Section title="Pipeline funnel" description="Applications that reached each stage (current stage or any stage they passed through). Conversion is from the previous stage.">
        <ol className="space-y-2.5 p-5">
          {a.funnel.map((f) => (
            <li key={f.stageId} className="grid grid-cols-[8rem_1fr_6rem] items-center gap-3 text-sm sm:grid-cols-[10rem_1fr_7rem]">
              <span className="truncate">{f.name}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span className="block h-full rounded-full bg-brand" style={{ width: `${(f.reached / max) * 100}%` }} />
              </span>
              <span className="text-right tabular text-muted-foreground">
                {f.reached}
                {f.conversion != null ? ` · ${formatPercent(f.conversion)}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Source effectiveness" description="Interviewed = reached an interview stage or later. Hire rate = hires ÷ applications.">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Applications</TableHead>
                <TableHead className="text-right">Interviewed</TableHead>
                <TableHead className="text-right">Hired</TableHead>
                <TableHead className="text-right">Hire rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {a.sources.map((s) => (
                <TableRow key={s.source}>
                  <TableCell>{SOURCE_LABELS[s.source] ?? titleCase(s.source)}</TableCell>
                  <TableCell className="text-right tabular">{s.applications}</TableCell>
                  <TableCell className="text-right tabular">{s.interviewed}</TableCell>
                  <TableCell className="text-right tabular">{s.hired}</TableCell>
                  <TableCell className="text-right tabular">{formatPercent(s.hireRate, 1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>
    </div>
  );
}

/* Settings -------------------------------------------------------------- */

export async function SettingsTab({ ctx }: { ctx: RequestContext }) {
  if (!canManageRecruitment(ctx)) return <NoAccess />;
  const [stages, scorecards] = await Promise.all([listStages(ctx), listScorecards(ctx)]);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Section title="Pipeline stages" description="Applied is always first and Hired always last. Candidates reach Hired only by accepting an offer.">
        <StagesManager stages={stages} />
      </Section>
      <Section title="Interview scorecards" description="Criteria interviewers rate (1–5). Choose a scorecard when scheduling an interview.">
        <ScorecardsManager scorecards={scorecards} />
      </Section>
    </div>
  );
}
