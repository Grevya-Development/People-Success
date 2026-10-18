"use client";

import { useState } from "react";
import type { z } from "zod";
import { MailPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError, TextField, type Option } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { inviteUserSchema } from "@/lib/validation/users";
import { ComboboxField } from "../_components/combobox-field";
import { RoleCheckboxes } from "./role-checkboxes";
import { inviteUserAction } from "./actions";

export function InviteDialog({ roles, employees }: { roles: Option[]; employees: Option[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <MailPlus /> Invite people
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite a colleague</DialogTitle>
          <DialogDescription>They will get an email with a link to join. The link works once and expires in 7 days.</DialogDescription>
        </DialogHeader>
        {open ? <InviteForm roles={roles} employees={employees} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({ roles, employees, onDone }: { roles: Option[]; employees: Option[]; onDone: () => void }) {
  const employeeRole = roles.find((r) => r.label === "Employee")?.value;
  const { form, submit, pending } = useActionForm({
    schema: inviteUserSchema,
    defaultValues: { email: "", roleIds: employeeRole ? [employeeRole] : [], employeeId: null } as z.output<typeof inviteUserSchema>,
    action: inviteUserAction,
    successMessage: "Invitation sent",
    onSuccess: onDone,
  });
  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <TextField control={form.control} name="email" label="Email" type="email" required inputMode="email" autoComplete="off" placeholder="name@company.com" />
        <RoleCheckboxes control={form.control} name="roleIds" roles={roles} />
        <ComboboxField
          control={form.control}
          name="employeeId"
          label="Link to employee record"
          options={employees}
          placeholder="Optional"
          emptyText="No unlinked employees match."
          description="Connects this login to an existing employee so they can use self-service."
        />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            Send invitation
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}
