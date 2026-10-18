import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Network, Trash2 } from "lucide-react";
import { cn } from "cn";
import { EmptyState, NoAccess, PageHeader, Reveal, TableSkeleton } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, requireContext } from "@/server/auth/context";
import { getStructure, type StructureData } from "@/server/services/settings/structure";
import { STRUCTURE_KINDS, STRUCTURE_LABELS, type StructureKind } from "@/lib/validation/settings";
import { formatMoney, formatNumber } from "@/lib/format";
import { ConfirmAction } from "../_components/run-action";
import { StructureDialog, type StructureOptions, type StructureValues } from "./structure-dialog";
import { removeStructureItemAction } from "./actions";

export const metadata: Metadata = { title: "Organization structure" };

export default function StructurePage({ searchParams }: PageProps<"/settings/structure">) {
  return (
    <>
      <PageHeader
        title="Structure"
        description="The building blocks of your org chart. Items in use are deactivated instead of deleted, so history stays intact."
      />
      <Suspense fallback={<StructureSkeleton />}>
        <StructureData searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const tabHref = (kind: StructureKind) => `/settings/structure?tab=${kind}`;

async function StructureData({ searchParams }: { searchParams: PageProps<"/settings/structure">["searchParams"] }) {
  const [ctx, sp] = await Promise.all([requireContext(), searchParams]);
  if (!can(ctx, "org.manage", "all")) return <NoAccess />;
  const raw = typeof sp.tab === "string" ? sp.tab : "departments";
  const tab: StructureKind = (STRUCTURE_KINDS as readonly string[]).includes(raw) ? (raw as StructureKind) : "departments";
  const data = await getStructure(ctx);
  const counts: Record<StructureKind, number> = {
    departments: data.departments.length,
    designations: data.designations.length,
    grades: data.grades.length,
    job_families: data.jobFamilies.length,
    cost_centers: data.costCenters.length,
    business_units: data.businessUnits.length,
    teams: data.teams.length,
  };

  return (
    <Reveal className="space-y-4">
      <nav aria-label="Structure sections" className="-mx-1 flex gap-1 overflow-x-auto border-b px-1">
        {STRUCTURE_KINDS.map((k) => (
          <Link
            key={k}
            href={tabHref(k)}
            scroll={false}
            aria-current={k === tab ? "page" : undefined}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-sm whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              k === tab ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {STRUCTURE_LABELS[k].plural}
            <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular">{counts[k]}</span>
          </Link>
        ))}
      </nav>
      <div className="flex justify-end">
        <StructureDialog kind={tab} options={data.options} />
      </div>
      <KindTable kind={tab} data={data} options={data.options} />
    </Reveal>
  );
}

type Column<R> = { header: string; cell: (r: R) => React.ReactNode; className?: string };

function KindTable({ kind, data, options }: { kind: StructureKind; data: StructureData; options: StructureOptions }) {
  switch (kind) {
    case "departments":
      return (
        <DataTable
          kind={kind}
          options={options}
          rows={data.departments}
          title={(r) => r.name}
          subtitle={(r) => r.code}
          active={(r) => r.isActive}
          inUse={(r) => r.employeeCount + r.childCount > 0}
          toValues={(r) => ({
            id: r.id,
            name: r.name,
            code: r.code ?? "",
            parentId: r.parentId,
            headEmployeeId: r.headEmployeeId,
            businessUnitId: r.businessUnitId,
            costCenterId: r.costCenterId,
            isActive: r.isActive,
          })}
          columns={[
            { header: "Parent", cell: (r) => r.parentName ?? "—" },
            { header: "Head", cell: (r) => r.headName ?? "—" },
            { header: "Cost center", cell: (r) => r.costCenterName ?? "—" },
            { header: "Employees", cell: (r) => formatNumber(r.employeeCount), className: "text-right tabular" },
          ]}
        />
      );
    case "designations":
      return (
        <DataTable
          kind={kind}
          options={options}
          rows={data.designations}
          title={(r) => r.title}
          active={(r) => r.isActive}
          inUse={(r) => r.employeeCount > 0}
          toValues={(r) => ({ id: r.id, title: r.title, jobFamilyId: r.jobFamilyId, gradeId: r.gradeId, description: r.description ?? "", isActive: r.isActive })}
          columns={[
            { header: "Job family", cell: (r) => r.jobFamilyName ?? "—" },
            { header: "Grade", cell: (r) => r.gradeName ?? "—" },
            { header: "Employees", cell: (r) => formatNumber(r.employeeCount), className: "text-right tabular" },
          ]}
        />
      );
    case "grades":
      return (
        <DataTable
          kind={kind}
          options={options}
          rows={data.grades}
          title={(r) => `${r.code} · ${r.name}`}
          inUse={(r) => r.employeeCount + r.designationCount > 0}
          toValues={(r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            rank: r.rank,
            minAnnualCtcRupees: r.minAnnualCtc == null ? "" : String(Math.round(r.minAnnualCtc / 100)),
            maxAnnualCtcRupees: r.maxAnnualCtc == null ? "" : String(Math.round(r.maxAnnualCtc / 100)),
          })}
          columns={[
            { header: "Rank", cell: (r) => r.rank, className: "tabular" },
            {
              header: "Annual CTC band",
              cell: (r) =>
                r.minAnnualCtc == null && r.maxAnnualCtc == null
                  ? "—"
                  : `${formatMoney(r.minAnnualCtc, r.currency, { compact: true })} – ${formatMoney(r.maxAnnualCtc, r.currency, { compact: true })}`,
              className: "tabular",
            },
            { header: "Employees", cell: (r) => formatNumber(r.employeeCount), className: "text-right tabular" },
          ]}
        />
      );
    case "job_families":
      return (
        <DataTable
          kind={kind}
          options={options}
          rows={data.jobFamilies}
          title={(r) => r.name}
          subtitle={(r) => r.description}
          inUse={(r) => r.designationCount > 0}
          toValues={(r) => ({ id: r.id, name: r.name, description: r.description ?? "" })}
          columns={[{ header: "Designations", cell: (r) => formatNumber(r.designationCount), className: "text-right tabular" }]}
        />
      );
    case "cost_centers":
      return (
        <DataTable
          kind={kind}
          options={options}
          rows={data.costCenters}
          title={(r) => `${r.code} · ${r.name}`}
          active={(r) => r.isActive}
          inUse={(r) => r.employeeCount > 0}
          toValues={(r) => ({ id: r.id, code: r.code, name: r.name, legalEntityId: r.legalEntityId, isActive: r.isActive })}
          columns={[
            { header: "Legal entity", cell: (r) => r.legalEntityName ?? "Any" },
            { header: "Employees", cell: (r) => formatNumber(r.employeeCount), className: "text-right tabular" },
          ]}
        />
      );
    case "business_units":
      return (
        <DataTable
          kind={kind}
          options={options}
          rows={data.businessUnits}
          title={(r) => r.name}
          subtitle={(r) => r.code}
          active={(r) => r.isActive}
          inUse={(r) => r.employeeCount > 0}
          toValues={(r) => ({ id: r.id, name: r.name, code: r.code ?? "", headEmployeeId: r.headEmployeeId, isActive: r.isActive })}
          columns={[
            { header: "Head", cell: (r) => r.headName ?? "—" },
            { header: "Employees", cell: (r) => formatNumber(r.employeeCount), className: "text-right tabular" },
          ]}
        />
      );
    case "teams":
      return (
        <DataTable
          kind={kind}
          options={options}
          rows={data.teams}
          title={(r) => r.name}
          active={(r) => r.isActive}
          inUse={(r) => r.employeeCount > 0}
          toValues={(r) => ({ id: r.id, name: r.name, departmentId: r.departmentId, leadEmployeeId: r.leadEmployeeId, isActive: r.isActive })}
          columns={[
            { header: "Department", cell: (r) => r.departmentName ?? "—" },
            { header: "Lead", cell: (r) => r.leadName ?? "—" },
            { header: "Employees", cell: (r) => formatNumber(r.employeeCount), className: "text-right tabular" },
          ]}
        />
      );
  }
}

function DataTable<R extends { id: string }>({
  kind,
  rows,
  options,
  title,
  subtitle,
  active,
  inUse,
  toValues,
  columns,
}: {
  kind: StructureKind;
  rows: R[];
  options: StructureOptions;
  title: (r: R) => string;
  subtitle?: (r: R) => string | null;
  active?: (r: R) => boolean;
  inUse: (r: R) => boolean;
  toValues: (r: R) => StructureValues;
  columns: Column<R>[];
}) {
  const labels = STRUCTURE_LABELS[kind];
  if (!rows.length) {
    return <EmptyState icon={Network} title={`No ${labels.plural.toLowerCase()} yet`} description={`Add your first ${labels.singular} to start building your structure.`} />;
  }
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Name</TableHead>
            {columns.map((c) => (
              <TableHead key={c.header} className={c.className?.includes("text-right") ? "text-right" : undefined}>
                {c.header}
              </TableHead>
            ))}
            {active ? <TableHead>Status</TableHead> : null}
            <TableHead className="pr-4 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const isActive = active ? active(r) : true;
            const used = inUse(r);
            const canRemove = isActive || !used || !active;
            return (
              <TableRow key={r.id}>
                <TableCell className="pl-4">
                  <p className="font-medium">{title(r)}</p>
                  {subtitle?.(r) ? <p className="max-w-80 truncate text-xs text-muted-foreground">{subtitle(r)}</p> : null}
                </TableCell>
                {columns.map((c) => (
                  <TableCell key={c.header} className={c.className}>
                    {c.cell(r)}
                  </TableCell>
                ))}
                {active ? (
                  <TableCell>
                    <StatusBadge status={isActive ? "active" : "inactive"} tone={isActive ? "success" : "neutral"} />
                  </TableCell>
                ) : null}
                <TableCell className="pr-4">
                  <div className="flex justify-end gap-1">
                    <StructureDialog kind={kind} values={toValues(r)} options={options} />
                    {canRemove ? (
                      <ConfirmAction
                        trigger={
                          <Button variant="ghost" size="icon-sm" aria-label={`Remove ${title(r)}`}>
                            <Trash2 />
                          </Button>
                        }
                        title={`Remove ${title(r)}?`}
                        description={
                          active
                            ? `If anything still references this ${labels.singular}, it will be deactivated instead of deleted.`
                            : `This ${labels.singular} can only be deleted when nothing references it.`
                        }
                        confirmLabel="Remove"
                        destructive
                        action={removeStructureItemAction}
                        input={{ kind, id: r.id }}
                        outcomeMessages={{ deleted: `${labels.singular[0].toUpperCase()}${labels.singular.slice(1)} deleted`, deactivated: "In use, so it was deactivated" }}
                      />
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function StructureSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-3 border-b pb-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-24" />
        ))}
      </div>
      <TableSkeleton rows={5} columns={5} />
    </div>
  );
}
