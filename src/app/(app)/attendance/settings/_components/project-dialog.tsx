"use client";

import { Pencil, Plus } from "lucide-react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { SwitchField, TextField } from "@/components/forms/fields";
import { projectSchema } from "@/lib/validation/time";
import { saveProjectAction } from "../../actions";

export function ProjectDialog({ values }: { values?: z.output<typeof projectSchema> }) {
  const editing = !!values?.id;
  return (
    <FormDialog
      trigger={
        editing ? (
          <Button variant="ghost" size="sm">
            <Pencil /> Edit
          </Button>
        ) : (
          <Button size="sm">
            <Plus /> New project
          </Button>
        )
      }
      title={editing ? `Edit ${values?.name}` : "New project"}
      description="Projects are offered when employees fill in timesheets."
      schema={projectSchema}
      defaultValues={values ?? { code: "", name: "", client: null, isBillable: false, isActive: true }}
      action={saveProjectAction}
      successMessage={editing ? "Project updated" : "Project created"}
    >
      {(form) => (
        <>
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <TextField control={form.control} name="code" label="Code" required placeholder="ACME-01" />
            <TextField control={form.control} name="name" label="Name" required placeholder="Website rebuild" />
          </div>
          <TextField control={form.control} name="client" label="Client" placeholder="Optional" />
          <SwitchField control={form.control} name="isBillable" label="Billable" description="Time logged on this project is marked billable." />
          <SwitchField control={form.control} name="isActive" label="Active" description="Inactive projects cannot receive new time." />
        </>
      )}
    </FormDialog>
  );
}
