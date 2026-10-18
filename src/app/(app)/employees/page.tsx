import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Download, Plus, Upload, Users } from "lucide-react";
import { Page, PageHeader, TableSkeleton, NoAccess, EmptyState, Reveal } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { can, requireContext } from "@/server/auth/context";
import { listEmployees } from "@/server/services/employees/queries";
import { employeeFormLookups } from "@/server/services/employees/lookups";
import { employeeListSchema } from "@/lib/validation/employees";
import { AppError } from "@/server/lib/errors";
import { EmployeesTable } from "./employees-table";
import { EmployeeFilters } from "./employee-filters";

export const metadata: Metadata = { title: "Employees" };

type SP = PageProps<"/employees">["searchParams"];

export default function EmployeesPage({ searchParams }: PageProps<"/employees">) {
  return (
    <Page>
      <PageHeader
        title="Employees"
        description="Everyone in your organization, from pre-joining to alumni."
        actions={
          <Suspense fallback={<Skeleton className="h-8 w-60" />}>
            <HeaderActions searchParams={searchParams} />
          </Suspense>
        }
      />
      <Suspense fallback={<Skeleton className="mb-4 h-8 w-full max-w-3xl" />}>
        <Filters />
      </Suspense>
      <Suspense fallback={<TableSkeleton columns={6} />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function HeaderActions({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const sp = new URLSearchParams(Object.entries(await searchParams).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  return (
    <>
      {can(ctx, "employees.import", "all") ? (
        <Button variant="outline" size="sm" asChild>
          <Link href="/employees/import">
            <Upload /> Import
          </Link>
        </Button>
      ) : null}
      {can(ctx, "employees.export", "all") ? (
        <Button variant="outline" size="sm" asChild>
          <a href={`/api/employees/export?${sp.toString()}`} download>
            <Download /> Export
          </a>
        </Button>
      ) : null}
      {can(ctx, "employees.create", "all") ? (
        <Button size="sm" asChild>
          <Link href="/employees/new">
            <Plus /> Add employee
          </Link>
        </Button>
      ) : null}
    </>
  );
}

async function Filters() {
  const ctx = await requireContext();
  const lookups = await employeeFormLookups(ctx);
  return (
    <EmployeeFilters
      departments={lookups.departments}
      locations={lookups.locations}
      canSeeExited={can(ctx, "employees.view", "all")}
    />
  );
}

async function Results({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const raw = await searchParams;
  const parsed = employeeListSchema.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string")));
  const query = parsed.success ? parsed.data : employeeListSchema.parse({});
  let result: Awaited<ReturnType<typeof listEmployees>>;
  try {
    result = await listEmployees(ctx, query);
  } catch (err) {
    if (err instanceof AppError && err.code === "FORBIDDEN") return <NoAccess />;
    throw err;
  }
  {
    const filtered = !!(query.q || query.departmentId || query.locationId || query.employmentType || query.joined || query.status !== "current");
    return (
      <Reveal>
        <EmployeesTable
          rows={result.rows}
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          sort={{ key: query.sort, dir: query.dir }}
          empty={
            filtered ? (
              <EmptyState className="m-4 border-0" title="No matching employees" description="Try a different search or clear the filters." />
            ) : (
              <EmptyState
                className="m-4 border-0"
                icon={Users}
                title="No employees yet"
                description="Add your first employee or import your team from a spreadsheet."
                action={
                  can(ctx, "employees.create", "all") ? (
                    <div className="flex gap-2">
                      <Button size="sm" asChild>
                        <Link href="/employees/new">Add employee</Link>
                      </Button>
                      {can(ctx, "employees.import", "all") ? (
                        <Button size="sm" variant="outline" asChild>
                          <Link href="/employees/import">Import CSV</Link>
                        </Button>
                      ) : null}
                    </div>
                  ) : undefined
                }
              />
            )
          }
        />
      </Reveal>
    );
  }
}
