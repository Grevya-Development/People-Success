"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Calculator, CheckCheck, FilePlus2, Lock, Send, Undo2, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { RunAction } from "@/server/services/payroll/runs";
import { LOCK_CONFIRMATION } from "@/lib/validation/payroll";
import {
  bankResponseAction,
  calculateRunAction,
  cancelRunAction,
  createAdjustmentRunAction,
  generateDisbursementAction,
  lockRunAction,
  publishPayslipsAction,
  submitRunAction,
  withdrawRunAction,
} from "../../actions";
import { ConfirmButton, useRunAction } from "../../_components/use-run-action";

export function RunActions({
  runId,
  status,
  actions,
  usesUnverifiedRules,
  employees,
}: {
  runId: string;
  status: string;
  actions: RunAction[];
  usesUnverifiedRules: boolean;
  employees: { employeeId: string; name: string; code: string }[];
}) {
  const has = (a: RunAction) => actions.includes(a);
  const { pending, run } = useRunAction();
  const [threshold, setThreshold] = useState("10");
  if (!actions.filter((a) => a !== "explain").length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {has("calculate") ? (
        <div className="flex items-center gap-1.5">
          <Label htmlFor="variance" className="sr-only">
            Variance threshold
          </Label>
          <Select value={threshold} onValueChange={setThreshold}>
            <SelectTrigger id="variance" size="sm" className="w-[8.5rem]" aria-label="Variance threshold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["5", "10", "15", "20", "25"].map((t) => (
                <SelectItem key={t} value={t}>
                  Flag ±{t}%
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant={status === "draft" ? "default" : "outline"}
            disabled={pending}
            onClick={() =>
              run(() => calculateRunAction({ runId, idempotencyKey: crypto.randomUUID(), varianceThresholdPct: Number(threshold) }), {
                success: (d) => (d.errors ? `Calculated ${d.employees} employees · ${d.errors} with errors` : `Calculated ${d.employees} employees`),
              })
            }
          >
            {pending ? <Spinner /> : <Calculator />}
            {status === "draft" ? "Calculate" : "Recalculate"}
          </Button>
        </div>
      ) : null}
      {has("submit") ? (
        <ConfirmButton
          trigger={
            <Button size="sm">
              <Send /> Submit for approval
            </Button>
          }
          title="Submit this run for approval?"
          description={
            <>
              <p>The results are fingerprinted (SHA-256) now. Approvers review them as they are; any change requires withdrawing and recalculating.</p>
              {usesUnverifiedRules ? <p className="text-warning">This run uses unverified statutory rule sets. Locking will need an explicit override.</p> : null}
            </>
          }
          confirmLabel="Submit"
          action={() => submitRunAction({ runId })}
          success="Submitted for approval"
        />
      ) : null}
      {has("withdraw") ? (
        <ConfirmButton
          trigger={
            <Button size="sm" variant="outline">
              <Undo2 /> Withdraw
            </Button>
          }
          title="Withdraw from approval?"
          description="The approval request is cancelled and the run returns to Calculated so you can correct and recalculate it."
          confirmLabel="Withdraw"
          action={() => withdrawRunAction({ runId })}
          success="Withdrawn"
        />
      ) : null}
      {has("lock") ? <LockDialog runId={runId} usesUnverifiedRules={usesUnverifiedRules} /> : null}
      {has("disburse") ? <DisburseDialog runId={runId} /> : null}
      {has("publish") ? (
        <ConfirmButton
          trigger={
            <Button size="sm">
              <CheckCheck /> Publish payslips
            </Button>
          }
          title="Publish payslips?"
          description="A PDF payslip is generated for each employee and they are notified (no amounts in the notification). Employees who already have a payslip for this run are skipped."
          confirmLabel="Publish"
          action={() => publishPayslipsAction({ runId })}
          success={(d) => (d.created ? `Published ${d.created} payslip${d.created === 1 ? "" : "s"}` : "All payslips were already published")}
        />
      ) : null}
      {has("adjust") ? <AdjustmentDialog runId={runId} employees={employees} /> : null}
      {has("cancel") ? (
        <ConfirmButton
          trigger={
            <Button size="sm" variant="ghost">
              <XCircle /> Cancel run
            </Button>
          }
          title="Cancel this run?"
          description="The run is kept for audit but can no longer be calculated or paid. A new run can then be started for the period."
          confirmLabel="Cancel run"
          destructive
          action={() => cancelRunAction({ runId })}
          success="Run cancelled"
        />
      ) : null}
    </div>
  );
}

function LockDialog({ runId, usesUnverifiedRules }: { runId: string; usesUnverifiedRules: boolean }) {
  const [open, setOpen] = useState(false);
  const [override, setOverride] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const { pending, run } = useRunAction();
  const blocked = usesUnverifiedRules && (!override || confirmation.trim() !== LOCK_CONFIRMATION);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setOverride(false);
          setConfirmation("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Lock /> Lock run
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lock this payroll run?</DialogTitle>
          <DialogDescription>
            Locking verifies the approved snapshot, freezes attendance for the period, posts loan recoveries and locks the period. Corrections afterwards need an adjustment run.
          </DialogDescription>
        </DialogHeader>
        {usesUnverifiedRules ? (
          <div className="space-y-3 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm">
            <p className="font-medium">This run used statutory rule sets that no qualified reviewer has verified.</p>
            <label className="flex items-start gap-2">
              <Checkbox checked={override} onCheckedChange={(v) => setOverride(v === true)} className="mt-0.5" />
              <span>I accept responsibility for locking with unverified rules. My name is recorded on the run.</span>
            </label>
            {override ? (
              <div className="space-y-1.5">
                <Label htmlFor="lock-confirm">
                  Type <span className="font-mono">{LOCK_CONFIRMATION}</span> to confirm
                </Label>
                <Input id="lock-confirm" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" />
              </div>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || blocked}
            onClick={async () => {
              const res = await run(() => lockRunAction({ runId, overrideUnverified: usesUnverifiedRules && override, confirmation: confirmation.trim() || undefined }), { success: "Run locked" });
              if (res.ok) setOpen(false);
            }}
          >
            {pending ? <Spinner /> : <Lock />}
            Lock run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DisburseDialog({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<"neft_bulk" | "generic_csv">("neft_bulk");
  const [result, setResult] = useState<{ created: boolean; count: number; skippedNoBank: string[]; alreadyIncluded: number } | null>(null);
  const { pending, run } = useRunAction();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setResult(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Banknote /> Bank transfer file
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate a bank transfer file</DialogTitle>
          <DialogDescription>
            One payment per employee with net pay above zero. Employees already in a file are never included again; failed payments are re-issued. Account numbers appear only inside the file.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <Label htmlFor="format">Format</Label>
          <Select value={format} onValueChange={(v) => setFormat(v as typeof format)}>
            <SelectTrigger id="format" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="neft_bulk">NEFT bulk upload (generic bank template)</SelectItem>
              <SelectItem value="generic_csv">Generic CSV</SelectItem>
            </SelectContent>
          </Select>
          {result ? (
            <div className="rounded-lg border p-3 text-sm">
              <p>{result.created ? `File created with ${result.count} payment${result.count === 1 ? "" : "s"}.` : "No new payments to include."}</p>
              {result.alreadyIncluded ? <p className="text-muted-foreground">{result.alreadyIncluded} already in an earlier file.</p> : null}
              {result.skippedNoBank.length ? <p className="text-warning">Missing bank details: {result.skippedNoBank.join(", ")}</p> : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button disabled={pending} onClick={() => run(() => generateDisbursementAction({ runId, format }), { onSuccess: setResult })}>
            {pending ? <Spinner /> : <Banknote />}
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustmentDialog({ runId, employees }: { runId: string; employees: { employeeId: string; name: string; code: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const { pending, run } = useRunAction();
  const shown = employees.filter((e) => `${e.name} ${e.code}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <FilePlus2 /> Adjustment run
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create an adjustment run</DialogTitle>
          <DialogDescription>Recalculates this period for the selected employees with current data and pays or recovers only the difference. The locked run is never changed.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Search employees" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search employees" />
          <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border">
            {shown.map((e) => (
              <li key={e.employeeId}>
                <label className="flex items-center gap-2 px-3 py-2 text-sm">
                  <Checkbox
                    checked={selected.has(e.employeeId)}
                    onCheckedChange={(v) =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (v === true) n.add(e.employeeId);
                        else n.delete(e.employeeId);
                        return n;
                      })
                    }
                  />
                  <span className="flex-1">{e.name}</span>
                  <span className="text-xs text-muted-foreground">{e.code}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="space-y-1.5">
            <Label htmlFor="adj-notes">Reason</Label>
            <Textarea id="adj-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || !selected.size}
            onClick={() => run(() => createAdjustmentRunAction({ parentRunId: runId, employeeIds: [...selected], notes }), { success: "Adjustment run created", onSuccess: (d) => router.push(`/payroll/runs/${d.runId}`) })}
          >
            {pending ? <Spinner /> : null}
            Create ({selected.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BankResponseDialog({ batchId }: { batchId: string }) {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState<string | null>(null);
  const [result, setResult] = useState<{ paid: number; failed: number; unchanged: number; errors: number; rows: { line: number; reference: string; outcome: string; message?: string }[] } | null>(null);
  const { pending, run } = useRunAction();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setCsv(null);
          setResult(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Upload /> Bank response
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply the bank response</DialogTitle>
          <DialogDescription>CSV with columns payment_reference, status (paid or failed), utr, failure_reason. Applying the same file again changes nothing.</DialogDescription>
        </DialogHeader>
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="Bank response CSV"
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setResult(null);
            setCsv(f ? await f.text() : null);
          }}
        />
        {result ? (
          <div className="space-y-1 rounded-lg border p-3 text-sm">
            <p>
              {result.paid} paid · {result.failed} failed · {result.unchanged} unchanged · {result.errors} errors
            </p>
            {result.rows
              .filter((r) => r.outcome === "error")
              .slice(0, 10)
              .map((r) => (
                <p key={r.line} className="text-danger">
                  Line {r.line}: {r.message}
                </p>
              ))}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button disabled={!csv || pending} onClick={() => run(() => bankResponseAction({ batchId, csv: csv! }), { onSuccess: setResult })}>
            {pending ? <Spinner /> : null}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
