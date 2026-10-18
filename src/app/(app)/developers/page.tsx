import type { Metadata } from "next";
import { Suspense } from "react";
import { NoAccess, Page, PageHeader, Section } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { can, requireContext } from "@/server/auth/context";
import { openApiDocument } from "@/server/api/openapi";
import { env } from "@/server/env";

export const metadata: Metadata = { title: "API reference" };

const METHOD_TONE: Record<string, string> = { get: "bg-info-soft text-info", post: "bg-success-soft text-success", patch: "bg-warning-soft text-warning", delete: "bg-danger-soft text-danger" };

export default function DevelopersPage() {
  return (
    <Page width="narrow">
      <PageHeader
        title="API reference"
        description="Integrate PeopleSuccess with your systems. The API applies the same permissions and data scope as the app."
        actions={
          <Button size="sm" variant="outline" asChild>
            <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
              OpenAPI JSON
            </a>
          </Button>
        }
      />
      <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
        <Body />
      </Suspense>
    </Page>
  );
}

async function Body() {
  const ctx = await requireContext();
  if (!can(ctx, "integrations.manage", "all")) return <NoAccess />;
  const base = env().NEXT_PUBLIC_APP_URL;
  const doc = openApiDocument(base);
  return (
    <div className="space-y-5">
      <Section title="Authentication">
        <div className="space-y-3 p-5 text-sm">
          <p>
            Send a Supabase access token for a PeopleSuccess user as <code className="rounded bg-muted px-1 font-mono text-xs">Authorization: Bearer &lt;token&gt;</code> and choose
            the organization with <code className="rounded bg-muted px-1 font-mono text-xs">X-Tenant-Id</code>. Use a dedicated integration user with only the roles it needs.
          </p>
          <pre className="overflow-x-auto rounded-lg bg-muted/70 p-3 font-mono text-xs">{`curl ${base}/api/v1/employees?status=active \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "X-Tenant-Id: ${ctx.tenantId}"`}</pre>
          <p className="text-muted-foreground">
            Responses are <code className="font-mono text-xs">{"{ data }"}</code> or <code className="font-mono text-xs">{"{ error: { code, message, fieldErrors? }, requestId }"}</code>. Limit: 600 requests per 5 minutes per user. Money is in integer paise.
          </p>
        </div>
      </Section>
      <Section title="Endpoints">
        <ul className="divide-y">
          {Object.entries(doc.paths).flatMap(([path, ops]) =>
            Object.entries(ops as Record<string, { summary: string; description?: string }>).map(([method, op]) => (
              <li key={`${method}-${path}`} className="flex flex-wrap items-baseline gap-3 px-5 py-3 text-sm">
                <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase ${METHOD_TONE[method] ?? "bg-muted"}`}>{method}</span>
                <code className="font-mono text-xs">/api/v1{path}</code>
                <span className="text-muted-foreground">{op.summary}</span>
              </li>
            )),
          )}
        </ul>
      </Section>
    </div>
  );
}
