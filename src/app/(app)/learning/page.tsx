import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BookOpen, Download, GraduationCap, ListChecks, Users } from "lucide-react";
import { EmptyState, ErrorState, NoAccess, Page, PageHeader, Reveal, Section, TableSkeleton } from "@/components/page";
import { LinkTabs } from "@/components/documents/link-tabs";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, getTeamEmployeeIds, requireContext, type RequestContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { listCatalog, listPaths } from "@/server/services/talent/learning/courses";
import { listMyLearning, teamLearning, type MyLearningItem } from "@/server/services/talent/learning/enrollments";
import { listAssignments } from "@/server/services/talent/learning/assignments";
import { employeeFormLookups } from "@/server/services/employees/lookups";
import { formatDate } from "@/lib/format";
import { COURSE_FORMAT_LABELS } from "@/lib/validation/talent";
import { RunButton } from "@/app/(app)/performance/_components/run-button";
import { AssignmentDialog, CourseDialog, PathDialog } from "./_components/learning-dialogs";
import { setAssignmentActiveAction } from "./actions";

export const metadata: Metadata = { title: "Learning" };

type Tab = "mine" | "catalog" | "team" | "assignments";

export default function LearningPage({ searchParams }: PageProps<"/learning">) {
  return (
    <Page>
      <PageHeader title="Learning" description="Assigned and optional courses, quizzes and certificates." />
      <Suspense fallback={<TableSkeleton rows={6} columns={5} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function guard<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; node: React.ReactNode }> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof AppError && err.code === "FORBIDDEN") return { ok: false, node: <NoAccess /> };
    logger.error("learning.tab_failed", { err });
    return { ok: false, node: <ErrorState /> };
  }
}

async function Body({ searchParams }: { searchParams: PageProps<"/learning">["searchParams"] }) {
  const ctx = await requireContext();
  const manage = can(ctx, "learning.manage", "all");
  if (!ctx.grants["learning.view"] && !manage) return <NoAccess />;
  const sp = await searchParams;
  const hasTeam = (await getTeamEmployeeIds(ctx)).length > 0;
  const tabs: { key: Tab; label: string }[] = [
    { key: "mine", label: "My learning" },
    { key: "catalog", label: "Catalog" },
    ...(hasTeam || manage ? [{ key: "team" as const, label: manage && !hasTeam ? "Completion" : "Team" }] : []),
    ...(manage ? [{ key: "assignments" as const, label: "Assignments" }] : []),
  ];
  const requested = (typeof sp.tab === "string" ? sp.tab : "mine") as Tab;
  const tab = tabs.some((t) => t.key === requested) ? requested : "mine";
  return (
    <>
      <LinkTabs label="Learning sections" active={tab} tabs={tabs.map((t) => ({ ...t, href: `/learning?tab=${t.key}` }))} />
      <Reveal key={tab}>
        {tab === "mine" ? <MineTab ctx={ctx} /> : null}
        {tab === "catalog" ? <CatalogTab ctx={ctx} /> : null}
        {tab === "team" ? <TeamTab ctx={ctx} scope={hasTeam ? "team" : "all"} /> : null}
        {tab === "assignments" ? <AssignmentsTab ctx={ctx} /> : null}
      </Reveal>
    </>
  );
}

const BUCKET_LABEL: Record<string, string> = { overdue: "Overdue", assigned: "Assigned", in_progress: "In progress", completed: "Completed", expired: "Expired", waived: "Waived" };

function LearningList({ items }: { items: MyLearningItem[] }) {
  return (
    <ul className="divide-y">
      {items.map((i) => (
        <li key={i.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <Link href={`/learning/courses/${i.courseId}`} className="font-medium hover:underline">
              {i.title}
            </Link>
            <p className="text-xs text-muted-foreground">
              {COURSE_FORMAT_LABELS[i.format as keyof typeof COURSE_FORMAT_LABELS] ?? i.format}
              {i.durationMinutes ? ` · ${i.durationMinutes} min` : ""}
              {i.isMandatory ? " · Mandatory" : ""}
              {i.dueOn && i.bucket !== "completed" ? ` · due ${formatDate(i.dueOn)}` : ""}
              {i.completedAt ? ` · completed ${formatDate(i.completedAt)}` : ""}
              {i.expiresOn ? ` · valid until ${formatDate(i.expiresOn)}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {i.bucket === "assigned" || i.bucket === "in_progress" || i.bucket === "overdue" ? (
              <div className="flex items-center gap-2">
                <Progress value={i.progressPercent} className="h-1.5 w-24" aria-label={`${i.progressPercent}%`} />
                <span className="text-xs tabular text-muted-foreground">{i.progressPercent}%</span>
              </div>
            ) : null}
            <StatusBadge status={i.bucket} label={BUCKET_LABEL[i.bucket]} tone={i.bucket === "overdue" ? "danger" : undefined} />
            {i.certificateDocumentId && i.bucket === "completed" ? (
              <Button size="sm" variant="ghost" asChild>
                <a href={`/api/documents/${i.certificateDocumentId}/download`} aria-label={`Download certificate for ${i.title}`}>
                  <Download /> Certificate
                </a>
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

async function MineTab({ ctx }: { ctx: RequestContext }) {
  if (!ctx.employeeId) return <EmptyState icon={GraduationCap} title="No employee record" description="Your account is not linked to an employee, so nothing is assigned to you." />;
  const res = await guard(() => listMyLearning(ctx));
  if (!res.ok) return res.node;
  const items = res.data;
  if (!items.length)
    return (
      <EmptyState
        icon={GraduationCap}
        title="Nothing assigned yet"
        description="Courses assigned to you appear here. You can also enroll from the catalog."
        action={
          <Button size="sm" asChild>
            <Link href="/learning?tab=catalog">Browse catalog</Link>
          </Button>
        }
      />
    );
  const groups: [string, MyLearningItem[]][] = [
    ["Overdue", items.filter((i) => i.bucket === "overdue")],
    ["To do", items.filter((i) => i.bucket === "assigned" || i.bucket === "in_progress")],
    ["Completed", items.filter((i) => i.bucket === "completed")],
    ["Expired", items.filter((i) => i.bucket === "expired")],
  ];
  return (
    <div className="space-y-6">
      {groups
        .filter(([, list]) => list.length)
        .map(([title, list]) => (
          <Section key={title} title={`${title} (${list.length})`}>
            <LearningList items={list} />
          </Section>
        ))}
    </div>
  );
}

async function CatalogTab({ ctx }: { ctx: RequestContext }) {
  const manage = can(ctx, "learning.manage", "all");
  const res = await guard(async () => {
    const [courses, paths] = await Promise.all([listCatalog(ctx), listPaths(ctx)]);
    return { courses, paths };
  });
  if (!res.ok) return res.node;
  const { courses, paths } = res.data;
  const courseOptions = courses.filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.title }));
  return (
    <div className="space-y-6">
      <Section title="Courses" actions={manage ? <CourseDialog /> : null}>
        {courses.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-56">Course</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead>Skills</TableHead>
                  {manage ? <TableHead className="text-right">Completed</TableHead> : null}
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {courses.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/learning/courses/${c.id}`} className="font-medium hover:underline">
                        {c.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {[c.isMandatory ? "Mandatory" : null, c.durationMinutes ? `${c.durationMinutes} min` : null, c.hasQuiz ? `Quiz (${c.questionCount})` : null, c.certificateValidityMonths ? `Certificate valid ${c.certificateValidityMonths} months` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{COURSE_FORMAT_LABELS[c.format as keyof typeof COURSE_FORMAT_LABELS] ?? c.format}</TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground">{c.skills.join(", ") || "—"}</TableCell>
                    {manage ? (
                      <TableCell className="text-right tabular">
                        {c.completed}/{c.enrolled}
                      </TableCell>
                    ) : null}
                    <TableCell>
                      {!c.isActive ? <StatusBadge status="inactive" /> : c.myStatus ? <StatusBadge status={c.myStatus} /> : <span className="text-xs text-muted-foreground">Not enrolled</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState icon={BookOpen} title="No courses yet" description={manage ? "Create a course with a link, document or classroom session." : "Your organization has not published courses yet."} className="m-4" />
        )}
      </Section>
      <Section title="Learning paths" description="Ordered sets of courses." actions={manage && courseOptions.length ? <PathDialog courses={courseOptions} /> : null}>
        {paths.length ? (
          <ul className="divide-y">
            {paths.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {p.title} {!p.isActive ? <StatusBadge status="inactive" className="ml-1" /> : null}
                  </p>
                  {p.description ? <p className="text-xs text-muted-foreground">{p.description}</p> : null}
                  <ol className="mt-1 flex flex-wrap gap-1.5 text-xs">
                    {p.courses.map((c, i) => (
                      <li key={c.id}>
                        <Link href={`/learning/courses/${c.id}`} className="rounded bg-muted px-1.5 py-0.5 hover:underline">
                          {i + 1}. {c.title}
                        </Link>
                      </li>
                    ))}
                  </ol>
                </div>
                {manage ? <PathDialog courses={courseOptions} values={{ id: p.id, title: p.title, description: p.description, courseIds: p.courseIds, isActive: p.isActive }} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-4 text-sm text-muted-foreground">No learning paths yet.</p>
        )}
      </Section>
    </div>
  );
}

async function TeamTab({ ctx, scope }: { ctx: RequestContext; scope: "team" | "all" }) {
  const res = await guard(() => teamLearning(ctx, scope));
  if (!res.ok) return res.node;
  const { employees, overdue, totals } = res.data;
  if (!totals.assigned) return <EmptyState icon={Users} title="No assigned learning yet" description="Completion appears here once courses are assigned." />;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
        {[
          ["Completion", totals.completionPercent != null ? `${totals.completionPercent}%` : "—"],
          ["Enrollments", String(totals.assigned)],
          ["Completed", String(totals.completed)],
          ["Overdue", String(totals.overdue)],
        ].map(([label, value]) => (
          <div key={label} className="space-y-1 bg-card p-5">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-xl font-semibold tabular ${label === "Overdue" && totals.overdue ? "text-danger" : ""}`}>{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={scope === "team" ? "My team" : "Employees"}>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Employee</TableHead>
                  <TableHead className="min-w-32">Completion</TableHead>
                  <TableHead className="text-right">Overdue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{e.name}</TableCell>
                    <TableCell>
                      {e.completionPercent != null ? (
                        <div className="flex items-center gap-2">
                          <Progress value={e.completionPercent} className="h-1.5 w-20" aria-label={`${e.completionPercent}%`} />
                          <span className="text-xs tabular text-muted-foreground">
                            {e.completed}/{e.assigned}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Nothing assigned</span>
                      )}
                    </TableCell>
                    <TableCell className={`text-right tabular ${e.overdue ? "text-danger" : ""}`}>{e.overdue || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
        <Section title="Overdue">
          {overdue.length ? (
            <ul className="divide-y">
              {overdue.map((o) => (
                <li key={o.enrollmentId} className="flex justify-between gap-3 px-5 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">{o.employeeName}</span> <span className="text-muted-foreground">· {o.course}</span>
                  </span>
                  <span className="whitespace-nowrap text-xs text-danger">due {formatDate(o.dueOn)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-sm text-muted-foreground">Nothing overdue.</p>
          )}
        </Section>
      </div>
    </div>
  );
}

async function AssignmentsTab({ ctx }: { ctx: RequestContext }) {
  const res = await guard(async () => {
    const [assignments, courses, paths, lookups] = await Promise.all([listAssignments(ctx), listCatalog(ctx), listPaths(ctx), employeeFormLookups(ctx)]);
    return { assignments, courses, paths, lookups };
  });
  if (!res.ok) return res.node;
  const { assignments, courses, paths, lookups } = res.data;
  const depName = new Map(lookups.departments.map((d) => [d.value, d.label]));
  const desName = new Map(lookups.designations.map((d) => [d.value, d.label]));
  const describe = (t: { all?: boolean; newJoiners?: boolean; departmentIds?: string[]; designationIds?: string[] }) =>
    [
      t.all ? "Everyone" : null,
      t.newJoiners ? "New joiners" : null,
      t.departmentIds?.length ? t.departmentIds.map((d) => depName.get(d) ?? "Removed department").join(", ") : null,
      t.designationIds?.length ? t.designationIds.map((d) => desName.get(d) ?? "Removed designation").join(", ") : null,
    ]
      .filter(Boolean)
      .join(" · ");
  const activeCourses = courses.filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.title }));
  const activePaths = paths.filter((p) => p.isActive).map((p) => ({ value: p.id, label: p.title }));
  return (
    <Section
      title="Assignment rules"
      description="Rules run daily and when employees are added. Expired certificates are re-assigned automatically."
      actions={activeCourses.length || activePaths.length ? <AssignmentDialog courses={activeCourses} paths={activePaths} departments={lookups.departments} designations={lookups.designations} /> : null}
    >
      {assignments.length ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Learning</TableHead>
                <TableHead>Who</TableHead>
                <TableHead className="text-right">Due in</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="w-44">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.courseTitle ?? (a.pathTitle ? `Path: ${a.pathTitle}` : "Removed")}</TableCell>
                  <TableCell className="text-muted-foreground">{describe(a.target)}</TableCell>
                  <TableCell className="text-right tabular">{a.dueInDays} days</TableCell>
                  <TableCell className="text-right tabular">
                    {a.completed}/{a.enrolled}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={a.isActive ? "active" : "paused"} />
                      <RunButton action={setAssignmentActiveAction} input={{ id: a.id, isActive: !a.isActive }} success={a.isActive ? "Assignment paused" : "Assignment resumed"} variant="ghost">
                        {a.isActive ? "Pause" : "Resume"}
                      </RunButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          icon={ListChecks}
          title="No assignment rules"
          description={activeCourses.length ? "Assign mandatory courses to everyone, departments, designations or new joiners." : "Create a course in the catalog first."}
          className="m-4"
        />
      )}
    </Section>
  );
}
