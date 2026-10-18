import type { Metadata } from "next";
import { Suspense } from "react";
import { Building2 } from "lucide-react";
import { EmptyState, NoAccess, PageHeader, Reveal, TableSkeleton } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, requireContext } from "@/server/auth/context";
import { listLegalEntities } from "@/server/services/settings/legal-entities";
import { stateName } from "@/lib/india";
import { formatNumber } from "@/lib/format";
import { LegalEntityDialog, type LegalEntityFormValues } from "./legal-entity-dialog";

export const metadata: Metadata = { title: "Legal entities" };

export default function LegalEntitiesPage() {
  return (
    <>
      <PageHeader
        title="Legal entities"
        description="Each registered company that employs people. Statutory registrations drive payroll, PF, ESI, PT and TDS filings."
      />
      <Suspense fallback={<TableSkeleton rows={3} columns={6} />}>
        <LegalEntitiesData />
      </Suspense>
    </>
  );
}

async function LegalEntitiesData() {
  const ctx = await requireContext();
  if (!can(ctx, "settings.manage", "all")) return <NoAccess />;
  const rows = await listLegalEntities(ctx);

  const toForm = (r: (typeof rows)[number]): LegalEntityFormValues => ({
    id: r.id,
    name: r.name,
    legalName: r.legalName,
    stateCode: r.stateCode,
    registrations: {
      pan: r.registrations.pan ?? "",
      tan: r.registrations.tan ?? "",
      gstin: r.registrations.gstin ?? "",
      cin: r.registrations.cin ?? "",
      pfEstablishmentCode: r.registrations.pfEstablishmentCode ?? "",
      esiEmployerCode: r.registrations.esiEmployerCode ?? "",
      ptRegistration: r.registrations.ptRegistration ?? "",
      lwfRegistration: r.registrations.lwfRegistration ?? "",
    },
    address: {
      line1: r.address.line1 ?? "",
      line2: r.address.line2 ?? "",
      city: r.address.city ?? "",
      postalCode: r.address.postalCode ?? "",
    },
    isDefault: r.isDefault,
    isActive: r.isActive,
  });

  return (
    <Reveal className="space-y-4">
      <div className="flex justify-end">
        <LegalEntityDialog mode="create" />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Building2} title="No legal entities yet" description="Add the registered company that employs your people." />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Entity</TableHead>
                <TableHead>State</TableHead>
                <TableHead>PAN</TableHead>
                <TableHead>TAN</TableHead>
                <TableHead>GSTIN</TableHead>
                <TableHead className="text-right">Employees</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-4">
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{r.legalName}</p>
                  </TableCell>
                  <TableCell>{stateName(r.stateCode) || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.registrations.pan ?? <Missing />}</TableCell>
                  <TableCell className="font-mono text-xs">{r.registrations.tan ?? <Missing />}</TableCell>
                  <TableCell className="font-mono text-xs">{r.registrations.gstin ?? "—"}</TableCell>
                  <TableCell className="text-right tabular">{formatNumber(r.activeEmployees)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {r.isDefault ? <StatusBadge status="default" tone="brand" label="Default" /> : null}
                      <StatusBadge status={r.isActive ? "active" : "inactive"} tone={r.isActive ? "success" : "neutral"} />
                    </div>
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <LegalEntityDialog mode="edit" values={toForm(r)} activeEmployees={r.activeEmployees} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Reveal>
  );
}

function Missing() {
  return <span className="font-sans text-warning">Missing</span>;
}
