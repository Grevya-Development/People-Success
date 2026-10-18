import type { Metadata } from "next";
import { Suspense } from "react";
import { UserRound } from "lucide-react";
import { EmptyState, NoAccess, Page, PageHeader } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { can, requireContext } from "@/server/auth/context";
import { NewClaimForm } from "./new-claim-form";

export const metadata: Metadata = { title: "New expense claim" };

export default function NewClaimPage() {
  return (
    <Page width="narrow">
      <PageHeader title="New expense claim" description="Give the claim a name, then add each expense with its receipt on the next screen." />
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <Gate />
      </Suspense>
    </Page>
  );
}

async function Gate() {
  const ctx = await requireContext();
  if (!can(ctx, "expenses.view")) return <NoAccess />;
  if (!ctx.employeeId) {
    return <EmptyState icon={UserRound} title="Your login is not linked to an employee record" description="Expense claims are raised against your employee profile. Ask HR to link your account." />;
  }
  return <NewClaimForm />;
}
