"use client";

import { useState, useTransition } from "react";
import { History, Pencil, Plus, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, TextField, TextareaField, type Option } from "@/components/forms/fields";
import { ComboboxField } from "@/app/(app)/settings/_components/combobox-field";
import { GOAL_KINDS, GOAL_STATUSES, GOAL_VISIBILITIES, goalCheckinSchema, goalSchema } from "@/lib/validation/talent";
import { formatDateTime, titleCase } from "@/lib/format";
import { checkInGoalAction, goalHistoryAction, saveGoalAction } from "../actions";

const KIND_LABELS: Record<(typeof GOAL_KINDS)[number], string> = { goal: "Goal", okr: "OKR / key result", kpi: "KPI" };

export type GoalFormValues = {
  id?: string | null;
  employeeId: string | null;
  departmentId?: string | null;
  cycleId: string | null;
  parentGoalId: string | null;
  kind: (typeof GOAL_KINDS)[number];
  title: string;
  description: string | null;
  metricUnit: string | null;
  startValue: number | null;
  targetValue: number | null;
  weight: number;
  dueOn: string | null;
  visibility: (typeof GOAL_VISIBILITIES)[number];
};

/**
 * Create or edit a goal. `mode`:
 * - "self": the signed-in employee's own goal
 * - "report": a manager setting a goal for someone in their team
 * - "company": HR company / department goal (no owner)
 */
export function GoalDialog({
  mode,
  employeeId,
  values,
  cycles,
  parents,
  employees,
  departments,
  trigger,
}: {
  mode: "self" | "report" | "company";
  employeeId?: string | null;
  values?: GoalFormValues;
  cycles: Option[];
  parents: Option[];
  employees?: Option[];
  departments?: Option[];
  trigger?: React.ReactNode;
}) {
  const editing = !!values?.id;
  const defaults: GoalFormValues = values ?? {
    employeeId: mode === "company" ? null : (employeeId ?? null),
    departmentId: null,
    cycleId: cycles[0]?.value ?? null,
    parentGoalId: null,
    kind: "goal",
    title: "",
    description: null,
    metricUnit: null,
    startValue: null,
    targetValue: null,
    weight: 0,
    dueOn: null,
    visibility: mode === "company" ? "company" : "private",
  };
  return (
    <FormDialog
      wide
      trigger={
        trigger ??
        (editing ? (
          <Button variant="ghost" size="sm" aria-label={`Edit ${values?.title}`}>
            <Pencil />
          </Button>
        ) : (
          <Button size="sm" variant={mode === "self" ? "default" : "outline"}>
            <Plus /> {mode === "company" ? "Company goal" : mode === "report" ? "Goal for a report" : "New goal"}
          </Button>
        ))
      }
      title={editing ? "Edit goal" : mode === "company" ? "New company or department goal" : "New goal"}
      description="Weights across one person's goals in a cycle can total at most 100%. Key results align to a parent goal."
      schema={goalSchema}
      defaultValues={defaults as never}
      action={saveGoalAction}
      submitLabel={editing ? "Save goal" : "Create goal"}
      successMessage={editing ? "Goal updated" : "Goal created"}
    >
      {(form) => {
        const c = form.control;
        return (
          <>
            {mode === "report" && !editing ? <ComboboxField control={c} name="employeeId" label="Employee" options={employees ?? []} placeholder="Choose a report" /> : null}
            {mode === "company" && !editing ? <SelectField control={c} name="departmentId" label="Department" options={departments ?? []} allowNone="Whole company" /> : null}
            <TextField control={c} name="title" label="Title" required placeholder="Reduce invoice processing time" />
            <TextareaField control={c} name="description" label="Description" rows={3} />
            <div className="grid gap-5 sm:grid-cols-2">
              <SelectField control={c} name="kind" label="Type" options={GOAL_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))} />
              <SelectField control={c} name="cycleId" label="Review cycle" options={cycles} allowNone="Not linked to a cycle" />
            </div>
            <ComboboxField control={c} name="parentGoalId" label="Aligns to" options={parents.filter((p) => p.value !== values?.id)} placeholder="No parent goal" description="Link a key result to its objective, or your goal to a team or company goal." />
            <div className="grid gap-5 sm:grid-cols-3">
              <TextField control={c} name="startValue" label="Start value" type="number" inputMode="decimal" />
              <TextField control={c} name="targetValue" label="Target value" type="number" inputMode="decimal" />
              <TextField control={c} name="metricUnit" label="Unit" placeholder="%, ₹, days" />
            </div>
            <div className="grid gap-5 sm:grid-cols-3">
              {mode !== "company" ? <TextField control={c} name="weight" label="Weight (%)" type="number" inputMode="numeric" /> : null}
              <TextField control={c} name="dueOn" label="Due on" type="date" />
              {mode !== "company" ? (
                <SelectField
                  control={c}
                  name="visibility"
                  label="Visibility"
                  options={[
                    { value: "private", label: "Private (me, manager, HR)" },
                    { value: "team", label: "My team" },
                    { value: "company", label: "Everyone" },
                  ]}
                />
              ) : null}
            </div>
          </>
        );
      }}
    </FormDialog>
  );
}

export function CheckinDialog({ goal }: { goal: { id: string; title: string; metricUnit: string | null; targetValue: number | null; currentValue: number | null; progressPercent: number; status: string } }) {
  const measurable = goal.targetValue != null;
  return (
    <FormDialog
      trigger={
        <Button variant="ghost" size="sm" aria-label={`Check in on ${goal.title}`}>
          <TrendingUp /> Check in
        </Button>
      }
      title="Goal check-in"
      description={goal.title}
      schema={goalCheckinSchema}
      defaultValues={{ goalId: goal.id, value: goal.currentValue, progressPercent: measurable ? null : goal.progressPercent, status: goal.status as (typeof GOAL_STATUSES)[number], note: null } as never}
      action={checkInGoalAction}
      submitLabel="Save check-in"
      successMessage="Check-in saved"
    >
      {(form) => (
        <>
          {measurable ? (
            <TextField control={form.control} name="value" label={`Current value${goal.metricUnit ? ` (${goal.metricUnit})` : ""}`} type="number" inputMode="decimal" description={`Target ${goal.targetValue}${goal.metricUnit ?? ""}. Progress is calculated from the value.`} />
          ) : (
            <TextField control={form.control} name="progressPercent" label="Progress (%)" type="number" inputMode="numeric" />
          )}
          <SelectField control={form.control} name="status" label="Status" options={GOAL_STATUSES.filter((s) => s !== "draft").map((s) => ({ value: s, label: titleCase(s) }))} />
          <TextareaField control={form.control} name="note" label="Note" rows={3} placeholder="What moved, what is blocked?" />
        </>
      )}
    </FormDialog>
  );
}

type HistoryRow = { id: string; value: number | null; progressPercent: number; note: string | null; createdAt: string; by: string | null };

export function GoalHistoryButton({ goalId, title }: { goalId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o)
          start(async () => {
            const res = await goalHistoryAction({ id: goalId });
            if (res.ok) setRows(res.data);
            else setError(res.error.message);
          });
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Check-in history for ${title}`}>
          <History />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Check-in history</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        {pending ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : rows && rows.length ? (
          <ul className="max-h-[60vh] divide-y overflow-y-auto">
            {rows.map((r) => (
              <li key={r.id} className="py-2.5 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="font-medium tabular">{r.progressPercent}%{r.value != null ? ` · ${r.value}` : ""}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</span>
                </div>
                {r.note ? <p className="mt-0.5 text-muted-foreground">{r.note}</p> : null}
                {r.by ? <p className="text-xs text-muted-foreground">by {r.by}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-4 text-sm text-muted-foreground">No check-ins yet.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
