import type { Metadata } from "next";
import { Suspense } from "react";
import { NoAccess, Page, PageHeader } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { can, requireContext } from "@/server/auth/context";
import { employeeFormLookups } from "@/server/services/employees/lookups";
import { NewEmployeeForm } from "./new-employee-form";
import { todayIn } from "@/lib/format";

export const metadata: Metadata = { title: "Add employee" };

export default function NewEmployeePage() {
  return (
    <Page width="narrow">
      <PageHeader title="Add employee" description="Creates the employee record and their first employment period. You can invite them to sign in from Settings → Users." />
      <Suspense fallback={<Skeleton className="h-[640px] w-full rounded-xl" />}>
        <FormLoader />
      </Suspense>
    </Page>
  );
}

async function FormLoader() {
  const ctx = await requireContext();
  if (!can(ctx, "employees.create", "all")) return <NoAccess />;
  const lookups = await employeeFormLookups(ctx);
  return <NewEmployeeForm lookups={lookups} canSetCompensation={can(ctx, "compensation.edit", "all")} today={todayIn()} />;
}
