import type { Metadata } from "next";
import { Suspense } from "react";
import { Page, PageHeader } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { requireContext } from "@/server/auth/context";
import { listTicketCategories } from "@/server/services/helpdesk/categories";
import { NewTicketForm } from "./new-ticket-form";

export const metadata: Metadata = { title: "Raise a ticket" };

export default function NewTicketPage() {
  return (
    <Page width="narrow">
      <PageHeader
        title="Raise a ticket"
        description="Tell HR what you need. You'll get replies here and in your notifications. Concerns about harassment, health or conduct are routed confidentially."
      />
      <Suspense fallback={<Skeleton className="h-[460px] w-full rounded-xl" />}>
        <Loader />
      </Suspense>
    </Page>
  );
}

async function Loader() {
  const ctx = await requireContext();
  const categories = await listTicketCategories(ctx);
  return <NewTicketForm categories={categories.map((c) => ({ id: c.id, name: c.name, description: c.description, isSensitive: c.isSensitive, firstResponseHours: c.firstResponseHours }))} />;
}
