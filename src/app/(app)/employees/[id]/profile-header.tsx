"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { BriefcaseBusiness, ChevronDown, Mail, MapPin, Pencil, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PersonAvatar } from "@/components/person";
import { StatusBadge } from "@/components/status-badge";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { formatDate, titleCase } from "@/lib/format";
import {
  CHANGE_TYPES,
  EMPLOYMENT_TYPES,
  GENDERS,
  WORK_MODES,
  jobChangeSchema,
  selfUpdateSchema,
  updatePersonalSchema,
} from "@/lib/validation/employees";
import { z } from "zod";
import type { EmployeeHeader } from "@/server/services/employees/queries";
import type { EmployeeFormLookups } from "@/server/services/employees/lookups";
import {
  changeJobAction,
  confirmProbationAction,
  deleteDraftEmployeeAction,
  markJoinedAction,
  rehireAction,
  selfUpdateAction,
  submitChangeRequestAction,
  updatePersonalAction,
} from "../actions";

const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: titleCase(v) }));
const STATUS_LABEL: Record<string, string> = { pending: "Pre-joining", on_notice: "On notice" };

export function ProfileHeader({
  header,
  lookups,
  today,
  canCreate,
  canDelete,
}: {
  header: EmployeeHeader;
  lookups: EmployeeFormLookups | null;
  today: string;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const { employee: e, access } = header;
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, success: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(success);
        after?.();
      } else toast.error(res.error?.message ?? "Something went wrong");
    });

  const meta = [
    e.code,
    e.location ? (
      <span key="loc" className="inline-flex items-center gap-1">
        <MapPin className="size-3.5" /> {e.location}
      </span>
    ) : null,
    e.workEmail ? (
      <a key="mail" href={`mailto:${e.workEmail}`} className="inline-flex items-center gap-1 hover:text-foreground">
        <Mail className="size-3.5" /> {e.workEmail}
      </a>
    ) : null,
    e.status === "pending" ? `Joins ${formatDate(e.joiningDate)}` : `Joined ${formatDate(e.joiningDate)}`,
  ].filter(Boolean);

  return (
    <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <PersonAvatar id={e.id} name={e.name} className="size-14 text-base" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-[22px]">{e.name}</h1>
            <StatusBadge status={e.status} label={STATUS_LABEL[e.status]} />
            {e.status === "active" && e.probationEndDate && !e.confirmationDate ? <StatusBadge status="probation" tone="info" label="On probation" /> : null}
          </div>
          <p className="mt-0.5 text-sm text-foreground/80">
            {[e.designation, e.department].filter(Boolean).join(" · ") || "No designation yet"}
            {e.managerId ? (
              <>
                {" "}
                · Reports to{" "}
                <Link href={`/employees/${e.managerId}`} className="font-medium hover:underline">
                  {e.managerName}
                </Link>
              </>
            ) : null}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
            {meta.map((m, i) => (
              <span key={i} className="inline-flex items-center">
                {m}
              </span>
            ))}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2">
        {access.canEditAll && lookups ? (
          <>
            <EditDetailsDialog header={header} />
            <FormDialog
              title="Change job"
              description="Effective-dated. Past and today's dates apply immediately; future dates apply on that day."
              wide
              schema={jobChangeSchema}
              defaultValues={{
                employeeId: e.id,
                changeType: "transfer",
                effectiveFrom: today,
                legalEntityId: e.legalEntityId,
                departmentId: e.departmentId,
                designationId: e.designationId,
                locationId: e.locationId,
                managerId: e.managerId,
                gradeId: e.gradeId,
                costCenterId: e.costCenterId,
                employmentType: e.employmentType as (typeof EMPLOYMENT_TYPES)[number],
                reason: "",
              }}
              action={changeJobAction}
              successMessage={(d) => (d.effectiveFrom > today ? `Change scheduled for ${formatDate(d.effectiveFrom)}` : "Job updated")}
              trigger={
                <Button variant="outline" size="sm" disabled={e.status === "exited"}>
                  <BriefcaseBusiness /> Change job
                </Button>
              }
            >
              {(f) => (
                <>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <SelectField control={f.control} name="changeType" label="Type of change" options={opts(CHANGE_TYPES)} />
                    <TextField control={f.control} name="effectiveFrom" label="Effective from" type="date" />
                    <SelectField control={f.control} name="designationId" label="Designation" options={lookups.designations} allowNone="None" />
                    <SelectField control={f.control} name="departmentId" label="Department" options={lookups.departments} allowNone="None" />
                    <SelectField control={f.control} name="managerId" label="Reporting manager" options={lookups.managers.filter((m) => m.value !== e.id)} allowNone="No manager" />
                    <SelectField control={f.control} name="locationId" label="Location" options={lookups.locations} allowNone="None" />
                    <SelectField control={f.control} name="gradeId" label="Grade" options={lookups.grades} allowNone="None" />
                    <SelectField control={f.control} name="costCenterId" label="Cost center" options={lookups.costCenters} allowNone="None" />
                    <SelectField control={f.control} name="legalEntityId" label="Legal entity" options={lookups.legalEntities} />
                    <SelectField control={f.control} name="employmentType" label="Employment type" options={opts(EMPLOYMENT_TYPES)} />
                  </div>
                  <TextareaField control={f.control} name="reason" label="Reason" rows={2} required />
                </>
              )}
            </FormDialog>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={pending}>
                  More <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {e.status === "pending" ? (
                  <DropdownMenuItem onSelect={() => run(() => markJoinedAction({ employeeId: e.id, joinedOn: today }), "Marked as joined", () => router.refresh())}>
                    <UserCheck /> Mark as joined today
                  </DropdownMenuItem>
                ) : null}
                {e.status === "active" && !e.confirmationDate ? (
                  <DropdownMenuItem onSelect={() => run(() => confirmProbationAction({ employeeId: e.id, confirmedOn: today }), "Probation confirmed")}>
                    Confirm probation
                  </DropdownMenuItem>
                ) : null}
                {e.status === "exited" && canCreate ? <RehireItem employeeId={e.id} today={today} /> : null}
                <DropdownMenuItem asChild>
                  <Link href={`/employees/${e.id}?tab=job`}>View job history</Link>
                </DropdownMenuItem>
                {e.status === "pending" && canDelete ? (
                  <>
                    <DropdownMenuSeparator />
                    <DeleteDraftItem employeeId={e.id} name={e.name} />
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}

        {access.isSelf && !access.canEditAll ? (
          <>
            <FormDialog
              title="Update contact details"
              schema={selfUpdateSchema}
              defaultValues={{ employeeId: e.id, phone: e.phone ?? "", personalEmail: e.personalEmail ?? "", bloodGroup: e.bloodGroup ?? "", maritalStatus: e.maritalStatus ?? "" }}
              action={selfUpdateAction}
              trigger={
                <Button variant="outline" size="sm">
                  <Pencil /> Update contact
                </Button>
              }
            >
              {(f) => (
                <div className="grid gap-5 sm:grid-cols-2">
                  <TextField control={f.control} name="phone" label="Mobile" inputMode="tel" />
                  <TextField control={f.control} name="personalEmail" label="Personal email" type="email" />
                  <TextField control={f.control} name="bloodGroup" label="Blood group" />
                  <SelectField control={f.control} name="maritalStatus" label="Marital status" options={opts(["single", "married", "divorced", "widowed"])} allowNone="Not specified" />
                </div>
              )}
            </FormDialog>
            <ChangeRequestDialog employeeId={e.id} />
          </>
        ) : null}
      </div>
    </header>
  );
}

function EditDetailsDialog({ header }: { header: EmployeeHeader }) {
  const e = header.employee;
  return (
    <FormDialog
      title="Edit details"
      wide
      schema={updatePersonalSchema}
      defaultValues={{
        employeeId: e.id,
        firstName: e.firstName,
        middleName: e.middleName ?? "",
        lastName: e.lastName ?? "",
        workEmail: e.workEmail ?? "",
        personalEmail: e.personalEmail ?? "",
        phone: e.phone ?? "",
        dateOfBirth: e.dateOfBirth ?? "",
        gender: (e.gender as (typeof GENDERS)[number] | null) ?? null,
        maritalStatus: e.maritalStatus ?? "",
        nationality: e.nationality ?? "",
        bloodGroup: e.bloodGroup ?? "",
        workMode: e.workMode as (typeof WORK_MODES)[number],
        noticePeriodDays: e.noticePeriodDays,
      }}
      action={updatePersonalAction}
      trigger={
        <Button variant="outline" size="sm">
          <Pencil /> Edit
        </Button>
      }
    >
      {(f) => (
        <div className="grid gap-5 sm:grid-cols-3">
          <TextField control={f.control} name="firstName" label="First name" required />
          <TextField control={f.control} name="middleName" label="Middle name" />
          <TextField control={f.control} name="lastName" label="Last name" />
          <TextField control={f.control} name="workEmail" label="Work email" type="email" className="sm:col-span-2" />
          <TextField control={f.control} name="phone" label="Mobile" inputMode="tel" />
          <TextField control={f.control} name="personalEmail" label="Personal email" type="email" className="sm:col-span-2" />
          <TextField control={f.control} name="dateOfBirth" label="Date of birth" type="date" />
          <SelectField control={f.control} name="gender" label="Gender" options={opts(GENDERS)} allowNone="Not specified" />
          <SelectField control={f.control} name="maritalStatus" label="Marital status" options={opts(["single", "married", "divorced", "widowed"])} allowNone="Not specified" />
          <TextField control={f.control} name="nationality" label="Nationality" />
          <TextField control={f.control} name="bloodGroup" label="Blood group" />
          <SelectField control={f.control} name="workMode" label="Work mode" options={opts(WORK_MODES)} />
          <TextField control={f.control} name="noticePeriodDays" label="Notice period (days)" type="number" />
        </div>
      )}
    </FormDialog>
  );
}

const correctionForm = z.object({
  employeeId: z.uuid(),
  reason: z.string(),
  field: z.enum(["firstName", "lastName", "dateOfBirth", "pan", "aadhaar", "bankAccount", "bankIfsc", "uan"]),
  value: z.string().trim().min(1, "Enter the correct value"),
});

const CORRECTABLE = [
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "dateOfBirth", label: "Date of birth (YYYY-MM-DD)" },
  { value: "pan", label: "PAN" },
  { value: "aadhaar", label: "Aadhaar" },
  { value: "bankAccount", label: "Bank account number" },
  { value: "bankIfsc", label: "Bank IFSC" },
  { value: "uan", label: "UAN (PF)" },
];

function ChangeRequestDialog({ employeeId }: { employeeId: string }) {
  return (
    <FormDialog
      title="Request a correction"
      description="HR reviews corrections to your name, date of birth, identity and bank details before they apply."
      schema={correctionForm}
      defaultValues={{ employeeId, reason: "", field: "firstName", value: "" }}
      action={(v) => submitChangeRequestAction({ employeeId: v.employeeId, reason: v.reason, changes: { [v.field]: v.value } })}
      submitLabel="Send for review"
      successMessage="Sent to HR for review"
      trigger={<Button size="sm">Request correction</Button>}
    >
      {(f) => (
        <>
          <SelectField control={f.control} name="field" label="What needs correcting?" options={CORRECTABLE} />
          <TextField control={f.control} name="value" label="Correct value" autoComplete="off" />
          <TextareaField control={f.control} name="reason" label="Reason" rows={2} placeholder="e.g. Spelling differs from my PAN card" />
        </>
      )}
    </FormDialog>
  );
}

function RehireItem({ employeeId, today }: { employeeId: string; today: string }) {
  return (
    <FormDialog
      title="Rehire employee"
      description="Reopens the same profile with a new employment period. Previous history is preserved."
      schema={z.object({ employeeId: z.uuid(), joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(3, "Add a reason") })}
      defaultValues={{ employeeId, joiningDate: today, reason: "" }}
      action={rehireAction}
      submitLabel="Rehire"
      successMessage="Employee rehired"
      trigger={<DropdownMenuItem onSelect={(ev) => ev.preventDefault()}>Rehire…</DropdownMenuItem>}
    >
      {(f) => (
        <>
          <TextField control={f.control} name="joiningDate" label="New joining date" type="date" />
          <TextareaField control={f.control} name="reason" label="Reason" rows={2} />
        </>
      )}
    </FormDialog>
  );
}

function DeleteDraftItem({ employeeId, name }: { employeeId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <DropdownMenuItem variant="destructive" onSelect={(ev) => ev.preventDefault()}>
          Delete pre-joining record
        </DropdownMenuItem>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Use this only for records created by mistake. The record is removed from lists but kept in the audit trail.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteDraftEmployeeAction({ employeeId });
                if (res.ok) {
                  toast.success("Record deleted");
                  router.replace("/employees");
                } else toast.error(res.error.message);
              })
            }
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
