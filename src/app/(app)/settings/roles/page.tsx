import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ShieldCheck, Trash2 } from "lucide-react";
import { EmptyState, NoAccess, PageHeader, Reveal, TableSkeleton } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, requireContext } from "@/server/auth/context";
import { listRoles } from "@/server/services/settings/roles";
import { formatNumber } from "@/lib/format";
import { ConfirmAction } from "../_components/run-action";
import { CreateRoleDialog } from "./create-role-dialog";
import { deleteRoleAction } from "./actions";

export const metadata: Metadata = { title: "Roles and permissions" };

export default function RolesPage() {
  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="Roles bundle permissions. A member's access is the combination of all their roles, with the widest scope winning."
      />
      <Suspense fallback={<TableSkeleton rows={8} columns={4} />}>
        <RolesData />
      </Suspense>
    </>
  );
}

async function RolesData() {
  const ctx = await requireContext();
  if (!can(ctx, "roles.manage", "all")) return <NoAccess />;
  const roles = await listRoles(ctx);
  return (
    <Reveal className="space-y-4">
      <div className="flex justify-end">
        <CreateRoleDialog roles={roles.map((r) => ({ value: r.id, label: r.name }))} />
      </div>
      {roles.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No roles" description="Create a role to start granting access." />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Role</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Permissions</TableHead>
                <TableHead className="text-right">Active members</TableHead>
                <TableHead className="pr-4 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-4">
                    <Link href={`/settings/roles/${r.id}`} className="font-medium underline-offset-4 hover:underline">
                      {r.name}
                    </Link>
                    {r.description ? <p className="max-w-md truncate text-xs text-muted-foreground">{r.description}</p> : null}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.isSystem ? "built_in" : "custom"} tone={r.isSystem ? "neutral" : "info"} label={r.isSystem ? "Built-in" : "Custom"} />
                  </TableCell>
                  <TableCell className="text-right tabular">{formatNumber(r.permissionCount)}</TableCell>
                  <TableCell className="text-right tabular">{formatNumber(r.memberCount)}</TableCell>
                  <TableCell className="pr-4">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/settings/roles/${r.id}`}>{r.editable ? "Edit" : "View"}</Link>
                      </Button>
                      {r.deletable ? (
                        <ConfirmAction
                          trigger={
                            <Button variant="ghost" size="icon-sm" aria-label={`Delete ${r.name}`}>
                              <Trash2 />
                            </Button>
                          }
                          title={`Delete ${r.name}?`}
                          description="The role is not assigned to anyone. This cannot be undone."
                          confirmLabel="Delete role"
                          destructive
                          action={deleteRoleAction}
                          input={{ id: r.id }}
                          success="Role deleted"
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
