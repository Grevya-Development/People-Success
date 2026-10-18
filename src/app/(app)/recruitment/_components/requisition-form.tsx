"use client";

import { useRouter } from "next/navigation";
import { useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FieldGroup, FieldLegend, FieldSeparator, FieldSet } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { titleCase } from "@/lib/format";
import { EMPLOYMENT_TYPES, requisitionSchema, type RequisitionInput } from "@/lib/validation/recruitment";
import type { RecruitmentLookups } from "@/server/services/recruitment/lookups";
import { createRequisitionAction, updateRequisitionAction } from "../actions";
import { useRef, useState } from "react";

const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: titleCase(v) }));

export function RequisitionForm({
  lookups,
  canSeeBudget,
  initial,
  id,
  defaultHiringManager,
}: {
  lookups: RecruitmentLookups;
  canSeeBudget: boolean;
  initial?: RequisitionInput;
  id?: string;
  defaultHiringManager?: string | null;
}) {
  const router = useRouter();
  const submitRef = useRef(false);
  const [submitAfter, setSubmitAfterState] = useState(false);
  const setSubmitAfter = (v: boolean) => {
    submitRef.current = v;
    setSubmitAfterState(v);
  };
  const { form, submit, pending } = useActionForm({
    schema: requisitionSchema,
    defaultValues: (initial as never) ?? {
      title: "",
      departmentId: null,
      designationId: null,
      locationId: null,
      legalEntityId: lookups.defaultLegalEntityId,
      positionId: null,
      headcount: 1,
      employmentType: "full_time",
      reason: "new",
      backfillForEmployeeId: null,
      budgetMinAnnual: null,
      budgetMaxAnnual: null,
      justification: "",
      hiringManagerEmployeeId: defaultHiringManager ?? null,
      recruiterUserId: null,
      targetStartDate: null,
    },
    action: async (data: RequisitionInput) => {
      if (id) {
        const r = await updateRequisitionAction({ id, data });
        return r.ok ? { ok: true as const, data: { id, code: "" } } : r;
      }
      return createRequisitionAction({ data, submit: submitRef.current });
    },
    successMessage: () => (id ? "Requisition saved" : submitRef.current ? "Requisition submitted for approval" : "Draft saved"),
    onSuccess: (d) => router.push(`/recruitment/requisitions/${d.id}`),
  });
  const c = form.control;
  const reason = useWatch({ control: c, name: "reason" });

  return (
    <form onSubmit={submit} noValidate className="rounded-xl border bg-card p-6">
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <FieldSet>
          <FieldLegend>Role</FieldLegend>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField control={c} name="title" label="Job title" required className="sm:col-span-2" />
            <SelectField control={c} name="departmentId" label="Department" options={lookups.departments} allowNone="None" />
            <SelectField control={c} name="designationId" label="Designation" options={lookups.designations} allowNone="None" />
            <SelectField control={c} name="locationId" label="Location" options={lookups.locations} allowNone="None" />
            <SelectField control={c} name="legalEntityId" label="Legal entity" options={lookups.legalEntities} allowNone="Not decided" />
            <SelectField control={c} name="employmentType" label="Employment type" options={opts(EMPLOYMENT_TYPES)} />
            <TextField control={c} name="headcount" label="Headcount" type="number" inputMode="numeric" required />
            <TextField control={c} name="targetStartDate" label="Target start date" type="date" />
            <SelectField
              control={c}
              name="positionId"
              label="Existing position"
              options={lookups.positions}
              allowNone="No position yet"
              description="Planned positions are opened when the requisition is approved."
            />
          </div>
        </FieldSet>
        <FieldSeparator />
        <FieldSet>
          <FieldLegend>Why and who</FieldLegend>
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField control={c} name="reason" label="Reason" options={[{ value: "new", label: "New role" }, { value: "backfill", label: "Backfill" }]} />
            {reason === "backfill" ? (
              <SelectField control={c} name="backfillForEmployeeId" label="Replacing" options={lookups.employees} allowNone="Choose employee" required />
            ) : (
              <div />
            )}
            <SelectField control={c} name="hiringManagerEmployeeId" label="Hiring manager" options={lookups.employees} allowNone="None" description="Their department head approves first." />
            <SelectField control={c} name="recruiterUserId" label="Recruiter" options={lookups.recruiters} allowNone="Unassigned" />
          </div>
          <TextareaField control={c} name="justification" label="Justification" rows={4} required description="Business need, impact of not hiring, and timing." />
        </FieldSet>
        {canSeeBudget ? (
          <>
            <FieldSeparator />
            <FieldSet>
              <FieldLegend>Budget</FieldLegend>
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField control={c} name="budgetMinAnnual" label="Annual CTC from (₹)" inputMode="decimal" />
                <TextField control={c} name="budgetMaxAnnual" label="Annual CTC up to (₹)" inputMode="decimal" />
              </div>
              <p className="text-xs text-muted-foreground">Visible only to people who can see compensation or approve requisitions and offers.</p>
            </FieldSet>
          </>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-5">
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
          {id ? (
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              Save changes
            </Button>
          ) : (
            <>
              <Button type="submit" variant="outline" disabled={pending} onClick={() => setSubmitAfter(false)}>
                {pending && !submitAfter ? <Spinner /> : null}
                Save draft
              </Button>
              <Button type="submit" disabled={pending} onClick={() => setSubmitAfter(true)}>
                {pending && submitAfter ? <Spinner /> : null}
                Submit for approval
              </Button>
            </>
          )}
        </div>
      </FieldGroup>
    </form>
  );
}
