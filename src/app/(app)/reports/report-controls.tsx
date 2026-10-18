"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookmarkPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, TextField } from "@/components/forms/fields";
import { deleteSavedReportAction, saveReportAction } from "./actions";

type Option = { value: string; label: string };
const ALL = "__all__";

export function ReportFilters({ usesDateRange, departments, locations }: { usesDateRange: boolean; departments: Option[]; locations: Option[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const push = (patch: Record<string, string | null>) =>
    start(() => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (!v || v === ALL) next.delete(k);
        else next.set(k, v);
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  return (
    <div className={`mb-4 flex flex-wrap items-end gap-3 ${pending ? "opacity-60" : ""}`}>
      {usesDateRange ? (
        <>
          <div className="space-y-1">
            <Label htmlFor="r-from" className="text-xs">From</Label>
            <Input id="r-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} onBlur={() => push({ from })} className="h-8 w-40" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-to" className="text-xs">To</Label>
            <Input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} onBlur={() => push({ to })} className="h-8 w-40" />
          </div>
        </>
      ) : null}
      <Select value={params.get("departmentId") ?? ALL} onValueChange={(v) => push({ departmentId: v })}>
        <SelectTrigger size="sm" className="w-48" aria-label="Department">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All departments</SelectItem>
          {departments.map((d) => (
            <SelectItem key={d.value} value={d.value}>
              {d.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={params.get("locationId") ?? ALL} onValueChange={(v) => push({ locationId: v })}>
        <SelectTrigger size="sm" className="w-44" aria-label="Location">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All locations</SelectItem>
          {locations.map((l) => (
            <SelectItem key={l.value} value={l.value}>
              {l.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const saveForm = z.object({
  name: z.string().trim().min(2, "Name the report"),
  rangeDays: z.coerce.number().int().min(1).max(366),
  schedule: z.enum(["none", "daily", "weekly", "monthly"]),
  emailMe: z.enum(["yes", "no"]),
});

export function SaveReportButton({ reportKey, canSchedule, defaultName, selfId }: { reportKey: string; canSchedule: boolean; defaultName: string; selfId: string }) {
  const params = useSearchParams();
  return (
    <FormDialog
      title="Save report"
      description={canSchedule ? "Scheduled reports run with your current permissions at 08:00 IST and email you a link (never the data)." : "Save these filters to reopen the report quickly."}
      schema={saveForm}
      defaultValues={{ name: defaultName, rangeDays: 30, schedule: "none", emailMe: "yes" }}
      action={(v) =>
        saveReportAction({
          name: v.name,
          reportKey,
          filters: { rangeDays: v.rangeDays, departmentId: params.get("departmentId"), locationId: params.get("locationId") },
          schedule: canSchedule ? (v.schedule as "none" | "daily" | "weekly" | "monthly") : "none",
          recipientUserIds: v.schedule !== "none" && v.emailMe === "yes" ? [selfId] : [],
        })
      }
      successMessage="Report saved"
      trigger={
        <Button size="sm">
          <BookmarkPlus /> Save
        </Button>
      }
    >
      {(f) => (
        <>
          <TextField control={f.control} name="name" label="Name" required />
          <TextField control={f.control} name="rangeDays" label="Look back (days)" type="number" description="Each run covers this many days up to the run date." />
          {canSchedule ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <SelectField
                control={f.control}
                name="schedule"
                label="Schedule"
                options={[
                  { value: "none", label: "Not scheduled" },
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                  { value: "monthly", label: "Monthly" },
                ]}
              />
              <SelectField control={f.control} name="emailMe" label="Email me" options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />
            </div>
          ) : null}
        </>
      )}
    </FormDialog>
  );
}

export function DeleteSavedReport({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label="Delete saved report"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await deleteSavedReportAction({ id });
          if (res.ok) toast.success("Deleted");
          else toast.error(res.error.message);
        })
      }
    >
      <Trash2 />
    </Button>
  );
}
