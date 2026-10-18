import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, Inbox } from "lucide-react";
import { NoAccess, Page, PageHeader, Reveal, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { getTimesheet } from "@/server/services/time/timesheets";
import { listProjects } from "@/server/services/time/timesheets";
import { addDaysIso } from "@/lib/leave-math";
import { formatDate } from "@/lib/format";
import { TimesheetEditor } from "../../_components/timesheet-editor";
import { minutesLabel } from "../../_components/status";

export const metadata: Metadata = { title: "Timesheet" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function TimesheetPage({ params }: PageProps<"/attendance/timesheets/[id]">) {
  return (
    <Page>
      <Suspense
        fallback={
          <>
            <Skeleton className="mb-6 h-12 w-80" />
            <TableSkeleton rows={4} columns={9} />
          </>
        }
      >
        <Content params={params} />
      </Suspense>
    </Page>
  );
}

async function Content({ params }: { params: PageProps<"/attendance/timesheets/[id]">["params"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireContext();
  let data: Awaited<ReturnType<typeof getTimesheet>>;
  try {
    data = await getTimesheet(ctx, id);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    if (err instanceof AppError && err.code === "FORBIDDEN") return <NoAccess message="You do not have access to this timesheet." />;
    throw err;
  }
  const projects = await listProjects(ctx);
  const own = data.sheet.employeeId === ctx.employeeId;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/attendance?tab=timesheets" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3" /> Timesheets
          </Link>
        }
        title={`${data.employeeName} · week of ${formatDate(data.sheet.weekStart, "dd MMM yyyy")}`}
        description={`${formatDate(data.sheet.weekStart, "dd MMM")} – ${formatDate(addDaysIso(data.sheet.weekStart, 6), "dd MMM")} · ${minutesLabel(data.sheet.totalMinutes)} logged`}
        actions={
          data.sheet.status === "submitted" && !own ? (
            <Button size="sm" variant="outline" asChild>
              <Link href="/inbox?tab=approvals">
                <Inbox /> Review in inbox
              </Link>
            </Button>
          ) : null
        }
      />
      <Reveal>
        <TimesheetEditor
          sheet={{ id: data.sheet.id, status: data.sheet.status, weekStart: data.sheet.weekStart }}
          entries={data.entries.map((e) => ({ date: e.date, projectId: e.projectId, task: e.task, minutes: e.minutes }))}
          projects={projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
          readOnly={!own}
        />
      </Reveal>
    </>
  );
}
