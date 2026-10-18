"use client";

import { useState, useTransition } from "react";
import { Fingerprint } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { importDeviceCsvAction } from "../actions";

const SAMPLE = "employee_code,occurred_at,kind,external_id,device_id\nEMP0001,2026-10-16T09:28:00+05:30,in,GATE1-000123,GATE-1";

/**
 * Import punches exported from a biometric / access device. Re-importing the
 * same file is safe: events are matched on their external id.
 */
export function DeviceImportDialog() {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await importDeviceCsvAction({ csv, source: "biometric" });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      const d = res.data;
      toast.success(
        `Imported ${d.inserted} punch(es)${d.duplicates ? `, ${d.duplicates} already imported` : ""}${d.unknownEmployees.length ? `, ${d.unknownEmployees.length} unknown employee code(s)` : ""}`,
      );
      setOpen(false);
      setCsv("");
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Fingerprint /> Import device punches
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import device punches</DialogTitle>
          <DialogDescription>
            Upload or paste a CSV exported from your attendance device. Punches are marked device-verified and affected days are recomputed. Re-importing the same rows does nothing.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <Field>
            <FieldLabel htmlFor="device-file">CSV file</FieldLabel>
            <input
              id="device-file"
              type="file"
              accept=".csv,text/csv"
              className="text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-2.5 file:py-1 file:text-sm"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setCsv(await f.text());
              }}
            />
          </Field>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="device-csv">Or paste rows</FieldLabel>
            <Textarea id="device-csv" rows={7} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={SAMPLE} className="font-mono text-xs" />
            <FieldDescription>
              Columns: employee_code, occurred_at (ISO 8601 with time zone), kind (in or out), external_id (unique per punch), device_id (optional).
            </FieldDescription>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !csv.trim()}>
            {pending ? <Spinner /> : null}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
