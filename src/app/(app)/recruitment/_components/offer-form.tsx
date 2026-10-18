"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldGroup, FieldLegend, FieldSeparator, FieldSet } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError, SelectField, TextField } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { titleCase } from "@/lib/format";
import { EMPLOYMENT_TYPES, offerSchema, type OfferInput } from "@/lib/validation/recruitment";
import type { RecruitmentLookups } from "@/server/services/recruitment/lookups";
import { createOfferAction, reviseOfferAction } from "../actions";

export function OfferForm({
  lookups,
  applications,
  initial,
  offerId,
  revisingSent,
}: {
  lookups: RecruitmentLookups;
  applications: { value: string; label: string }[];
  initial: Partial<OfferInput>;
  offerId?: string;
  /** Editing an approved/sent offer creates a new version. */
  revisingSent?: boolean;
}) {
  const router = useRouter();
  const { form, submit, pending } = useActionForm({
    schema: offerSchema,
    defaultValues: {
      applicationId: "",
      designationId: null,
      departmentId: null,
      locationId: null,
      legalEntityId: lookups.defaultLegalEntityId ?? "",
      reportingManagerId: null,
      employmentType: "full_time",
      joiningDate: "",
      annualCtc: "",
      probationMonths: 6,
      noticePeriodDays: 30,
      expiresOn: "",
      ...(initial as object),
    } as never,
    action: async (data: OfferInput) => {
      if (offerId) {
        const { applicationId: _ignored, ...rest } = data;
        void _ignored;
        return reviseOfferAction({ offerId, data: rest });
      }
      return createOfferAction(data);
    },
    successMessage: (d) => ("newVersion" in d && d.newVersion ? "New offer version created" : offerId ? "Offer saved" : "Offer drafted"),
    onSuccess: (d) => router.push(`/recruitment/offers/${d.id}`),
  });
  const c = form.control;
  return (
    <form onSubmit={submit} noValidate className="rounded-xl border bg-card p-6">
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        {revisingSent ? (
          <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
            This offer is already approved or sent. Saving creates a new version that needs approval again; the current version is rescinded and its link stops working.
          </p>
        ) : null}
        {!offerId ? (
          <SelectField control={c} name="applicationId" label="Candidate" options={applications} required description="Candidates at the Offer stage without an offer in progress." />
        ) : null}
        <FieldSet>
          <FieldLegend>Role</FieldLegend>
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField control={c} name="designationId" label="Designation" options={lookups.designations} allowNone="None" />
            <SelectField control={c} name="departmentId" label="Department" options={lookups.departments} allowNone="None" />
            <SelectField control={c} name="locationId" label="Location" options={lookups.locations} allowNone="None" />
            <SelectField control={c} name="legalEntityId" label="Legal entity" options={lookups.legalEntities} required />
            <SelectField control={c} name="reportingManagerId" label="Reporting manager" options={lookups.employees} allowNone="None" />
            <SelectField control={c} name="employmentType" label="Employment type" options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: titleCase(t) }))} />
          </div>
        </FieldSet>
        <FieldSeparator />
        <FieldSet>
          <FieldLegend>Terms</FieldLegend>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField control={c} name="annualCtc" label="Annual CTC (₹)" inputMode="decimal" required description="Split into components using your default salary structure, or Basic 50% / HRA 20% / Special allowance." />
            <TextField control={c} name="joiningDate" label="Joining date" type="date" required />
            <TextField control={c} name="probationMonths" label="Probation (months)" type="number" inputMode="numeric" />
            <TextField control={c} name="noticePeriodDays" label="Notice period (days)" type="number" inputMode="numeric" />
            <TextField control={c} name="expiresOn" label="Offer valid until" type="date" required description="The response link stops working after this date." />
          </div>
        </FieldSet>
        <div className="flex justify-end gap-2 border-t pt-5">
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            {offerId ? (revisingSent ? "Create new version" : "Save offer") : "Save draft"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
