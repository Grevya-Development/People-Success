import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { NoAccess, Page, PageHeader, Reveal } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { can, requireContext } from "@/server/auth/context";
import { listIntegrations } from "@/server/services/integrations";
import { IntegrationCard } from "./integration-card";

export const metadata: Metadata = { title: "Integrations" };

export default function IntegrationsPage() {
  return (
    <Page>
      <PageHeader
        title="Integrations"
        description="Connect email, messaging, calendars, e-signature, payouts and devices. An integration shows as verified only after a real test succeeds."
        actions={
          <Button size="sm" variant="outline" asChild>
            <Link href="/developers">API reference</Link>
          </Button>
        }
      />
      <Suspense
        fallback={
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        }
      >
        <Catalog />
      </Suspense>
    </Page>
  );
}

async function Catalog() {
  const ctx = await requireContext();
  if (!can(ctx, "integrations.manage", "all")) return <NoAccess />;
  const items = await listIntegrations(ctx);
  // Connected integrations first, then by category.
  const rank = (s?: string) => (s === "verified" ? 0 : s === "error" ? 1 : s === "configured" ? 2 : s === "disabled" ? 3 : 4);
  const sorted = [...items].sort((a, b) => rank(a.connection?.status) - rank(b.connection?.status) || a.category.localeCompare(b.category));
  return (
    <Reveal>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sorted.map((i) => (
          <IntegrationCard key={i.key} item={i} />
        ))}
      </div>
    </Reveal>
  );
}
