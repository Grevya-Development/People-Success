import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, CalendarDays, Clock, FolderKanban, ShieldCheck, Star, Trash2 } from "lucide-react";
import { EmptyState, NoAccess, Page, PageHeader, Reveal, Section, TableSkeleton } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LinkTabs, type LinkTab } from "@/components/documents/link-tabs";
import { can, requireContext, type RequestContext } from "@/server/auth/context";
import { canManageHolidays, listHolidayCalendars } from "@/server/services/time/holidays";
import { listShiftAssignments, listShifts, rulesOf } from "@/server/services/time/shifts";
import { listAttendancePolicies } from "@/server/services/time/attendance-policies";
import { listProjects } from "@/server/services/time/timesheets";
import { employeeFormLookups } from "@/server/services/employees/lookups";
import { formatDate, titleCase, todayIn } from "@/lib/format";
import { ConfirmAction } from "@/app/(app)/settings/_components/run-action";
import { deleteHolidayCalendarAction, removeShiftAssignmentAction, setDefaultShiftAction } from "../actions";
import { CopyCalendarDialog, HolidayCalendarDialog, LocationCalendarSelect } from "./_components/holiday-dialogs";
import { AssignShiftDialog, ShiftDialog } from "./_components/shift-dialogs";
import { AttendancePolicyDialog } from "./_components/attendance-policy-dialog";
import { ProjectDialog } from "./_components/project-dialog";
import { minutesLabel } from "../_components/status";

export const metadata: Metadata = { title: "Attendance settings" };

type TabKey = "holidays" | "shifts" | "policies" | "projects";

function tabsFor(ctx: RequestContext): LinkTab[] {
  const manage = can(ctx, "attendance.manage", "all");
  const tabs: (LinkTab & { show: boolean })[] = [
    { key: "holidays", label: "Holidays", href: "/attendance/settings?tab=holidays", show: canManageHolidays(ctx) },
    { key: "shifts", label: "Shifts", href: "/attendance/settings?tab=shifts", show: manage },
    { key: "policies", label: "Attendance policies", href: "/attendance/settings?tab=policies", show: manage },
    { key: "projects", label: "Projects", href: "/attendance/settings?tab=projects", show: manage },
  ];
  return tabs.filter((t) => t.show).map(({ key, label, href }) => ({ key, label, href }));
}

export default function AttendanceSettingsPage({ searchParams }: PageProps<"/attendance/settings">) {
  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link href="/attendance" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3" /> Attendance
          </Link>
        }
        title="Attendance settings"
        description="Holiday calendars, shifts, attendance policies and timesheet projects."
      />
      <Suspense
        fallback={
          <>
            <Skeleton className="mb-5 h-8 w-96" />
            <TableSkeleton rows={5} columns={5} />
          </>
        }
      >
        <Body searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Body({ searchParams }: { searchParams: PageProps<"/attendance/settings">["searchParams"] }) {
  const ctx = await requireContext();
  const tabs = tabsFor(ctx);
  if (!tabs.length) return <NoAccess />;
  const sp = await searchParams;
  const tab = (tabs.find((t) => t.key === sp.tab) ?? tabs[0]).key as TabKey;
  return (
    <>
      <LinkTabs tabs={tabs} active={tab} label="Attendance settings sections" />
      <Suspense key={tab} fallback={<TableSkeleton rows={5} columns={5} />}>
        {tab === "holidays" ? <Holidays ctx={ctx} /> : tab === "shifts" ? <Shifts ctx={ctx} /> : tab === "policies" ? <Policies ctx={ctx} /> : <Projects ctx={ctx} />}
      </Suspense>
    </>
  );
}

/* ------------------------------------------------------------------ */

async function Holidays({ ctx }: { ctx: RequestContext }) {
  const { calendars, locations } = await listHolidayCalendars(ctx);
  const calendarOptions = calendars.map((c) => ({ id: c.id, label: `${c.name} · ${c.year}` }));
  return (
    <Reveal className="space-y-6">
      <Section title="Holiday calendars" description="Public holidays are days off and payable. Restricted holidays are optional." actions={<HolidayCalendarDialog />}>
        {calendars.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Calendar</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead className="text-right">Holidays</TableHead>
                  <TableHead className="hidden md:table-cell">Locations</TableHead>
                  <TableHead className="pr-5 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calendars.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="pl-5">
                      <Link href={`/attendance/settings/holidays/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      {c.isDefault ? <StatusBadge status="default" label="Default" tone="brand" className="ml-2" /> : null}
                    </TableCell>
                    <TableCell className="tabular">{c.year}</TableCell>
                    <TableCell className="text-right tabular">{c.holidayCount}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{c.locations.join(", ") || "—"}</TableCell>
                    <TableCell className="pr-5">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/attendance/settings/holidays/${c.id}`}>Holidays</Link>
                        </Button>
                        <HolidayCalendarDialog values={{ id: c.id, name: c.name, year: c.year, isDefault: c.isDefault }} />
                        <CopyCalendarDialog calendarId={c.id} name={c.name} year={c.year} />
                        <ConfirmAction
                          trigger={
                            <Button variant="ghost" size="icon-sm" aria-label={`Delete ${c.name}`}>
                              <Trash2 />
                            </Button>
                          }
                          title={`Delete ${c.name} ${c.year}?`}
                          description="Its holidays are removed and locations using it fall back to the year's default calendar. Recompute attendance afterwards if days were already processed."
                          confirmLabel="Delete"
                          destructive
                          action={deleteHolidayCalendarAction}
                          input={{ id: c.id }}
                          success="Calendar deleted"
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState className="m-4 border-0" icon={CalendarDays} title="No holiday calendars" description="Create a calendar for this year and add your company's public holidays." />
        )}
      </Section>

      <Section title="Location calendars" description="Each location follows one calendar. For other years, a calendar with the same name (or that year's default) is used.">
        {locations.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableBody>
                {locations.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="pl-5 font-medium">
                      {l.name}
                      {!l.isActive ? <span className="ml-2 text-xs text-muted-foreground">inactive</span> : null}
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      <div className="flex justify-end">
                        <LocationCalendarSelect locationId={l.id} value={l.calendarId} calendars={calendarOptions} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState className="m-4 border-0" title="No locations" description="Add locations under Settings → Locations to assign calendars." />
        )}
      </Section>
    </Reveal>
  );
}

async function Shifts({ ctx }: { ctx: RequestContext }) {
  const [shifts, assignments, lookups] = await Promise.all([listShifts(ctx), listShiftAssignments(ctx, { current: true }), employeeFormLookups(ctx)]);
  const today = todayIn();
  return (
    <Reveal className="space-y-6">
      <Section title="Shifts" description="Employees without an assignment use their policy's default shift, else the tenant default." actions={<ShiftDialog />}>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Shift</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead className="hidden md:table-cell">Grace</TableHead>
                <TableHead className="hidden md:table-cell">Half / full day</TableHead>
                <TableHead className="hidden lg:table-cell">Weekly offs</TableHead>
                <TableHead className="text-right">Assigned</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-5 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shifts.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="pl-5">
                    <span className="font-medium">{s.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{s.code}</span>
                    {s.isDefault ? <StatusBadge status="default" label="Default" tone="brand" className="ml-2" /> : null}
                  </TableCell>
                  <TableCell className="tabular">
                    {s.isFlexible ? "Flexible" : `${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)}`}
                    {s.isNight ? <span className="ml-1 text-xs text-muted-foreground">(night)</span> : null}
                    <span className="block text-xs text-muted-foreground">{s.breakMinutes} min break</span>
                  </TableCell>
                  <TableCell className="hidden tabular text-muted-foreground md:table-cell">
                    {s.graceInMinutes}m in · {s.graceOutMinutes}m out
                  </TableCell>
                  <TableCell className="hidden tabular text-muted-foreground md:table-cell">
                    {minutesLabel(s.halfDayMinutes)} / {minutesLabel(s.fullDayMinutes)}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{s.weeklyOffs.map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(", ") || "None"}</TableCell>
                  <TableCell className="text-right tabular">{s.assignedCount}</TableCell>
                  <TableCell>
                    <StatusBadge status={s.isActive ? "active" : "inactive"} tone={s.isActive ? "success" : "neutral"} />
                  </TableCell>
                  <TableCell className="pr-5">
                    <div className="flex justify-end gap-1">
                      {!s.isDefault && s.isActive ? (
                        <ConfirmAction
                          trigger={
                            <Button variant="ghost" size="sm">
                              <Star /> Make default
                            </Button>
                          }
                          title={`Make ${s.name} the default shift?`}
                          description="Employees without a shift assignment (and whose policy has no default shift) will follow it from now on. Recompute past days if needed."
                          confirmLabel="Make default"
                          action={setDefaultShiftAction}
                          input={{ id: s.id }}
                          success="Default shift updated"
                        />
                      ) : null}
                      <ShiftDialog
                        values={{
                          id: s.id,
                          name: s.name,
                          code: s.code,
                          startTime: s.startTime.slice(0, 5),
                          endTime: s.endTime.slice(0, 5),
                          breakMinutes: s.breakMinutes,
                          graceInMinutes: s.graceInMinutes,
                          graceOutMinutes: s.graceOutMinutes,
                          halfDayMinutes: s.halfDayMinutes,
                          fullDayMinutes: s.fullDayMinutes,
                          weeklyOffs: s.weeklyOffs,
                          isFlexible: s.isFlexible,
                          isNight: s.isNight,
                          isActive: s.isActive,
                        }}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section
        title="Shift assignments"
        description="Current and upcoming assignments. Ranges are effective-dated and cannot overlap."
        actions={<AssignShiftDialog employees={lookups.managers} shifts={shifts.filter((s) => s.isActive).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))} today={today} />}
      >
        {assignments.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Employee</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Until</TableHead>
                  <TableHead className="pr-5 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="pl-5">
                      <span className="font-medium">{a.employeeName}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{a.employeeCode}</span>
                    </TableCell>
                    <TableCell>{a.shiftName}</TableCell>
                    <TableCell className="tabular">{formatDate(a.effectiveFrom)}</TableCell>
                    <TableCell className="tabular">{a.effectiveTo ? formatDate(a.effectiveTo) : "Open-ended"}</TableCell>
                    <TableCell className="pr-5 text-right">
                      <ConfirmAction
                        trigger={
                          <Button variant="ghost" size="icon-sm" aria-label="Remove assignment">
                            <Trash2 />
                          </Button>
                        }
                        title="Remove this assignment?"
                        description="The employee falls back to the default shift for these dates. Recompute attendance for affected past days."
                        confirmLabel="Remove"
                        destructive
                        action={removeShiftAssignmentAction}
                        input={{ id: a.id }}
                        success="Assignment removed"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState className="m-4 border-0" icon={Clock} title="No assignments" description="Everyone currently follows the default shift." />
        )}
      </Section>
    </Reveal>
  );
}

async function Policies({ ctx }: { ctx: RequestContext }) {
  const [policies, shifts, lookups] = await Promise.all([listAttendancePolicies(ctx), listShifts(ctx), employeeFormLookups(ctx)]);
  const shiftOptions = shifts.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }));
  const options = { locations: lookups.locations, departments: lookups.departments, legalEntities: lookups.legalEntities };
  const shiftName = (id: string | null | undefined) => shifts.find((s) => s.id === id)?.name ?? "Tenant default";
  return (
    <Reveal>
      <Section title="Attendance policies" description="Rules for check-in, corrections, late marks and overtime. The highest priority matching policy applies." actions={<AttendancePolicyDialog shifts={shiftOptions} options={options} />}>
        {policies.length ? (
          <ul className="divide-y">
            {policies.map((p) => {
              const r = rulesOf(p);
              const cond = Object.entries(p.conditions)
                .map(([k, v]) => `${titleCase(k.replace(/Id$/, ""))}: ${(Array.isArray(v) ? v : [v]).length}`)
                .join(" · ");
              return (
                <li key={p.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <ShieldCheck className="size-4 text-muted-foreground" />
                      {p.name}
                      <StatusBadge status={p.isActive ? "active" : "inactive"} tone={p.isActive ? "success" : "neutral"} />
                      <span className="text-xs font-normal text-muted-foreground">priority {p.priority} · v{p.version}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {r.allowWebCheckIn ? "Web check-in on" : "Web check-in off"}
                      {r.requireGeofence ? " · geofence required" : ""} · corrections within {r.regularizationWindowDays} days
                      {r.maxRegularizationsPerMonth != null ? ` (max ${r.maxRegularizationsPerMonth}/month)` : ""}
                      {r.lateMarksPerHalfDay ? ` · every ${r.lateMarksPerHalfDay} late marks = half day` : ""}
                      {r.overtimeEnabled ? ` · overtime after ${r.overtimeMinMinutes} min` : ""} · shift: {shiftName(r.defaultShiftId)}
                    </p>
                    <p className="text-xs text-muted-foreground">{cond || "Applies to everyone"}</p>
                  </div>
                  <AttendancePolicyDialog
                    shifts={shiftOptions}
                    options={options}
                    values={{
                      id: p.id,
                      name: p.name,
                      priority: p.priority,
                      conditions: {
                        employmentType: (p.conditions.employmentType as never) ?? [],
                        locationId: ([] as string[]).concat(p.conditions.locationId ?? []),
                        legalEntityId: ([] as string[]).concat(p.conditions.legalEntityId ?? []),
                        departmentId: ([] as string[]).concat(p.conditions.departmentId ?? []),
                      },
                      defaultShiftId: r.defaultShiftId ?? null,
                      allowWebCheckIn: r.allowWebCheckIn,
                      requireGeofence: r.requireGeofence,
                      lateMarksPerHalfDay: r.lateMarksPerHalfDay,
                      overtimeEnabled: r.overtimeEnabled,
                      overtimeMinMinutes: r.overtimeMinMinutes,
                      regularizationWindowDays: r.regularizationWindowDays,
                      maxRegularizationsPerMonth: r.maxRegularizationsPerMonth,
                      autoMarkAbsentWithoutPunch: r.autoMarkAbsentWithoutPunch,
                      isActive: p.isActive,
                    }}
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState className="m-4 border-0" title="No policies" description="Create a policy to control check-in rules." />
        )}
      </Section>
    </Reveal>
  );
}

async function Projects({ ctx }: { ctx: RequestContext }) {
  const projects = await listProjects(ctx);
  return (
    <Reveal>
      <Section title="Projects" description="Offered in weekly timesheets." actions={<ProjectDialog />}>
        {projects.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Project</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Billable</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-5 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="pl-5">
                      <span className="font-medium">{p.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{p.code}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.client ?? "—"}</TableCell>
                    <TableCell>{p.isBillable ? "Yes" : "No"}</TableCell>
                    <TableCell>
                      <StatusBadge status={p.isActive ? "active" : "inactive"} tone={p.isActive ? "success" : "neutral"} />
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      <ProjectDialog values={{ id: p.id, code: p.code, name: p.name, client: p.client, isBillable: p.isBillable, isActive: p.isActive }} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState className="m-4 border-0" icon={FolderKanban} title="No projects yet" description="Add projects so employees can log time against them." />
        )}
      </Section>
    </Reveal>
  );
}
