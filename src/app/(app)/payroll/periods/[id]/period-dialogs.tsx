"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWatch, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";
import { FileUp, Plus, Trash2, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Spinner } from "@/components/ui/spinner";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, SwitchField, TextField, TextareaField, type Option } from "@/components/forms/fields";
import { ComboboxField } from "@/app/(app)/settings/_components/combobox-field";
import { fnfRunSchema, INPUT_KINDS, payrollInputSchema } from "@/lib/validation/payroll";
import { formatMoney, titleCase } from "@/lib/format";
import { createFnfRunAction, createInputAction, deleteInputAction, importInputsAction } from "../../actions";
import { ConfirmButton, useRunAction } from "../../_components/use-run-action";

type ComponentOption = { code: string; name: string; kind: string; calculation: string; isTaxable: boolean };
const DEDUCTION_KINDS = ["deduction", "recovery"];

export function AddInputDialog({ periodId, employees, components }: { periodId: string; employees: Option[]; components: ComponentOption[] }) {
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline">
          <Plus /> Add input
        </Button>
      }
      title="Add a one-off input"
      description="Bonuses, arrears, overtime, reimbursements, deductions and recoveries for this period only."
      schema={payrollInputSchema}
      defaultValues={{ periodId, employeeId: "", kind: "bonus", componentCode: "BONUS", amount: undefined, isTaxable: true, note: "" }}
      action={createInputAction}
      submitLabel="Add input"
      successMessage="Input added. Recalculate the run to include it."
    >
      {(form) => <InputFields form={form} employees={employees} components={components} />}
    </FormDialog>
  );
}

function InputFields({ form, employees, components }: { form: UseFormReturn<z.input<typeof payrollInputSchema>>; employees: Option[]; components: ComponentOption[] }) {
  const kind = useWatch({ control: form.control, name: "kind" });
  const deduction = DEDUCTION_KINDS.includes(kind);
  const options = components
    .filter((c) => c.calculation !== "statutory" && (deduction ? c.kind === "deduction" : c.kind === "earning" || c.kind === "reimbursement"))
    .map((c) => ({ value: c.code, label: `${c.name} (${c.code})` }));
  return (
    <>
      <ComboboxField control={form.control} name="employeeId" label="Employee" options={employees} placeholder="Choose an employee" />
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField
          control={form.control}
          name="kind"
          label="Type"
          required
          options={INPUT_KINDS.map((k) => ({ value: k, label: titleCase(k) }))}
        />
        <SelectField control={form.control} name="componentCode" label="Component" required options={options} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField control={form.control} name="amount" label="Amount (₹)" type="number" inputMode="decimal" required />
        {!deduction ? <SwitchField control={form.control} name="isTaxable" label="Taxable" description="Included in TDS projection" /> : null}
      </div>
      <TextareaField control={form.control} name="note" label="Note" />
    </>
  );
}

export function DeleteInputButton({ id, label }: { id: string; label: string }) {
  return (
    <ConfirmButton
      trigger={
        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${label}`}>
          <Trash2 />
        </Button>
      }
      title="Delete this input?"
      description={`${label} will be removed from this period. Recalculate the run afterwards.`}
      confirmLabel="Delete"
      destructive
      action={() => deleteInputAction({ id })}
      success="Input deleted"
    />
  );
}

type ImportResult = { committed: boolean; created: number; duplicates: number; invalid: number; rows: { line: number; employeeCode: string; componentCode: string; amount: number | null; errors: string[]; duplicate?: boolean }[] };

export function ImportInputsDialog({ periodId }: { periodId: string }) {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const { pending, run } = useRunAction();
  const reset = () => {
    setCsv(null);
    setFileName("");
    setResult(null);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <FileUp /> Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import inputs</DialogTitle>
          <DialogDescription>
            Columns: employee_code, kind, component_code, amount (rupees), taxable (yes/no), note, reference. Rows with the same reference are never imported twice.{" "}
            <a href="/api/payroll/inputs/template" className="font-medium text-brand hover:underline">
              Download template
            </a>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              setResult(null);
              if (!f) return setCsv(null);
              setFileName(f.name);
              setCsv(await f.text());
            }}
          />
          {result ? (
            <div className="space-y-2">
              <p className="text-sm">
                {result.committed
                  ? `Imported ${result.created} input${result.created === 1 ? "" : "s"}${result.duplicates ? `; ${result.duplicates} already imported` : ""}.`
                  : result.invalid
                    ? `${result.invalid} row${result.invalid === 1 ? " has" : "s have"} errors. Fix the file and try again.`
                    : `${result.rows.length} row${result.rows.length === 1 ? "" : "s"} ready to import.`}
              </p>
              <div className="max-h-64 overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Line</TableHead>
                      <TableHead>Employee</TableHead>
                      <TableHead>Component</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.rows.map((r) => (
                      <TableRow key={r.line}>
                        <TableCell className="tabular">{r.line}</TableCell>
                        <TableCell>{r.employeeCode}</TableCell>
                        <TableCell>{r.componentCode}</TableCell>
                        <TableCell className="text-right tabular">{r.amount == null ? "—" : formatMoney(r.amount)}</TableCell>
                        <TableCell className={r.errors.length ? "text-danger" : "text-muted-foreground"}>{r.errors.length ? r.errors.join("; ") : r.duplicate ? "Already imported" : "OK"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {result?.committed ? "Close" : "Cancel"}
          </Button>
          {!result?.committed ? (
            <Button
              disabled={!csv || pending}
              onClick={() =>
                run(() => importInputsAction({ periodId, csv: csv!, commit: !!result && result.invalid === 0 }), {
                  onSuccess: (d) => setResult(d),
                  success: (d) => (d.committed ? `Imported ${d.created} from ${fileName}` : ""),
                })
              }
            >
              {pending ? <Spinner /> : null}
              {result && result.invalid === 0 ? "Import" : "Validate"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FnfDialog({ periodId, candidates }: { periodId: string; candidates: Option[] }) {
  const router = useRouter();
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline">
          <UserMinus /> Full and final
        </Button>
      }
      title="Start a full and final settlement"
      description="Pays salary up to the last working day (unless already paid in this period's regular run) plus settlement items. It goes through the same approval as payroll."
      schema={fnfRunSchema}
      defaultValues={{ periodId, employeeId: "", leaveEncashmentDays: 0, encashmentDivisor: 30, noticePayDays: 0, noticeRecoveryDays: 0, includeGratuity: true }}
      action={createFnfRunAction}
      submitLabel="Create settlement run"
      successMessage="Settlement run created"
      onSuccess={(d) => router.push(`/payroll/runs/${d.runId}`)}
    >
      {(form) => (
        <>
          <ComboboxField control={form.control} name="employeeId" label="Employee" options={candidates} placeholder="Choose the exiting employee" emptyText="No exits without a settlement." />
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField control={form.control} name="leaveEncashmentDays" label="Leave encashment days" type="number" inputMode="decimal" description="From the leave balance" />
            <SelectField control={form.control} name="encashmentDivisor" label="Per-day basis" options={[{ value: "30", label: "Basic ÷ 30" }, { value: "26", label: "Basic ÷ 26" }]} />
            <TextField control={form.control} name="noticePayDays" label="Notice pay in lieu (days)" type="number" inputMode="decimal" description="Paid to the employee" />
            <TextField control={form.control} name="noticeRecoveryDays" label="Notice shortfall recovery (days)" type="number" inputMode="decimal" description="Recovered from the employee" />
          </div>
          <SwitchField control={form.control} name="includeGratuity" label="Include gratuity" description="Uses the gratuity rule set; requires the minimum years of service." />
        </>
      )}
    </FormDialog>
  );
}
