"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError, SelectField, TextField, TextareaField, type Option } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { createRoleSchema } from "@/lib/validation/users";
import { createRoleAction } from "./actions";

export function CreateRoleDialog({ roles }: { roles: Option[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Create role
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create role</DialogTitle>
          <DialogDescription>Start from scratch or copy the permissions of an existing role, then fine-tune them.</DialogDescription>
        </DialogHeader>
        {open ? <CreateRoleForm roles={roles} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateRoleForm({ roles, onDone }: { roles: Option[]; onDone: () => void }) {
  const router = useRouter();
  const { form, submit, pending } = useActionForm({
    schema: createRoleSchema,
    defaultValues: { name: "", description: "", copyFromRoleId: null } as z.output<typeof createRoleSchema>,
    action: createRoleAction,
    successMessage: "Role created",
    onSuccess: ({ id }) => {
      onDone();
      router.push(`/settings/roles/${id}`);
    },
  });
  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <TextField control={form.control} name="name" label="Name" required placeholder="Regional HR partner" />
        <TextareaField control={form.control} name="description" label="Description" rows={2} />
        <SelectField control={form.control} name="copyFromRoleId" label="Copy permissions from" allowNone="Start empty" options={roles} />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            Create role
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}
