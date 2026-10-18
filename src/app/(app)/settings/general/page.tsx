import type { Metadata } from "next";
import { Suspense } from "react";
import { NoAccess, PageHeader, Reveal } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { can, requireContext } from "@/server/auth/context";
import { getGeneralSettings } from "@/server/services/settings/general";
import { GeneralSettingsForm } from "./general-form";

export const metadata: Metadata = { title: "General settings" };

export default function GeneralSettingsPage() {
  return (
    <>
      <PageHeader title="General" description="Company-wide defaults used across leave, attendance, payroll and documents." />
      <Suspense fallback={<FormSkeleton />}>
        <GeneralData />
      </Suspense>
    </>
  );
}

async function GeneralData() {
  const ctx = await requireContext();
  if (!can(ctx, "settings.manage", "all")) return <NoAccess />;
  const s = await getGeneralSettings(ctx);
  return (
    <Reveal>
      <GeneralSettingsForm
        currency={s.settings.currency}
        defaults={{
          name: s.name,
          timezone: s.settings.timezone,
          dateFormat: s.settings.dateFormat as never,
          fiscalYearStartMonth: s.settings.fiscalYearStartMonth,
          employeeIdPrefix: s.settings.employeeIdFormat?.prefix ?? "EMP",
          employeeIdPadding: s.settings.employeeIdFormat?.padding ?? 4,
          weekStartsOn: s.settings.weekStartsOn,
        }}
      />
    </Reveal>
  );
}

function FormSkeleton() {
  return (
    <div className="space-y-4 rounded-xl border bg-card p-6" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}
