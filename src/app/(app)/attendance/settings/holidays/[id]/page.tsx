import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, Trash2 } from "lucide-react";
import { EmptyState, NoAccess, Page, PageHeader, Reveal, Section, TableSkeleton } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { canManageHolidays, getHolidayCalendar } from "@/server/services/time/holidays";
import { formatDate } from "@/lib/format";
import { ConfirmAction } from "@/app/(app)/settings/_components/run-action";
import { deleteHolidayAction } from "../../../actions";
import { HolidayDialog } from "../../_components/holiday-dialogs";

export const metadata: Metadata = { title: "Holiday calendar" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function HolidayCalendarPage({ params }: PageProps<"/attendance/settings/holidays/[id]">) {
  return (
    <Page width="narrow">
      <Suspense
        fallback={
          <>
            <Skeleton className="mb-6 h-12 w-72" />
            <TableSkeleton rows={8} columns={3} />
          </>
        }
      >
        <Content params={params} />
      </Suspense>
    </Page>
  );
}

async function Content({ params }: { params: PageProps<"/attendance/settings/holidays/[id]">["params"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireContext();
  if (!canManageHolidays(ctx)) return <NoAccess />;
  let data: Awaited<ReturnType<typeof getHolidayCalendar>>;
  try {
    data = await getHolidayCalendar(ctx, id);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const { calendar, holidays } = data;
  const publicCount = holidays.filter((h) => h.type === "public").length;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/attendance/settings?tab=holidays" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3" /> Holiday calendars
          </Link>
        }
        title={`${calendar.name} · ${calendar.year}`}
        description={`${publicCount} public and ${holidays.length - publicCount} restricted holiday(s)${calendar.isDefault ? " · default calendar for the year" : ""}.`}
        actions={<HolidayDialog calendarId={calendar.id} year={calendar.year} />}
      />
      <Reveal>
        <Section>
          {holidays.length ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Date</TableHead>
                  <TableHead>Holiday</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="pr-5 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holidays.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="pl-5 tabular">{formatDate(h.date, "EEE, dd MMM")}</TableCell>
                    <TableCell className="font-medium">{h.name}</TableCell>
                    <TableCell>
                      <StatusBadge status={h.type} tone={h.type === "public" ? "brand" : "neutral"} />
                    </TableCell>
                    <TableCell className="pr-5">
                      <div className="flex justify-end gap-1">
                        <HolidayDialog calendarId={calendar.id} year={calendar.year} values={{ id: h.id, calendarId: calendar.id, date: h.date, name: h.name, type: h.type === "restricted" ? "restricted" : "public" }} />
                        <ConfirmAction
                          trigger={
                            <Button variant="ghost" size="icon-sm" aria-label={`Delete ${h.name}`}>
                              <Trash2 />
                            </Button>
                          }
                          title={`Delete ${h.name}?`}
                          description="If this date was already processed, recompute attendance for it afterwards."
                          confirmLabel="Delete"
                          destructive
                          action={deleteHolidayAction}
                          input={{ id: h.id }}
                          success="Holiday deleted"
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState className="m-4 border-0" icon={CalendarDays} title="No holidays yet" description="Add the public holidays your offices observe this year." />
          )}
        </Section>
      </Reveal>
    </>
  );
}
