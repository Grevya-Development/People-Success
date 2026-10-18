import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { FileSignature, Plus } from "lucide-react";
import { EmptyState, ErrorState, Reveal, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RequestContext } from "@/server/auth/context";
import { listTemplates } from "@/server/services/documents/templates";
import { logger } from "@/server/lib/logger";
import { formatDate } from "@/lib/format";
import { TEMPLATE_KIND_LABELS } from "@/lib/validation/documents";
import { InstallStandardTemplatesButton, TemplateActiveSwitch } from "./template-buttons";

export async function TemplatesList({ ctx }: { ctx: RequestContext }) {
  let templates;
  try {
    templates = await listTemplates(ctx);
  } catch (err) {
    unstable_rethrow(err);
    logger.error("documents.templates_list_failed", { err });
    return <ErrorState title="Could not load templates" />;
  }

  const newButton = (
    <Button asChild size="sm">
      <Link href="/documents/templates/new">
        <Plus data-icon="inline-start" /> New template
      </Link>
    </Button>
  );

  return (
    <Reveal>
      <Section
        title="Document templates"
        description="Letters and emails with {{placeholders}} filled from employee and company data. Every body change is kept as a version."
        actions={
          <>
            <InstallStandardTemplatesButton />
            {newButton}
          </>
        }
      >
        {templates.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Template</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="text-right">Version</TableHead>
                <TableHead className="text-right">Placeholders</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="pr-5 text-right">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id} className={t.isActive ? undefined : "text-muted-foreground"}>
                  <TableCell className="max-w-[22rem] pl-5">
                    <Link href={`/documents/templates/${t.id}`} className="font-medium text-foreground hover:underline">
                      {t.name}
                    </Link>
                    {t.description ? <div className="truncate text-xs text-muted-foreground">{t.description}</div> : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{TEMPLATE_KIND_LABELS[t.kind]}</TableCell>
                  <TableCell className="tabular text-right">v{t.currentVersion}</TableCell>
                  <TableCell className="tabular text-right">{t.placeholders.length}</TableCell>
                  <TableCell className="tabular whitespace-nowrap">{formatDate(t.updatedAt)}</TableCell>
                  <TableCell className="pr-5 text-right">
                    <TemplateActiveSwitch id={t.id} isActive={t.isActive} name={t.name} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={FileSignature}
              title="No templates yet"
              description="Start from the standard offer, experience and relieving letters, or write your own."
              className="border-0"
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <InstallStandardTemplatesButton variant="default" />
                  <Button asChild size="sm" variant="outline">
                    <Link href="/documents/templates/new">
                      <Plus data-icon="inline-start" /> New template
                    </Link>
                  </Button>
                </div>
              }
            />
          </div>
        )}
      </Section>
    </Reveal>
  );
}
