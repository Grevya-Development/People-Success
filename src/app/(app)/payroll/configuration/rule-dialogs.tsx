"use client";

import { useMemo, useState } from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";
import { FilePlus2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { RULE_KIND_LABELS, RULE_KINDS, validateRuleParameters } from "@/lib/payroll/params";
import { ruleSetVersionSchema } from "@/lib/validation/payroll";
import { createRuleSetVersionAction, markRuleSetVerifiedAction } from "../actions";
import { useRunAction } from "../_components/use-run-action";

export type RuleSetFormSource = {
  id: string;
  kind: string;
  jurisdiction: string;
  name: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  version: number;
  parameters: Record<string, unknown>;
  sourceReference: string | null;
  notes: string | null;
};

function JsonIssues({ kind, json }: { kind: string; json: string }) {
  const result = useMemo(() => {
    try {
      return validateRuleParameters(kind, JSON.parse(json));
    } catch {
      return { ok: false as const, issues: ["Not valid JSON"] };
    }
  }, [kind, json]);
  if (result.ok) return <p className="text-xs text-success">Parameters are valid for {RULE_KIND_LABELS[kind as keyof typeof RULE_KIND_LABELS] ?? kind}.</p>;
  return (
    <ul className="space-y-0.5 text-xs text-danger" aria-live="polite">
      {result.issues.slice(0, 8).map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

/** View parameters and save edits as a NEW version (versions are never changed in place). */
export function RuleSetVersionDialog({ source, mode }: { source?: RuleSetFormSource; mode: "edit" | "create" }) {
  return (
    <FormDialog
      wide
      trigger={
        mode === "edit" ? (
          <Button variant="ghost" size="sm">
            View / new version
          </Button>
        ) : (
          <Button size="sm">
            <FilePlus2 /> New rule set
          </Button>
        )
      }
      title={mode === "edit" ? `${source?.name} · v${source?.version}` : "New statutory rule set"}
      description="Saving creates a new, unverified version. Runs that already used a version keep it; draft runs pick up the new version when recalculated. Amounts are in paise; rates are percentages."
      schema={ruleSetVersionSchema}
      defaultValues={{
        baseId: source?.id,
        kind: (source?.kind as (typeof RULE_KINDS)[number]) ?? "pt",
        jurisdiction: source?.jurisdiction ?? "IN-",
        name: source?.name ?? "",
        effectiveFrom: source?.effectiveFrom ?? "",
        effectiveTo: source?.effectiveTo ?? "",
        parametersJson: source ? JSON.stringify(source.parameters, null, 2) : "{\n}",
        sourceReference: source?.sourceReference ?? "",
        notes: source?.notes ?? "",
      }}
      action={createRuleSetVersionAction}
      submitLabel="Save as new version"
      successMessage={(d) => `Saved as version ${d.version} (unverified)`}
    >
      {(form) => <RuleFields form={form} lockKind={mode === "edit"} />}
    </FormDialog>
  );
}

function RuleFields({ form, lockKind }: { form: UseFormReturn<z.output<typeof ruleSetVersionSchema>>; lockKind: boolean }) {
  const kind = useWatch({ control: form.control, name: "kind" });
  const json = useWatch({ control: form.control, name: "parametersJson" });
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField control={form.control} name="kind" label="Kind" required disabled={lockKind} options={RULE_KINDS.map((k) => ({ value: k, label: RULE_KIND_LABELS[k] }))} />
        <TextField control={form.control} name="jurisdiction" label="Jurisdiction" required disabled={lockKind} description='"IN" or a state, e.g. "IN-KA"' />
        <TextField control={form.control} name="name" label="Name" required />
        <TextField control={form.control} name="effectiveFrom" label="Effective from" type="date" required />
        <TextField control={form.control} name="effectiveTo" label="Effective until (exclusive)" type="date" />
      </div>
      <div className="space-y-1.5">
        <TextareaField control={form.control} name="parametersJson" label="Parameters (JSON)" rows={16} className="[&_textarea]:min-h-72 [&_textarea]:font-mono [&_textarea]:text-xs" />
        <JsonIssues kind={kind} json={String(json ?? "")} />
      </div>
      <TextField control={form.control} name="sourceReference" label="Source (statute / notification)" required />
      <TextareaField control={form.control} name="notes" label="Notes" />
    </>
  );
}

export function VerifyRuleSetDialog({ id, name, version }: { id: string; name: string; version: number }) {
  const [open, setOpen] = useState(false);
  const [attest, setAttest] = useState(false);
  const { pending, run } = useRunAction();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setAttest(false);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ShieldCheck /> Mark verified
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Verify {name} v{version}?
          </DialogTitle>
          <DialogDescription>Your name and the time are recorded on this version. Runs using verified rule sets can be locked without an override.</DialogDescription>
        </DialogHeader>
        <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
          <Checkbox checked={attest} onCheckedChange={(v) => setAttest(v === true)} className="mt-0.5" />
          <span>I confirm a qualified payroll professional has checked every parameter in this version against the current statute, rules and notifications.</span>
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!attest || pending}
            onClick={async () => {
              const res = await run(() => markRuleSetVerifiedAction({ id, attest: true }), { success: "Marked verified" });
              if (res.ok) setOpen(false);
            }}
          >
            {pending ? <Spinner /> : <ShieldCheck />}
            Mark verified
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
