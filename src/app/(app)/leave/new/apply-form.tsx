"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { z } from "zod";
import { useWatch } from "react-hook-form";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { FormError, SelectField, TextField, TextareaField, type Option } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { ComboboxField } from "@/app/(app)/settings/_components/combobox-field";
import { leaveApplySchema } from "@/lib/validation/time";
import { formatDate } from "@/lib/format";
import { applyLeaveAction, previewLeaveAction } from "../actions";
import { daysLabel } from "../_components/tones";

type Values = z.output<typeof leaveApplySchema>;
type Preview = Extract<Awaited<ReturnType<typeof previewLeaveAction>>, { ok: true }>["data"];

const KIND_LABEL: Record<string, string> = { leave: "Leave", weekly_off: "Weekly off", holiday: "Holiday", sandwich: "Counted (sandwich rule)" };

export function ApplyLeaveForm({
  types,
  employees,
  selfEmployeeId,
  today,
}: {
  types: (Option & { allowHalfDay: boolean; isPaid: boolean })[];
  employees: Option[] | null;
  selfEmployeeId: string | null;
  today: string;
}) {
  const router = useRouter();
  const { form, submit, pending } = useActionForm({
    schema: leaveApplySchema,
    defaultValues: {
      employeeId: selfEmployeeId ?? null,
      leaveTypeId: types[0]?.value ?? "",
      startDate: today,
      endDate: today,
      startSession: "full",
      endSession: "full",
      reason: null,
      documentId: null,
    } as Values,
    action: applyLeaveAction,
    successMessage: (d) => (d.status === "approved" ? "Leave recorded" : "Leave request sent for approval"),
    onSuccess: (d) => router.push(`/leave/requests/${d.id}`),
  });
  const c = form.control;
  const [employeeId, leaveTypeId, startDate, endDate, startSession, endSession] = useWatch({
    control: c,
    name: ["employeeId", "leaveTypeId", "startDate", "endDate", "startSession", "endSession"],
  });
  const single = startDate === endDate;
  const type = types.find((t) => t.value === leaveTypeId);
  const onBehalf = !!employeeId && employeeId !== selfEmployeeId;

  // Keep the end date and sessions consistent with the start.
  useEffect(() => {
    if (startDate && endDate && endDate < startDate) form.setValue("endDate", startDate);
  }, [startDate, endDate, form]);
  useEffect(() => {
    if (single && endSession !== startSession) form.setValue("endSession", startSession);
    if (!single && startSession === "first_half") form.setValue("startSession", "full");
    if (!single && endSession === "second_half") form.setValue("endSession", "full");
    if (type && !type.allowHalfDay) {
      if (startSession !== "full") form.setValue("startSession", "full");
      if (endSession !== "full") form.setValue("endSession", "full");
    }
  }, [single, startSession, endSession, type, form]);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (!leaveTypeId || !startDate || !endDate || endDate < startDate) return;
    const n = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await previewLeaveAction({ employeeId: employeeId ?? null, leaveTypeId, startDate, endDate, startSession, endSession: single ? startSession : endSession });
      if (n !== seq.current) return;
      setLoading(false);
      if (res.ok) {
        setPreview(res.data);
        setPreviewError(null);
      } else {
        setPreview(null);
        setPreviewError(res.error.message);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [employeeId, leaveTypeId, startDate, endDate, startSession, endSession, single]);

  const halfOptions = (which: "start" | "end" | "single") =>
    which === "single"
      ? [
          { value: "full", label: "Full day" },
          { value: "first_half", label: "First half" },
          { value: "second_half", label: "Second half" },
        ]
      : which === "start"
        ? [
            { value: "full", label: "Full day" },
            { value: "second_half", label: "From the second half" },
          ]
        : [
            { value: "full", label: "Full day" },
            { value: "first_half", label: "Until the first half" },
          ];

  const blocking = preview?.errors ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <form onSubmit={submit} noValidate className="rounded-xl border bg-card p-5">
        <FieldGroup>
          <FormError message={form.formState.errors.root?.message} />
          {employees ? (
            <ComboboxField
              control={c}
              name="employeeId"
              label="Employee"
              options={employees}
              placeholder="Choose an employee"
              description={onBehalf ? "Recorded by HR: approved immediately, no approval step." : "Applying for yourself goes to your manager for approval."}
            />
          ) : null}
          <SelectField control={c} name="leaveTypeId" label="Leave type" options={types} required />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField control={c} name="startDate" label="From" type="date" required />
            <TextField control={c} name="endDate" label="To" type="date" required />
          </div>
          {type?.allowHalfDay ? (
            single ? (
              <SelectField control={c} name="startSession" label="Session" options={halfOptions("single")} />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField control={c} name="startSession" label="First day" options={halfOptions("start")} />
                <SelectField control={c} name="endSession" label="Last day" options={halfOptions("end")} />
              </div>
            )
          ) : null}
          <TextareaField control={c} name="reason" label="Reason" rows={3} placeholder="Optional, visible to your approver" />
          {preview?.documentRequired ? (
            preview.documents.length ? (
              <SelectField
                control={c}
                name="documentId"
                label="Supporting document"
                required
                options={preview.documents.map((d) => ({ value: d.id, label: d.title }))}
                description="Required for this leave length."
              />
            ) : (
              <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
                This leave needs a supporting document. Upload it under <Link href="/documents?tab=mine" className="underline">My documents</Link> first, then come back.
              </p>
            )
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" asChild>
              <Link href="/leave">Cancel</Link>
            </Button>
            <Button type="submit" disabled={pending || blocking.length > 0 || (preview?.days ?? 0) <= 0}>
              {pending ? <Spinner /> : null}
              {onBehalf ? "Record leave" : "Send for approval"}
            </Button>
          </div>
        </FieldGroup>
      </form>

      <aside className="h-fit rounded-xl border bg-card p-5" aria-live="polite">
        <h2 className="text-sm font-semibold">Summary</h2>
        {!preview && !previewError ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-4 w-40" />
          </div>
        ) : previewError ? (
          <p className="mt-3 text-sm text-danger">{previewError}</p>
        ) : preview ? (
          <div className={cn("mt-3 space-y-4 transition-opacity", loading && "opacity-60")}>
            <div>
              <p className="text-3xl leading-none font-semibold tracking-tight tabular">{preview.days}</p>
              <p className="mt-1 text-xs text-muted-foreground">{preview.days === 1 ? "day" : "days"} of leave</p>
            </div>
            {preview.tracksBalance ? (
              <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Balance</dt>
                <dd className="text-right tabular">{preview.balance}</dd>
                <dt className="text-muted-foreground">Pending</dt>
                <dd className="text-right tabular">{preview.pending}</dd>
                <dt className="text-muted-foreground">Available</dt>
                <dd className="text-right tabular">{preview.available}</dd>
                <dt className="font-medium">After this</dt>
                <dd className={cn("text-right font-medium tabular", (preview.after ?? 0) < 0 && "text-danger")}>{preview.after}</dd>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Unpaid leave: no balance is used; payroll treats these days as loss of pay.</p>
            )}
            {blocking.length ? (
              <ul className="space-y-1.5">
                {blocking.map((e, i) => (
                  <li key={i} className="flex gap-2 text-sm text-danger">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    {e.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-success">
                <CheckCircle2 className="size-3.5" /> Ready to submit
              </p>
            )}
            {preview.breakdown.length > 1 || preview.breakdown.some((d) => d.kind !== "leave") ? (
              <ul className="max-h-56 space-y-1 overflow-y-auto border-t pt-3 text-xs">
                {preview.breakdown.map((d) => (
                  <li key={d.date} className="flex justify-between gap-2">
                    <span className="tabular">{formatDate(d.date, "EEE dd MMM")}</span>
                    <span className={cn("text-muted-foreground", d.days > 0 && "text-foreground")}>
                      {KIND_LABEL[d.kind]}
                      {d.days > 0 ? ` · ${daysLabel(d.days)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {preview.policy ? (
              <p className="text-[11.5px] text-muted-foreground">
                Policy: {preview.policy.name} (v{preview.policy.version})
              </p>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
