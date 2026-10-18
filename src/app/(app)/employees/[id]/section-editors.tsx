"use client";

import { useTransition } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { CheckboxField, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { INDIAN_STATES } from "@/lib/india";
import {
  addressSchema,
  compensationSchema,
  dependentSchema,
  emergencyContactSchema,
  qualificationSchema,
  sensitiveSchema,
  skillSchema,
} from "@/lib/validation/employees";
import type { ActionResult } from "@/lib/action-result";
import {
  addCompensationAction,
  assignAssetAction,
  returnAssetAction,
  saveDependentAction,
  saveEmergencyContactAction,
  saveQualificationAction,
  saveSkillAction,
  updateSensitiveAction,
  upsertAddressAction,
} from "../actions";

const states = INDIAN_STATES.map((s) => ({ value: s.code, label: s.name }));

function EditTrigger({ label, isNew }: { label: string; isNew?: boolean }) {
  return isNew ? (
    <Button variant="outline" size="xs">
      <Plus /> {label}
    </Button>
  ) : (
    <Button variant="ghost" size="icon-xs" aria-label={label}>
      <Pencil />
    </Button>
  );
}

export function DeleteRowButton({ label, action, small }: { label: string; action: () => Promise<ActionResult<unknown>>; small?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      disabled={pending}
      className={small ? "size-5 text-muted-foreground" : "text-muted-foreground hover:text-danger"}
      onClick={() =>
        start(async () => {
          const res = await action();
          if (!res.ok) toast.error(res.error.message);
        })
      }
    >
      {small ? <X /> : <Trash2 />}
    </Button>
  );
}

type Address = { line1: string; line2: string | null; city: string; stateCode: string | null; postalCode: string | null; countryCode: string } | null;

export function AddressEditor({ employeeId, type, value }: { employeeId: string; type: "current" | "permanent"; value: Address }) {
  return (
    <FormDialog
      title={`${type === "current" ? "Current" : "Permanent"} address`}
      schema={addressSchema}
      defaultValues={{
        employeeId,
        type,
        line1: value?.line1 ?? "",
        line2: value?.line2 ?? "",
        city: value?.city ?? "",
        stateCode: value?.stateCode ?? null,
        postalCode: value?.postalCode ?? "",
        countryCode: value?.countryCode ?? "IN",
      }}
      action={upsertAddressAction}
      trigger={<EditTrigger label={value ? "Edit address" : "Add"} isNew={!value} />}
    >
      {(f) => (
        <>
          <TextField control={f.control} name="line1" label="Address line 1" required />
          <TextField control={f.control} name="line2" label="Address line 2" />
          <div className="grid gap-5 sm:grid-cols-3">
            <TextField control={f.control} name="city" label="City" required />
            <SelectField control={f.control} name="stateCode" label="State" options={states} allowNone="—" />
            <TextField control={f.control} name="postalCode" label="PIN code" inputMode="numeric" />
          </div>
        </>
      )}
    </FormDialog>
  );
}

type Contact = { id: string; name: string; relationship: string; phone: string; email: string | null; isPrimary: boolean };

export function ContactEditor({ employeeId, value }: { employeeId: string; value?: Contact }) {
  return (
    <FormDialog
      title={value ? "Edit emergency contact" : "Add emergency contact"}
      schema={emergencyContactSchema}
      defaultValues={{
        employeeId,
        id: value?.id,
        name: value?.name ?? "",
        relationship: value?.relationship ?? "",
        phone: value?.phone ?? "",
        email: value?.email ?? "",
        isPrimary: value?.isPrimary ?? false,
      }}
      action={saveEmergencyContactAction}
      trigger={<EditTrigger label={value ? `Edit ${value.name}` : "Add"} isNew={!value} />}
    >
      {(f) => (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField control={f.control} name="name" label="Name" required />
            <TextField control={f.control} name="relationship" label="Relationship" required placeholder="Spouse, parent, sibling…" />
            <TextField control={f.control} name="phone" label="Phone" required inputMode="tel" />
            <TextField control={f.control} name="email" label="Email" type="email" />
          </div>
          <CheckboxField control={f.control} name="isPrimary" label="Primary contact" />
        </>
      )}
    </FormDialog>
  );
}

type Dependent = { id: string; name: string; relationship: string; dateOfBirth: string | null; isNominee: boolean; nominationPercent: number | null };

export function DependentEditor({ employeeId, value }: { employeeId: string; value?: Dependent }) {
  return (
    <FormDialog
      title={value ? "Edit dependent" : "Add dependent"}
      schema={dependentSchema}
      defaultValues={{
        employeeId,
        id: value?.id,
        name: value?.name ?? "",
        relationship: value?.relationship ?? "",
        dateOfBirth: value?.dateOfBirth ?? "",
        isNominee: value?.isNominee ?? false,
        nominationPercent: value?.nominationPercent ?? null,
      }}
      action={saveDependentAction}
      trigger={<EditTrigger label={value ? `Edit ${value.name}` : "Add"} isNew={!value} />}
    >
      {(f) => (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField control={f.control} name="name" label="Name" required />
            <TextField control={f.control} name="relationship" label="Relationship" required />
            <TextField control={f.control} name="dateOfBirth" label="Date of birth" type="date" />
            <TextField control={f.control} name="nominationPercent" label="Nomination share (%)" type="number" description="For PF/gratuity nominations." />
          </div>
          <CheckboxField control={f.control} name="isNominee" label="Nominee" />
        </>
      )}
    </FormDialog>
  );
}

type Qualification = {
  id: string;
  kind: string;
  title: string;
  institution: string | null;
  fieldOfStudy: string | null;
  startYear: number | null;
  endYear: number | null;
  grade: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  credentialId: string | null;
};

export function QualificationEditor({ employeeId, value }: { employeeId: string; value?: Qualification }) {
  return (
    <FormDialog
      title={value ? "Edit qualification" : "Add qualification"}
      wide
      schema={qualificationSchema}
      defaultValues={{
        employeeId,
        id: value?.id,
        kind: (value?.kind as "education" | "certification") ?? "education",
        title: value?.title ?? "",
        institution: value?.institution ?? "",
        fieldOfStudy: value?.fieldOfStudy ?? "",
        startYear: value?.startYear ?? "",
        endYear: value?.endYear ?? "",
        grade: value?.grade ?? "",
        issuedOn: value?.issuedOn ?? "",
        expiresOn: value?.expiresOn ?? "",
        credentialId: value?.credentialId ?? "",
      }}
      action={saveQualificationAction}
      trigger={<EditTrigger label={value ? `Edit ${value.title}` : "Add"} isNew={!value} />}
    >
      {(f) => (
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField control={f.control} name="kind" label="Type" options={[{ value: "education", label: "Education" }, { value: "certification", label: "Certification" }]} />
          <TextField control={f.control} name="title" label="Degree or certification" required />
          <TextField control={f.control} name="institution" label="Institution or issuer" />
          <TextField control={f.control} name="fieldOfStudy" label="Field of study" />
          <TextField control={f.control} name="startYear" label="Start year" type="number" />
          <TextField control={f.control} name="endYear" label="End year" type="number" />
          <TextField control={f.control} name="grade" label="Grade / score" />
          <TextField control={f.control} name="credentialId" label="Credential ID" />
          <TextField control={f.control} name="issuedOn" label="Issued on" type="date" />
          <TextField control={f.control} name="expiresOn" label="Expires on" type="date" />
        </div>
      )}
    </FormDialog>
  );
}

export function SkillEditor({ employeeId }: { employeeId: string }) {
  return (
    <FormDialog
      title="Add skill"
      schema={skillSchema}
      defaultValues={{ employeeId, name: "", proficiency: 3 }}
      action={saveSkillAction}
      trigger={<EditTrigger label="Add" isNew />}
    >
      {(f) => (
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField control={f.control} name="name" label="Skill" required placeholder="e.g. Payroll processing" />
          <SelectField
            control={f.control}
            name="proficiency"
            label="Proficiency"
            options={[
              { value: "1", label: "1 · Aware" },
              { value: "2", label: "2 · Beginner" },
              { value: "3", label: "3 · Proficient" },
              { value: "4", label: "4 · Advanced" },
              { value: "5", label: "5 · Expert" },
            ]}
          />
        </div>
      )}
    </FormDialog>
  );
}

type SensitiveView = {
  uan: string | null;
  esicNumber: string | null;
  bankIfsc: string | null;
  bankName: string | null;
  accountHolderName: string | null;
  pan: string | null;
  aadhaar: string | null;
  bankAccount: string | null;
  passport: string | null;
} | null;

export function SensitiveEditor({ employeeId, taxRegime, current }: { employeeId: string; taxRegime: "old" | "new"; current: SensitiveView }) {
  return (
    <FormDialog
      title="Edit statutory and bank details"
      description="Leave encrypted fields blank to keep the current value."
      wide
      schema={sensitiveSchema}
      defaultValues={{
        employeeId,
        pan: "",
        aadhaar: "",
        passport: "",
        bankAccount: "",
        uan: current?.uan ?? "",
        esicNumber: current?.esicNumber ?? "",
        bankIfsc: current?.bankIfsc ?? "",
        bankName: current?.bankName ?? "",
        accountHolderName: current?.accountHolderName ?? "",
        taxRegime,
      }}
      action={updateSensitiveAction}
      successMessage={(d) => (d.changed.length ? "Details updated" : "No changes")}
      trigger={
        <Button variant="outline" size="xs">
          <Pencil /> Edit
        </Button>
      }
    >
      {(f) => (
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField control={f.control} name="pan" label="PAN" placeholder={current?.pan ?? "ABCDE1234F"} autoComplete="off" />
          <TextField control={f.control} name="aadhaar" label="Aadhaar" placeholder={current?.aadhaar ?? "12 digits"} autoComplete="off" inputMode="numeric" />
          <TextField control={f.control} name="passport" label="Passport" placeholder={current?.passport ?? ""} autoComplete="off" />
          <TextField control={f.control} name="uan" label="UAN (PF)" inputMode="numeric" />
          <TextField control={f.control} name="esicNumber" label="ESIC number" inputMode="numeric" />
          <SelectField
            control={f.control}
            name="taxRegime"
            label="Income tax regime"
            options={[{ value: "new", label: "New regime" }, { value: "old", label: "Old regime" }]}
          />
          <TextField control={f.control} name="bankAccount" label="Bank account number" placeholder={current?.bankAccount ?? ""} autoComplete="off" inputMode="numeric" />
          <TextField control={f.control} name="bankIfsc" label="IFSC" />
          <TextField control={f.control} name="bankName" label="Bank name" />
          <TextField control={f.control} name="accountHolderName" label="Account holder name" />
        </div>
      )}
    </FormDialog>
  );
}

export function AddCompensationButton({ employeeId, minDate }: { employeeId: string; minDate: string }) {
  return (
    <FormDialog
      title="Record compensation change"
      description={`Effective date must be after ${minDate}. The previous record closes automatically.`}
      schema={compensationSchema}
      defaultValues={{ employeeId, effectiveFrom: "", annualCtc: "", reason: "revision", notes: "" }}
      action={addCompensationAction}
      successMessage="Compensation recorded"
      trigger={
        <Button variant="outline" size="xs">
          <Plus /> Add change
        </Button>
      }
    >
      {(f) => (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField control={f.control} name="effectiveFrom" label="Effective from" type="date" required />
            <TextField control={f.control} name="annualCtc" label="New annual CTC (₹)" type="number" inputMode="decimal" required />
            <SelectField
              control={f.control}
              name="reason"
              label="Reason"
              options={[
                { value: "hire", label: "Starting salary" },
                { value: "revision", label: "Annual revision" },
                { value: "promotion", label: "Promotion" },
                { value: "market_adjustment", label: "Market adjustment" },
                { value: "correction", label: "Correction" },
              ]}
            />
          </div>
          <TextareaField control={f.control} name="notes" label="Notes" rows={2} />
        </>
      )}
    </FormDialog>
  );
}

const assetSchema = z.object({
  employeeId: z.uuid(),
  tag: z.string().trim().min(1, "Enter the asset tag"),
  category: z.string().trim().min(1, "Enter a category"),
  name: z.string().trim().min(1, "Enter a name"),
  serialNumber: z.string().optional(),
  dueBackOn: z.string().optional(),
  condition: z.string().optional(),
});

export function AssignAssetButton({ employeeId }: { employeeId: string }) {
  return (
    <FormDialog
      title="Assign asset"
      description="Assigns an existing asset by tag, or registers a new one."
      schema={assetSchema}
      defaultValues={{ employeeId, tag: "", category: "Laptop", name: "", serialNumber: "", dueBackOn: "", condition: "Good" }}
      action={assignAssetAction}
      successMessage="Asset assigned"
      trigger={
        <Button variant="outline" size="xs">
          <Plus /> Assign
        </Button>
      }
    >
      {(f) => (
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField control={f.control} name="tag" label="Asset tag" required />
          <TextField control={f.control} name="category" label="Category" required />
          <TextField control={f.control} name="name" label="Name / model" required className="sm:col-span-2" />
          <TextField control={f.control} name="serialNumber" label="Serial number" />
          <TextField control={f.control} name="condition" label="Condition" />
        </div>
      )}
    </FormDialog>
  );
}

export function AssetActions({ assignmentId }: { assignmentId: string }) {
  return (
    <FormDialog
      title="Record return"
      schema={z.object({ assignmentId: z.uuid(), condition: z.string().optional() })}
      defaultValues={{ assignmentId, condition: "Good" }}
      action={returnAssetAction}
      submitLabel="Mark returned"
      successMessage="Asset returned"
      trigger={
        <Button variant="ghost" size="xs">
          Return
        </Button>
      }
    >
      {(f) => <TextField control={f.control} name="condition" label="Condition on return" />}
    </FormDialog>
  );
}
