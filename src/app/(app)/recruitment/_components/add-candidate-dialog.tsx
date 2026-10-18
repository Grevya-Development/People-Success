"use client";

import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { CheckboxField, SelectField, TextField } from "@/components/forms/fields";
import { manualCandidateSchema, SOURCE_LABELS } from "@/lib/validation/recruitment";
import { createCandidateAction } from "../actions";

export function AddCandidateDialog({ openings }: { openings: { value: string; label: string }[] }) {
  const router = useRouter();
  return (
    <FormDialog
      wide
      trigger={
        <Button size="sm" variant="outline">
          <UserPlus /> Add candidate
        </Button>
      }
      title="Add a candidate"
      description="For people sourced by your team or an agency. Candidates who apply on the careers page are added automatically."
      schema={manualCandidateSchema}
      defaultValues={{
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        currentCompany: "",
        currentTitle: "",
        experienceYears: "",
        linkedinUrl: "",
        source: "sourced",
        sourceDetail: "",
        openingId: null,
        consentConfirmed: false as unknown as true,
      }}
      action={createCandidateAction}
      submitLabel="Add candidate"
      successMessage="Candidate added"
      onSuccess={(d) => router.push(`/recruitment/candidates/${d.id}`)}
    >
      {(form) => {
        const c = form.control;
        return (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={c} name="firstName" label="First name" required />
              <TextField control={c} name="lastName" label="Last name" />
              <TextField control={c} name="email" label="Email" type="email" required />
              <TextField control={c} name="phone" label="Phone" inputMode="tel" />
              <TextField control={c} name="currentTitle" label="Current title" />
              <TextField control={c} name="currentCompany" label="Current company" />
              <TextField control={c} name="experienceYears" label="Experience (years)" type="number" inputMode="numeric" />
              <TextField control={c} name="linkedinUrl" label="LinkedIn" placeholder="https://linkedin.com/in/…" />
              <SelectField
                control={c}
                name="source"
                label="Source"
                options={(["sourced", "agency", "job_board", "internal"] as const).map((s) => ({ value: s, label: SOURCE_LABELS[s] }))}
              />
              <TextField control={c} name="sourceDetail" label="Source detail" placeholder="Agency or job board name" />
            </div>
            <SelectField control={c} name="openingId" label="Add to job" options={openings} allowNone="Don't add to a job yet" />
            <CheckboxField
              control={c}
              name="consentConfirmed"
              label="The candidate agreed to be considered and to us processing their details for recruitment."
              description="Required under the DPDP Act. Their data is kept for 12 months unless they join."
            />
          </>
        );
      }}
    </FormDialog>
  );
}
