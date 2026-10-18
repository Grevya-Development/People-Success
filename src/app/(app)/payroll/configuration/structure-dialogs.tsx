"use client";

import { useState } from "react";
import { useFieldArray, useWatch, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";
import { Pencil, Plus, Trash2, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, SwitchField, TextField, TextareaField, type Option } from "@/components/forms/fields";
import { ComboboxField } from "@/app/(app)/settings/_components/combobox-field";
import { assignStructureSchema, STRUCTURE_CALCS, structureSchema } from "@/lib/validation/payroll";
import { formatMoney, todayIn } from "@/lib/format";
import { CALC_LABEL } from "../_components/labels";
import { assignStructureAction, previewStructureAction, saveStructureAction } from "../actions";
import { useRunAction } from "../_components/use-run-action";

type Values = z.input<typeof structureSchema>;
type ComponentOption = { code: string; name: string; kind: string };
type Preview = Extract<Awaited<ReturnType<typeof previewStructureAction>>, { ok: true }>["data"];



export function StructureDialog({ values, components }: { values?: Values & { id: string }; components: ComponentOption[] }) {
  const editing = !!values?.id;
  return (
    <FormDialog
      wide
      trigger={
        editing ? (
          <Button variant="ghost" size="sm" aria-label={`Edit ${values?.name}`}>
            <Pencil /> Edit
          </Button>
        ) : (
          <Button size="sm">
            <Plus /> New structure
          </Button>
        )
      }
      title={editing ? `Edit ${values?.name}` : "New salary structure"}
      description="Lines resolve in order: fixed and % of CTC, then % of basic, employer PF inside CTC, % of gross, and finally the balancing line."
      schema={structureSchema}
      defaultValues={
        values ?? {
          name: "",
          description: "",
          isDefault: false,
          isActive: true,
          lines: [
            { componentCode: "BASIC", calculation: "percent_of_ctc", value: 50 },
            { componentCode: "HRA", calculation: "percent_of_basic", value: 40 },
            { componentCode: "SPECIAL", calculation: "balancing", value: null },
          ],
        }
      }
      action={saveStructureAction}
      successMessage={editing ? "Structure saved" : "Structure created"}
    >
      {(form) => <StructureFields form={form} components={components} />}
    </FormDialog>
  );
}

function StructureFields({ form, components }: { form: UseFormReturn<Values>; components: ComponentOption[] }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const lines = useWatch({ control: form.control, name: "lines" });
  const [ctc, setCtc] = useState("1200000");
  const [preview, setPreview] = useState<Preview | null>(null);
  const { pending, run } = useRunAction();
  const options: Option[] = components.filter((c) => ["earning", "reimbursement", "employer_contribution"].includes(c.kind)).map((c) => ({ value: c.code, label: `${c.name} (${c.code})` }));
  const lineErrors = form.formState.errors.lines;
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField control={form.control} name="name" label="Name" required />
        <div className="flex flex-col justify-end gap-3">
          <SwitchField control={form.control} name="isDefault" label="Default structure" description="Used when an employee has none assigned" />
        </div>
      </div>
      <TextareaField control={form.control} name="description" label="Description" />
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Lines</legend>
        {fields.map((f, i) => {
          const calc = lines?.[i]?.calculation;
          return (
            <div key={f.id} className="grid grid-cols-[1fr_1fr_7rem_auto] items-end gap-2">
              <SelectField control={form.control} name={`lines.${i}.componentCode`} label={i === 0 ? "Component" : ""} options={options} />
              <SelectField control={form.control} name={`lines.${i}.calculation`} label={i === 0 ? "Calculation" : ""} options={STRUCTURE_CALCS.map((k) => ({ value: k, label: CALC_LABEL[k] }))} />
              {calc === "balancing" ? (
                <p className="pb-2 text-xs text-muted-foreground">Rest of CTC</p>
              ) : (
                <TextField control={form.control} name={`lines.${i}.value`} label={i === 0 ? "Value" : ""} type="number" inputMode="decimal" />
              )}
              <Button type="button" variant="ghost" size="icon" aria-label="Remove line" onClick={() => remove(i)} disabled={fields.length === 1}>
                <Trash2 />
              </Button>
            </div>
          );
        })}
        {typeof lineErrors?.message === "string" ? <p className="text-sm text-danger">{lineErrors.message}</p> : null}
        <Button type="button" variant="outline" size="sm" onClick={() => append({ componentCode: "", calculation: "fixed", value: 0 })}>
          <Plus /> Add line
        </Button>
      </fieldset>
      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="sample-ctc">Preview for annual CTC (₹)</Label>
            <Input id="sample-ctc" type="number" inputMode="decimal" value={ctc} onChange={(e) => setCtc(e.target.value)} className="w-44" />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() => previewStructureAction({ annualCtc: Number(ctc), lines: form.getValues("lines") ?? [] }), { onSuccess: setPreview })
            }
          >
            {pending ? <Spinner /> : null}
            Preview breakdown
          </Button>
        </div>
        {preview ? (
          preview.ok ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Component</TableHead>
                  <TableHead className="text-right">Monthly</TableHead>
                  <TableHead className="text-right">Annual</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.lines.map((l) => (
                  <TableRow key={l.code}>
                    <TableCell>
                      {l.name}
                      <span className="block text-xs text-muted-foreground">{l.basis}</span>
                    </TableCell>
                    <TableCell className="text-right tabular">{formatMoney(l.monthly)}</TableCell>
                    <TableCell className="text-right tabular">{formatMoney(l.annual)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="text-muted-foreground">Employer PF inside CTC</TableCell>
                  <TableCell className="text-right tabular">{formatMoney(preview.employerPfMonthly)}</TableCell>
                  <TableCell className="text-right tabular">{formatMoney(preview.employerPfMonthly * 12)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Monthly gross</TableCell>
                  <TableCell className="text-right font-medium tabular">{formatMoney(preview.grossMonthly)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          ) : (
            <ul className="space-y-1 text-sm text-danger">
              {preview.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )
        ) : null}
        {preview?.ok && preview.messages.length ? <p className="text-xs text-warning">{preview.messages.join(" ")}</p> : null}
      </div>
      <SwitchField control={form.control} name="isActive" label="Active" />
    </>
  );
}

export function AssignStructureDialog({ employees, structures }: { employees: Option[]; structures: Option[] }) {
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline">
          <UserCheck /> Assign to employee
        </Button>
      }
      title="Assign a salary structure"
      description="Updates the employee's current compensation. If payroll has already been locked on it, a new compensation record with the same CTC starts on the date you choose (after the last locked period)."
      schema={assignStructureSchema}
      defaultValues={{ employeeId: "", structureId: structures[0]?.value ?? "", effectiveFrom: todayIn() }}
      action={assignStructureAction}
      submitLabel="Assign"
      successMessage={(d) => (d.mode === "new_record" ? "Assigned from the chosen date (new compensation record)" : d.mode === "updated" ? "Structure assigned" : "Already assigned")}
    >
      {(form) => (
        <>
          <ComboboxField control={form.control} name="employeeId" label="Employee" options={employees} />
          <SelectField control={form.control} name="structureId" label="Structure" options={structures} required />
          <TextField control={form.control} name="effectiveFrom" label="Effective from" type="date" description="Used only when a locked payroll already used the current record." />
        </>
      )}
    </FormDialog>
  );
}

