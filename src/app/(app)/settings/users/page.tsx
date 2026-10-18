import type { Metadata } from "next";
import { Suspense } from "react";
import { MailPlus, Users } from "lucide-react";
import { EmptyState, NoAccess, PageHeader, Reveal, Section, TableSkeleton } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, requireContext } from "@/server/auth/context";
import { listMembers } from "@/server/services/users/members";
import { listInvitations } from "@/server/services/users/invitations";
import { employeeOptions, roleOptions } from "@/server/services/settings/lookups";
import { formatDate, formatDateTime } from "@/lib/format";
import { InviteDialog } from "./invite-dialog";
import { InvitationActions, MemberActions } from "./member-actions";

export const metadata: Metadata = { title: "Users and invitations" };

export default function UsersPage() {
  return (
    <>
      <PageHeader title="Users & invitations" description="Everyone who can sign in to your organization, their roles, and pending invitations." />
      <Suspense
        fallback={
          <div className="space-y-6">
            <TableSkeleton rows={5} columns={5} />
            <TableSkeleton rows={2} columns={5} />
          </div>
        }
      >
        <UsersData />
      </Suspense>
    </>
  );
}

async function UsersData() {
  const ctx = await requireContext();
  if (!can(ctx, "users.manage", "all")) return <NoAccess />;
  const [members, invitations, roles, employees] = await Promise.all([
    listMembers(ctx),
    listInvitations(ctx),
    ctx.db((tx) => roleOptions(tx)),
    ctx.db((tx) => employeeOptions(tx, { withoutUser: true })),
  ]);
  const roleOpts = roles.map((r) => ({ value: r.id, label: r.name, hint: r.description ?? undefined }));
  const pending = invitations.filter((i) => i.status === "pending" || i.status === "expired");
  const history = invitations.filter((i) => i.status !== "pending" && i.status !== "expired");

  return (
    <Reveal className="space-y-6">
      <div className="flex justify-end">
        <InviteDialog roles={roleOpts} employees={employees} />
      </div>

      <Section title="Members" description={`${members.filter((m) => m.status === "active").length} active`}>
        {members.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={Users} title="No members yet" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Person</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Employee record</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-5 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.membershipId}>
                  <TableCell className="pl-5">
                    <p className="font-medium">
                      {m.name ?? m.email}
                      {m.isSelf ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">{m.email}</p>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-md flex-wrap gap-1">
                      {m.roles.length ? (
                        m.roles.map((r) => <StatusBadge key={r.id} status="role" tone={r.key === "tenant_owner" ? "brand" : "neutral"} label={r.name} className="normal-case" />)
                      ) : (
                        <span className="text-xs text-warning">No roles</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{m.employee ? `${m.employee.name} · ${m.employee.code}` : <span className="text-muted-foreground">Not linked</span>}</TableCell>
                  <TableCell>
                    <StatusBadge status={m.status} />
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <MemberActions
                      member={{ membershipId: m.membershipId, name: m.name ?? m.email, status: m.status, roleIds: m.roles.map((r) => r.id), isSelf: m.isSelf }}
                      roles={roleOpts}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Invitations" description="Invitations expire after 7 days. Resending creates a new link and disables the old one.">
        {pending.length === 0 && history.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={MailPlus} title="No invitations" description="Invite HR, payroll and finance colleagues to help set up your organization." />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Email</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Invited by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="pr-5 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...pending, ...history].map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="pl-5">
                    <p className="font-medium">{i.email}</p>
                    {i.employeeName ? <p className="text-xs text-muted-foreground">Links to {i.employeeName}</p> : null}
                  </TableCell>
                  <TableCell className="text-sm">{i.roles.join(", ") || "—"}</TableCell>
                  <TableCell className="text-sm">{i.invitedByName ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={i.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground tabular">
                    {i.status === "accepted" ? `Accepted ${formatDate(i.acceptedAt)}` : i.status === "pending" ? formatDateTime(i.expiresAt) : "—"}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    {i.status === "pending" || i.status === "expired" ? <InvitationActions id={i.id} email={i.email} canRevoke={i.status === "pending"} /> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </Reveal>
  );
}
