import type { Metadata } from "next";
import { Suspense } from "react";
import { NoAccess, Page, PageHeader } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { can, requireContext } from "@/server/auth/context";
import { IMPORT_COLUMNS, MAX_IMPORT_ROWS } from "@/server/services/employees/import";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import employees" };

export default function ImportPage() {
  return (
    <Page width="narrow">
      <PageHeader
        title="Import employees"
        description={`Upload a CSV of up to ${MAX_IMPORT_ROWS.toLocaleString("en-IN")} people. Every row is validated before anything is saved, and the import is all-or-nothing.`}
      />
      <Suspense fallback={<Skeleton className="h-72 rounded-xl" />}>
        <Gate />
      </Suspense>
    </Page>
  );
}

async function Gate() {
  const ctx = await requireContext();
  if (!can(ctx, "employees.import", "all")) return <NoAccess />;
  return (
    <ImportWizard
      columns={IMPORT_COLUMNS.map((c) => ({ key: c.key, required: c.required }))}
      canCreateMissing={can(ctx, "org.manage", "all")}
    />
  );
}
