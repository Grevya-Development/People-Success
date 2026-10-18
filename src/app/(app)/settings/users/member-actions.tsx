"use client";

import { useState } from "react";
import type { z } from "zod";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError, type Option } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { updateMemberRolesSchema } from "@/lib/validation/users";
import { useRunAction } from "../_components/run-action";
import { RoleCheckboxes } from "./role-checkboxes";
import { resendInvitationAction, revokeInvitationAction, setMembershipStatusAction, updateMemberRolesAction } from "./actions";

type Member = { membershipId: string; name: string; status: string; roleIds: string[]; isSelf: boolean };

export function MemberActions({ member, roles }: { member: Member; roles: Option[] }) {
  const [dialog, setDialog] = useState<"roles" | "status" | null>(null);
  const { pending, run } = useRunAction();
  const suspending = member.status === "active";
  const canChangeStatus = !member.isSelf && (member.status === "active" || member.status === "suspended" || member.status === "deactivated");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${member.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog("roles")}>Change roles</DropdownMenuItem>
          {canChangeStatus ? (
            <DropdownMenuItem variant={suspending ? "destructive" : "default"} onSelect={() => setDialog("status")}>
              {suspending ? "Suspend access" : "Reactivate access"}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog === "roles"} onOpenChange={(o) => setDialog(o ? "roles" : null)}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Roles for {member.name}</DialogTitle>
            <DialogDescription>
              {member.isSelf ? "You are editing your own access. You cannot remove the last owner or the last user manager." : "Changes apply on their next page load."}
            </DialogDescription>
          </DialogHeader>
          {dialog === "roles" ? <RolesForm member={member} roles={roles} onDone={() => setDialog(null)} /> : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={dialog === "status"} onOpenChange={(o) => setDialog(o ? "status" : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{suspending ? `Suspend ${member.name}?` : `Reactivate ${member.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {suspending
                ? "They will lose access to this organization immediately. Their employee record and history are kept."
                : "They will be able to sign in to this organization again with their existing roles."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button
              variant={suspending ? "destructive" : "default"}
              disabled={pending}
              onClick={async () => {
                const ok = await run(() => setMembershipStatusAction({ membershipId: member.membershipId, status: suspending ? "suspended" : "active" }), {
                  success: suspending ? "Access suspended" : "Access restored",
                });
                if (ok) setDialog(null);
              }}
            >
              {pending ? <Spinner /> : null}
              {suspending ? "Suspend" : "Reactivate"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RolesForm({ member, roles, onDone }: { member: Member; roles: Option[]; onDone: () => void }) {
  const { form, submit, pending } = useActionForm({
    schema: updateMemberRolesSchema,
    defaultValues: { membershipId: member.membershipId, roleIds: member.roleIds } as z.output<typeof updateMemberRolesSchema>,
    action: updateMemberRolesAction,
    successMessage: "Roles updated",
    onSuccess: onDone,
  });
  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <RoleCheckboxes control={form.control} name="roleIds" roles={roles} />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            Save roles
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}

export function InvitationActions({ id, email, canRevoke }: { id: string; email: string; canRevoke: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const { pending, run } = useRunAction();
  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => resendInvitationAction({ id }), { success: `New invitation sent to ${email}` })}>
        {pending && !confirm ? <Spinner /> : null}
        Resend
      </Button>
      {canRevoke ? (
        <AlertDialog open={confirm} onOpenChange={setConfirm}>
          <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
            Revoke
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke invitation?</AlertDialogTitle>
              <AlertDialogDescription>The link sent to {email} will stop working. You can invite them again later.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={async () => {
                  if (await run(() => revokeInvitationAction({ id }), { success: "Invitation revoked" })) setConfirm(false);
                }}
              >
                {pending ? <Spinner /> : null}
                Revoke
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}
