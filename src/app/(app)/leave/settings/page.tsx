import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Palmtree, ScrollText } from "lucide-react";
import { cn } from "cn";
import { EmptyState, NoAccess, Page, PageHeader, Reveal, Section, TableSkeleton } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, requireContext } from "@/server/auth/context";
import { listLeavePolicies, listLeaveTypes, rulesFor } from "@/server/services/time/leave-types";
import { employeeFormLookups } from "@/server/services/employees/lookups";
import { titleCase, todayIn } from "@/lib/format";
import { dotClass } from "../_components/tones";
import { LeaveTypeDialog } from "./leave-type-dialog";
import { LeavePolicyDialog } from "./leave-policy-dialog";
import { PolicyToggle } from "./policy-toggle";
import { StandardTypesButton } from "./standard-types-button";

export const metadata: Metadata = { title: "Leave settings" };

const ACCRUAL_LABEL: Record<string, string> = { none: "Granted by HR", monthly: "Monthly", quarterly: "Quarterly", annual_upfront: "Yearly up front" };

export default function LeaveSettingsPage() {
  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link href="/leave" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3" /> Leave
          </Link>
        }
        title="Leave settings"
        description="Leave types, versioned policies and holidays. Leave year runs January to December."
      />
      <Suspense fallback={<TableSkeleton rows={6} columns={6} />}>
        <Content />
      </Suspense>
    </Page>
  );
}

async function Content() {
  const ctx = await requireContext();
  if (!can(ctx, "leave.manage", "all")) return <NoAccess />;
  const [types, policies, lookups] = await Promise.all([listLeaveTypes(ctx, { includeInactive: true }), listLeavePolicies(ctx), employeeFormLookups(ctx)]);
  const today = todayIn();
  const typeOptions = types.map((t) => ({ value: t.id, label: `${t.name} (${t.code})` }));
  const options = { locations: lookups.locations, departments: lookups.departments, legalEntities: lookups.legalEntities };

  return (
    <Reveal className="space-y-6">
      <p className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
        Defaults are starting points to review, not legal advice. Minimum entitlements depend on your state&apos;s Shops &amp; Establishments Act (or the Factories Act) and your
        establishment type.
      </p>

      <Section
        title="Leave types"
        actions={
          <>
            <StandardTypesButton variant={types.length ? "outline" : "default"} />
            <LeaveTypeDialog />
          </>
        }
      >
        {types.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Leave type</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead className="hidden md:table-cell">Half days</TableHead>
                  <TableHead className="hidden md:table-cell">Negative</TableHead>
                  <TableHead className="hidden lg:table-cell">Document</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-5 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="pl-5">
                      <span className="inline-flex items-center gap-2 font-medium">
                        <span className={cn("size-2 rounded-full", dotClass(t.color))} aria-hidden />
                        {t.name}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">{t.code}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{titleCase(t.category)}</TableCell>
                    <TableCell>{t.isPaid ? "Paid" : <StatusBadge status="unpaid" label="Unpaid" tone="danger" />}</TableCell>
                    <TableCell className="hidden md:table-cell">{t.allowHalfDay ? "Yes" : "No"}</TableCell>
                    <TableCell className="hidden md:table-cell">{t.allowNegative ? `Up to ${t.maxNegativeDays}` : "No"}</TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">
                      {t.requiresDocumentAfterDays == null ? "—" : t.requiresDocumentAfterDays === 0 ? "Always" : `Beyond ${t.requiresDocumentAfterDays} days`}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={t.isActive ? "active" : "inactive"} tone={t.isActive ? "success" : "neutral"} />
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      <LeaveTypeDialog
                        values={{
                          id: t.id,
                          code: t.code,
                          name: t.name,
                          category: t.category,
                          isPaid: t.isPaid,
                          allowHalfDay: t.allowHalfDay,
                          allowNegative: t.allowNegative,
                          maxNegativeDays: t.maxNegativeDays,
                          requiresDocumentAfterDays: t.requiresDocumentAfterDays,
                          color: (["info", "success", "warning", "danger", "brand", "neutral"].includes(t.color) ? t.color : "info") as "info",
                          sortOrder: t.sortOrder,
                          isActive: t.isActive,
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState
            className="m-4 border-0"
            icon={Palmtree}
            title="No leave types yet"
            description="Start from the standard Indian set (EL, CL, SL, comp off, LOP, maternity, paternity, bereavement) and adjust, or create your own."
          />
        )}
      </Section>

      <Section
        title="Policies"
        description="Each change publishes a new version that applies from its effective date; earlier dates keep the version that applied then."
        actions={types.length ? <LeavePolicyDialog types={typeOptions} options={options} today={today} /> : null}
      >
        {policies.length ? (
          <ul className="divide-y">
            {policies.map((p) => {
              const r = rulesFor(p);
              const conditionCount = Object.values(p.conditions).reduce((n, v) => n + (Array.isArray(v) ? v.length : v ? 1 : 0), 0);
              return (
                <li key={p.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <ScrollText className="size-4 text-muted-foreground" />
                      {p.name}
                      <span className="text-xs font-normal text-muted-foreground">
                        {p.typeCode} · v{p.version}
                        {p.versions > 1 ? ` (${p.versions} versions)` : ""} · from {p.effectiveFrom} · priority {p.priority}
                      </span>
                      {!p.isActive ? <StatusBadge status="inactive" tone="neutral" /> : null}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {p.typeIsPaid ? ACCRUAL_LABEL[r.accrual.method] : "Loss of pay"}
                      {r.accrual.method !== "none" ? ` · ${r.accrual.daysPerYear} days/year${r.accrual.prorateOnJoining ? ", prorated" : ""}` : ""}
                      {r.maxBalance != null ? ` · cap ${r.maxBalance}` : ""}
                      {!p.typeIsPaid
                        ? " · unpaid, no balance"
                        : p.typeCategory === "comp_off"
                          ? " · each grant expires on its own date"
                          : r.carryForward.enabled
                            ? ` · carry forward ${r.carryForward.maxDays}${r.carryForward.expiresAfterMonths ? ` (expires in ${r.carryForward.expiresAfterMonths} mo)` : ""}`
                            : " · lapses at year end"}
                      {r.encashment.enabled ? ` · encash ${r.encashment.maxDaysPerYear}/yr` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        r.waitingPeriodDays ? `${r.waitingPeriodDays}-day waiting period` : null,
                        r.minNoticeDays ? `${r.minNoticeDays} days notice` : null,
                        r.maxConsecutiveDays != null ? `max ${r.maxConsecutiveDays} at a time` : null,
                        r.sandwich ? "sandwich rule" : null,
                        r.blackouts.length ? `${r.blackouts.length} blackout(s)` : null,
                        conditionCount ? `${conditionCount} condition(s)` : "applies to everyone",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <LeavePolicyDialog
                      types={typeOptions}
                      options={options}
                      today={today}
                      values={{
                        id: p.id,
                        leaveTypeId: p.leaveTypeId,
                        name: p.name,
                        priority: p.priority,
                        effectiveFrom: p.effectiveFrom,
                        conditions: {
                          employmentType: ([] as string[]).concat(p.conditions.employmentType ?? []) as never,
                          locationId: ([] as string[]).concat(p.conditions.locationId ?? []),
                          legalEntityId: ([] as string[]).concat(p.conditions.legalEntityId ?? []),
                          departmentId: ([] as string[]).concat(p.conditions.departmentId ?? []),
                        },
                        accrualMethod: r.accrual.method,
                        daysPerYear: r.accrual.daysPerYear,
                        prorateOnJoining: r.accrual.prorateOnJoining,
                        waitingPeriodDays: r.waitingPeriodDays,
                        carryForwardEnabled: r.carryForward.enabled,
                        carryForwardMaxDays: r.carryForward.maxDays,
                        carryForwardExpiresAfterMonths: r.carryForward.expiresAfterMonths,
                        encashmentEnabled: r.encashment.enabled,
                        encashmentMaxDaysPerYear: r.encashment.maxDaysPerYear,
                        maxBalance: r.maxBalance,
                        minNoticeDays: r.minNoticeDays,
                        maxConsecutiveDays: r.maxConsecutiveDays,
                        sandwich: r.sandwich,
                        blackouts: r.blackouts,
                      }}
                    />
                    <PolicyToggle id={p.id} isActive={p.isActive} name={p.name} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState className="m-4 border-0" icon={ScrollText} title="No policies" description="Create a policy for each leave type so employees can accrue and apply." />
        )}
      </Section>

      <Link href="/attendance/settings?tab=holidays" className="group flex items-center gap-4 rounded-xl border bg-card p-5 transition-colors hover:bg-muted/40">
        <span className="flex size-10 items-center justify-center rounded-lg bg-brand-soft text-brand">
          <CalendarDays className="size-5" />
        </span>
        <div className="flex-1">
          <p className="text-sm font-medium">Holiday calendars</p>
          <p className="text-sm text-muted-foreground">Public holidays are excluded from leave days (unless the sandwich rule applies).</p>
        </div>
        <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>
    </Reveal>
  );
}
