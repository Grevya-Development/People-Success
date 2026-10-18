import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, Palmtree, UserRound } from "lucide-react";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { can, requireContext } from "@/server/auth/context";
import { listLeaveTypes } from "@/server/services/time/leave-types";
import { employeeFormLookups } from "@/server/services/employees/lookups";
import { todayIn } from "@/lib/format";
import { ApplyLeaveForm } from "./apply-form";

export const metadata: Metadata = { title: "Apply leave" };

export default function NewLeavePage() {
  return (
    <Page width="narrow">
      <PageHeader
        eyebrow={
          <Link href="/leave" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3" /> Leave
          </Link>
        }
        title="Apply leave"
        description="Days are counted against your shift's weekly offs and holidays. Your manager is notified to approve."
      />
      <Suspense fallback={<Skeleton className="h-[480px] w-full rounded-xl" />}>
        <FormData />
      </Suspense>
    </Page>
  );
}

async function FormData() {
  const ctx = await requireContext();
  const isHr = can(ctx, "leave.manage", "all");
  if (!ctx.employeeId && !isHr) {
    return <EmptyState icon={UserRound} title="Your login is not linked to an employee record" description="You can apply for leave once HR links your account to your employee profile." />;
  }
  const [types, lookups] = await Promise.all([listLeaveTypes(ctx), isHr ? employeeFormLookups(ctx) : Promise.resolve(null)]);
  if (!types.length) {
    return <EmptyState icon={Palmtree} title="Leave is not set up yet" description={isHr ? "Add leave types in leave settings first." : "HR has not configured leave types yet."} />;
  }
  return (
    <ApplyLeaveForm
      types={types.map((t) => ({ value: t.id, label: t.name, allowHalfDay: t.allowHalfDay, isPaid: t.isPaid }))}
      employees={lookups?.managers ?? null}
      selfEmployeeId={ctx.employeeId}
      today={todayIn()}
    />
  );
}
