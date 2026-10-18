import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, ListPlus } from "lucide-react";
import { EmptyState, NoAccess, Page, PageHeader, Reveal, Section, TableSkeleton } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, requireContext } from "@/server/auth/context";
import { AppError } from "@/server/lib/errors";
import { acknowledgementPolicyOptions, getTemplate } from "@/server/services/lifecycle/templates";
import { employeeFormLookups } from "@/server/services/employees/lookups";
import { DOCUMENT_CATEGORY_LABELS, type DocumentCategory } from "@/lib/validation/documents";
import { TASK_CODE_LABELS, TASK_KIND_LABELS, type TaskCode, type TaskKind } from "@/lib/validation/lifecycle";
import { ownerLabel } from "../../_components/ui";
import { DeleteTemplateButton, DeleteTemplateTaskButton, TemplateDialog, TemplateTaskDialog } from "../../_components/template-controls";

export const metadata: Metadata = { title: "Checklist template" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function offsetLabel(days: number, kind: "onboarding" | "offboarding") {
  const anchor = kind === "onboarding" ? "joining" : "last day";
  if (days === 0) return `On ${anchor}`;
  const n = Math.abs(days);
  return `${n} ${n === 1 ? "day" : "days"} ${days < 0 ? "before" : "after"} ${anchor}`;
}

export default function TemplatePage({ params }: PageProps<"/onboarding/templates/[id]">) {
  return (
    <Page>
      <Suspense fallback={<TableSkeleton rows={10} columns={5} />}>
        <TemplateBody params={params} />
      </Suspense>
    </Page>
  );
}

async function TemplateBody({ params }: { params: PageProps<"/onboarding/templates/[id]">["params"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireContext();
  if (!can(ctx, "onboarding.manage", "all")) return <NoAccess />;
  let t;
  try {
    t = await getTemplate(ctx, id);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const [lookups, policies] = await Promise.all([employeeFormLookups(ctx), acknowledgementPolicyOptions(ctx)]);
  const cond = { departments: lookups.departments, locations: lookups.locations, legalEntities: lookups.legalEntities };
  const policyName = new Map(policies.map((p) => [p.value, p.label]));
  const nextSort = (t.tasks.at(-1)?.sortOrder ?? 0) + 10;

  return (
    <Reveal>
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
          <Link href="/onboarding?tab=templates">
            <ArrowLeft /> Templates
          </Link>
        </Button>
      </div>
      <PageHeader
        eyebrow={t.kind === "onboarding" ? "Onboarding template" : "Offboarding template"}
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {t.name}
            {!t.isActive ? <StatusBadge status="inactive" tone="neutral" /> : null}
          </span>
        }
        description={`${t.description ?? ""} ${t.conditionLabels.length ? `Applies to ${t.conditionLabels.map((c) => `${c.label.toLowerCase()} ${c.value}`).join(", ")}.` : "Applies to everyone."} Priority ${t.priority}.`.trim()}
        actions={
          <>
            <TemplateDialog
              lookups={cond}
              value={{
                id: t.id,
                kind: t.kind,
                name: t.name,
                description: t.description,
                priority: t.priority,
                isActive: t.isActive,
                departmentId: t.departmentId,
                locationId: t.locationId,
                legalEntityId: t.legalEntityId,
                employmentType: t.employmentType,
              }}
            />
            <DeleteTemplateButton id={t.id} used={t.planCount > 0} />
          </>
        }
      />
      <Section
        title="Tasks"
        description={`${t.tasks.length} tasks · used by ${t.planCount} ${t.planCount === 1 ? "plan" : "plans"}. Changes apply to new plans only.`}
        actions={<TemplateTaskDialog templateId={t.id} kind={t.kind} policies={policies} nextSortOrder={nextSort} />}
      >
        {t.tasks.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-12 text-right">#</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {t.tasks.map((task, i) => {
                  const c = task.config;
                  const detail =
                    task.kind === "document_upload" && c.documentCategory
                      ? DOCUMENT_CATEGORY_LABELS[c.documentCategory as DocumentCategory]
                      : task.kind === "acknowledgement"
                        ? c.policyId
                          ? (policyName.get(c.policyId) ?? "Policy")
                          : "All policies needing acknowledgement"
                        : task.kind === "checkin" && c.checkinDay
                          ? `Day ${c.checkinDay}`
                          : c.code
                            ? TASK_CODE_LABELS[c.code as TaskCode]
                            : null;
                  return (
                    <TableRow key={task.id}>
                      <TableCell className="text-right text-muted-foreground tabular">{i + 1}</TableCell>
                      <TableCell className="min-w-64">
                        <p className="font-medium">
                          {task.title}
                          {c.required === false ? <span className="ml-2 text-xs font-normal text-muted-foreground">Optional</span> : null}
                        </p>
                        {task.description ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{task.description}</p> : null}
                      </TableCell>
                      <TableCell>{ownerLabel(task.ownerGroup)}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {c.anchor === "probation_end" ? "1 week before probation ends" : offsetLabel(task.dueOffsetDays, t.kind)}
                      </TableCell>
                      <TableCell>
                        <p>{TASK_KIND_LABELS[task.kind as TaskKind] ?? task.kind}</p>
                        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <TemplateTaskDialog templateId={t.id} kind={t.kind} policies={policies} value={task} />
                        <DeleteTemplateTaskButton id={task.id} title={task.title} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState icon={ListPlus} title="No tasks yet" description="Add the steps this checklist should create." className="m-5" />
        )}
      </Section>
    </Reveal>
  );
}
