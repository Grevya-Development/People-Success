import type { Metadata } from "next";
import { Suspense } from "react";
import { MapPin, Trash2 } from "lucide-react";
import { EmptyState, NoAccess, PageHeader, Reveal, TableSkeleton } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, requireContext } from "@/server/auth/context";
import { listLocations } from "@/server/services/settings/locations";
import { legalEntityOptions } from "@/server/services/settings/lookups";
import { stateName } from "@/lib/india";
import { formatNumber, titleCase } from "@/lib/format";
import { ConfirmAction } from "../_components/run-action";
import { LocationDialog, type LocationFormValues } from "./location-dialog";
import { removeLocationAction } from "./actions";

export const metadata: Metadata = { title: "Locations" };

export default function LocationsPage() {
  return (
    <>
      <PageHeader title="Locations" description="Offices, branches and sites. Locations drive holiday calendars, professional tax state and attendance geofencing." />
      <Suspense fallback={<TableSkeleton rows={4} columns={6} />}>
        <LocationsData />
      </Suspense>
    </>
  );
}

async function LocationsData() {
  const ctx = await requireContext();
  if (!can(ctx, "org.manage", "all")) return <NoAccess />;
  const [rows, entities] = await Promise.all([listLocations(ctx), ctx.db((tx) => legalEntityOptions(tx))]);

  const toForm = (r: (typeof rows)[number]): LocationFormValues => ({
    id: r.id,
    name: r.name,
    code: r.code ?? "",
    type: r.type,
    legalEntityId: r.legalEntityId,
    stateCode: r.stateCode,
    timezone: r.timezone,
    address: { line1: r.address.line1 ?? "", line2: r.address.line2 ?? "", city: r.address.city ?? "", postalCode: r.address.postalCode ?? "" },
    geofenceEnabled: !!r.geofence,
    lat: r.geofence ? String(r.geofence.lat) : "",
    lng: r.geofence ? String(r.geofence.lng) : "",
    radiusMeters: r.geofence ? String(r.geofence.radiusMeters) : "",
    isActive: r.isActive,
  });

  return (
    <Reveal className="space-y-4">
      <div className="flex justify-end">
        <LocationDialog mode="create" entities={entities} />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={MapPin} title="No locations yet" description="Add your offices and work sites so employees can be assigned to them." />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Location</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Legal entity</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Geofence</TableHead>
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
                    <p className="text-xs text-muted-foreground">
                      {[r.code, r.address.city, r.timezone !== "Asia/Kolkata" ? r.timezone : null].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </TableCell>
                  <TableCell>{titleCase(r.type)}</TableCell>
                  <TableCell>{r.legalEntityName ?? "—"}</TableCell>
                  <TableCell>{stateName(r.stateCode) || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular">
                    {r.geofence ? `${formatNumber(r.geofence.radiusMeters)} m radius` : "Off"}
                  </TableCell>
                  <TableCell className="text-right tabular">{formatNumber(r.employeeCount)}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.isActive ? "active" : "inactive"} tone={r.isActive ? "success" : "neutral"} />
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex justify-end gap-1">
                      <LocationDialog mode="edit" entities={entities} values={toForm(r)} />
                      {r.isActive || r.employeeCount === 0 ? (
                        <ConfirmAction
                          trigger={
                            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${r.name}`}>
                              <Trash2 />
                            </Button>
                          }
                          title={`Remove ${r.name}?`}
                          description="If employees or positions still reference this location it will be deactivated instead of deleted, so history stays intact."
                          confirmLabel="Remove"
                          destructive
                          action={removeLocationAction}
                          input={{ id: r.id }}
                          outcomeMessages={{ deleted: "Location deleted", deactivated: "Location is in use, so it was deactivated" }}
                        />
                      ) : null}
                    </div>
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
