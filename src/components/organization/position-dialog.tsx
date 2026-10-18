"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError, SelectField, TextField, type Option } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import {
  POSITION_STATUSES,
  POSITION_STATUS_LABELS,
  createPositionSchema,
  type PositionInput,
  type PositionStatus,
} from "@/lib/validation/organization";
import { createPositionAction, updatePositionAction } from "@/app/(app)/organization/actions";

export type PositionLookupOptions = {
  departments: Option[];
  locations: Option[];
  designations: Option[];
  legalEntities: Option[];
  costCenters: Option[];
  positions: Option[];
  employees: Option[];
};

export type EditablePosition = {
  id: string;
  code: string;
  title: string;
  status: PositionStatus;
  departmentId: string | null;
  locationId: string | null;
  designationId: string | null;
  legalEntityId: string | null;
  costCenterId: string | null;
  reportsToPositionId: string | null;
  employeeId: string | null;
  /** Paise. */
  budgetedAnnualCtc: number | null;
};

const statusOptions = POSITION_STATUSES.map((s) => ({ value: s, label: POSITION_STATUS_LABELS[s] }));

/** Controlled create / edit dialog; one instance serves the whole table. */
export function PositionDialog({
  lookups,
  position,
  open,
  onOpenChange: setOpen,
}: {
  lookups: PositionLookupOptions;
  position?: EditablePosition;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const defaults = position
    ? {
        code: position.code,
        title: position.title,
        status: position.status,
        departmentId: position.departmentId,
        locationId: position.locationId,
        designationId: position.designationId,
        legalEntityId: position.legalEntityId,
        costCenterId: position.costCenterId,
        reportsToPositionId: position.reportsToPositionId,
        employeeId: position.employeeId,
        budgetedAnnualCtc: position.budgetedAnnualCtc == null ? null : position.budgetedAnnualCtc / 100,
      }
    : {
        code: "",
        title: "",
        status: "planned" as const,
        departmentId: null,
        locationId: null,
        designationId: null,
        legalEntityId: null,
        costCenterId: null,
        reportsToPositionId: null,
        employeeId: null,
        budgetedAnnualCtc: null,
      };
  const { form, submit, pending } = useActionForm<PositionInput, { id: string }>({
    schema: createPositionSchema,
    defaultValues: defaults,
    action: (values) => (position ? updatePositionAction({ ...values, id: position.id }) : createPositionAction(values)),
    successMessage: position ? "Position updated" : "Position created",
    onSuccess: () => setOpen(false),
  });
  // Load the selected position (or blank values) whenever the dialog opens.
  useEffect(() => {
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, position?.id]);
  const reportsToOptions = position ? lookups.positions.filter((p) => p.value !== position.id) : lookups.positions;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!pending) setOpen(v);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{position ? `Edit ${position.code}` : "New position"}</DialogTitle>
          <DialogDescription>Positions are approved seats in the organization. Budgets are visible only to org and compensation managers.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup className="gap-4">
            <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
              <TextField control={form.control} name="code" label="Code" required placeholder="ENG-BE-04" />
              <TextField control={form.control} name="title" label="Title" required placeholder="Backend engineer" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField control={form.control} name="status" label="Status" required options={statusOptions} />
              <SelectField
                control={form.control}
                name="employeeId"
                label="Incumbent"
                allowNone="Vacant"
                options={lookups.employees}
                description="Required when the position is filled."
              />
              <SelectField control={form.control} name="departmentId" label="Department" allowNone="None" options={lookups.departments} />
              <SelectField control={form.control} name="designationId" label="Designation" allowNone="None" options={lookups.designations} />
              <SelectField control={form.control} name="locationId" label="Location" allowNone="None" options={lookups.locations} />
              <SelectField control={form.control} name="legalEntityId" label="Legal entity" allowNone="None" options={lookups.legalEntities} />
              <SelectField control={form.control} name="costCenterId" label="Cost center" allowNone="None" options={lookups.costCenters} />
              <SelectField control={form.control} name="reportsToPositionId" label="Reports to position" allowNone="None" options={reportsToOptions} />
            </div>
            <TextField
              control={form.control}
              name="budgetedAnnualCtc"
              label="Budgeted annual CTC (₹)"
              inputMode="decimal"
              placeholder="18,00,000"
              description="In rupees. Leave empty if not budgeted."
            />
            <FormError message={form.formState.errors.root?.message} />
          </FieldGroup>
          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {position ? "Save" : "Create position"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
