"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Download, FileUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ImportPreview } from "@/server/services/employees/import";
import { commitImportAction, previewImportAction } from "../actions";

export function ImportWizard({ columns, canCreateMissing }: { columns: { key: string; required: boolean }[]; canCreateMissing: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [createMissing, setCreateMissing] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const runPreview = (text: string, create: boolean) =>
    start(async () => {
      setError(null);
      const res = await previewImportAction({ csv: text, createMissing: create });
      if (res.ok) setPreview(res.data);
      else {
        setPreview(null);
        setError(res.error.message);
      }
    });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      setError("The file is larger than 2 MB. Split it into smaller files.");
      return;
    }
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    runPreview(text, createMissing);
  };

  const commit = () =>
    start(async () => {
      if (!csv) return;
      const res = await commitImportAction({ csv, createMissing });
      if (res.ok) {
        toast.success(`${res.data.imported} employees imported`);
        router.push("/employees?sort=joining&dir=desc");
      } else {
        setError(res.error.message);
        toast.error(res.error.message);
      }
    });

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">1. Prepare your file</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Required columns: {columns.filter((c) => c.required).map((c) => c.key).join(", ")}. Dates use YYYY-MM-DD. Managers are matched by employee code.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <a href="/api/employees/import-template" download>
              <Download /> Template
            </a>
          </Button>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">2. Upload and validate</h2>
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFile(e.dataTransfer.files[0]);
          }}
          className="mt-3 flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-sm text-muted-foreground transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {pending ? <Spinner /> : <FileUp className="size-5" />}
          {fileName ? <span className="font-medium text-foreground">{fileName}</span> : "Drop a CSV here or click to choose"}
        </button>
        <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        {canCreateMissing ? (
          <div className="mt-4 flex items-start gap-2">
            <Checkbox
              id="create-missing"
              checked={createMissing}
              onCheckedChange={(v) => {
                setCreateMissing(v === true);
                if (csv) runPreview(csv, v === true);
              }}
            />
            <Label htmlFor="create-missing" className="text-sm leading-snug font-normal">
              Create departments, designations and locations that do not exist yet
            </Label>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="mt-4 flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        ) : null}
      </section>

      {preview ? (
        <section className="rounded-xl border bg-card">
          <header className="flex flex-wrap items-center gap-3 border-b px-5 py-3.5">
            <h2 className="text-sm font-semibold">3. Review</h2>
            <span className="inline-flex items-center gap-1 text-sm text-success">
              <CheckCircle2 className="size-4" /> {preview.valid} ready
            </span>
            {preview.invalid ? (
              <span className="inline-flex items-center gap-1 text-sm text-danger">
                <AlertCircle className="size-4" /> {preview.invalid} with errors
              </span>
            ) : null}
            <Button className="ml-auto" size="sm" disabled={pending || preview.invalid > 0 || preview.valid === 0} onClick={commit}>
              {pending ? <Spinner /> : null}
              Import {preview.valid} employees
            </Button>
          </header>
          {preview.willCreate.departments.length + preview.willCreate.designations.length + preview.willCreate.locations.length ? (
            <p className="border-b px-5 py-3 text-sm text-muted-foreground">
              Will also create:{" "}
              {[
                ...preview.willCreate.departments.map((d) => `department “${d}”`),
                ...preview.willCreate.designations.map((d) => `designation “${d}”`),
                ...preview.willCreate.locations.map((d) => `location “${d}”`),
              ].join(", ")}
            </p>
          ) : null}
          <div className="max-h-[480px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Line</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...preview.rows].sort((a, b) => b.errors.length - a.errors.length || a.line - b.line).map((r) => (
                  <TableRow key={r.line}>
                    <TableCell className="tabular text-muted-foreground">{r.line}</TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-muted-foreground">{r.code ?? "auto"}</TableCell>
                    <TableCell>
                      {r.errors.length ? (
                        <ul className="space-y-0.5 text-sm text-danger">
                          {r.errors.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-sm text-success">Ready</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
      <p className="text-sm text-muted-foreground">
        After importing, invite people to sign in from{" "}
        <Link className="font-medium text-foreground underline-offset-4 hover:underline" href="/settings/users">
          Settings → Users
        </Link>
        .
      </p>
    </div>
  );
}
