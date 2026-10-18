import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, unstable_rethrow } from "next/navigation";
import { ArrowLeft, FlaskConical } from "lucide-react";
import { ErrorState, NoAccess, Page, PageHeader, Reveal, Section, TableSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { canManageTemplates, getTemplate, renderTemplate, sampleTemplateData } from "@/server/services/documents/templates";
import { TemplateForm } from "@/components/documents/template-form";
import { TemplateActiveSwitch } from "@/components/documents/template-buttons";
import { Markdown } from "@/components/documents/markdown";
import { formatDateTime } from "@/lib/format";
import { TEMPLATE_KIND_LABELS } from "@/lib/validation/documents";

export const metadata: Metadata = { title: "Template" };

export default function TemplatePage({ params }: PageProps<"/documents/templates/[id]">) {
  return (
    <Page>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/documents?tab=templates">
          <ArrowLeft data-icon="inline-start" /> Templates
        </Link>
      </Button>
      <Suspense
        fallback={
          <>
            <PageHeader title={<Skeleton className="h-7 w-64" />} />
            <TableSkeleton rows={8} columns={2} />
          </>
        }
      >
        <TemplateContent params={params} />
      </Suspense>
    </Page>
  );
}

async function TemplateContent({ params }: { params: PageProps<"/documents/templates/[id]">["params"] }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!canManageTemplates(ctx)) return <NoAccess message="Only template managers can view templates." />;
  let data;
  try {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    const [template, sample] = await Promise.all([getTemplate(ctx, id), sampleTemplateData(ctx)]);
    // React escapes text itself, so the preview renders unescaped values through the safe Markdown renderer.
    const preview = await renderTemplate(ctx, id, sample, { escape: false });
    data = { template, preview };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    logger.error("documents.template_load_failed", { err });
    return <ErrorState title="Could not load this template" />;
  }
  const { template, preview } = data;

  return (
    <Reveal>
      <PageHeader
        eyebrow={`${TEMPLATE_KIND_LABELS[template.kind]} · Version ${template.currentVersion}`}
        title={template.name}
        description={template.description ?? undefined}
        actions={
          <div className="flex items-center gap-2 text-sm">
            {template.isActive ? <StatusBadge status="active" /> : <StatusBadge status="inactive" label="Inactive" />}
            <TemplateActiveSwitch id={template.id} isActive={template.isActive} name={template.name} />
          </div>
        }
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <TemplateForm
          template={{
            id: template.id,
            currentVersion: template.currentVersion,
            kind: template.kind,
            name: template.name,
            description: template.description,
            subject: template.subject,
            body: template.body,
          }}
        />
        <div className="space-y-5">
          <Section
            title="Preview"
            description="Rendered with sample data, not a real employee."
            actions={
              <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-[11.5px] font-medium text-info">
                <FlaskConical className="size-3" aria-hidden /> Sample data
              </span>
            }
          >
            <div className="px-5 py-5">
              {preview.subject ? <p className="mb-4 text-sm font-semibold">{preview.subject}</p> : null}
              <Markdown source={preview.output} />
            </div>
            {preview.missing.length ? (
              <p className="border-t px-5 py-2.5 text-xs text-warning">
                Not filled by sample data: {preview.missing.map((m) => `{{${m}}}`).join(", ")}. These must be supplied when the letter is generated.
              </p>
            ) : null}
          </Section>
          <Section title="Version history">
            <ul className="divide-y">
              {template.versions.map((v) => (
                <li key={v.version} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <span className="font-medium">
                    v{v.version}
                    {v.version === template.currentVersion ? <span className="ml-2 text-xs font-normal text-muted-foreground">current</span> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(v.createdAt)}
                    {v.createdByName ? ` · ${v.createdByName}` : ""} · {v.placeholders.length} placeholders
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </Reveal>
  );
}
