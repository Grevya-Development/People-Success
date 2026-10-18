"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { FormError } from "@/components/forms/fields";
import { useRunAction } from "@/components/documents/use-run-action";
import { COVERAGE_LABELS, type CoverageOption } from "@/lib/validation/expenses";
import { enrollBenefitAction, waiveBenefitAction } from "../actions";

type Dependent = { id: string; name: string; relationship: string };

export function EnrollDialog({
  planId,
  planName,
  coverageOptions,
  dependents,
  current,
}: {
  planId: string;
  planName: string;
  coverageOptions: CoverageOption[];
  dependents: Dependent[];
  current: { status: string; coverage: string; dependentIds: string[] } | null;
}) {
  const id = useId();
  const enrolled = current?.status === "enrolled";
  const [open, setOpen] = useState(false);
  const [coverage, setCoverage] = useState<string>(enrolled ? current!.coverage : coverageOptions[0]);
  const [selected, setSelected] = useState<string[]>(enrolled ? current!.dependentIds : []);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    start(async () => {
      const r = await enrollBenefitAction({ planId, coverage: coverage as CoverageOption, dependentIds: coverage === "self" ? [] : selected });
      if (r.ok) {
        toast.success(r.data.changed ? `Enrollment saved for ${planName}` : "No changes");
        setOpen(false);
      } else setError(r.error.message);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={enrolled ? "outline" : "default"}>
          {enrolled ? "Change" : "Enroll"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{enrolled ? `Change ${planName}` : `Enroll in ${planName}`}</DialogTitle>
            <DialogDescription>Changes take effect today. Your previous choice is kept in your history.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-5">
            <FormError message={error} />
            <FieldSet>
              <FieldLegend variant="label">Coverage</FieldLegend>
              <RadioGroup value={coverage} onValueChange={setCoverage}>
                {coverageOptions.map((o) => (
                  <Field key={o} orientation="horizontal">
                    <RadioGroupItem value={o} id={`${id}-${o}`} />
                    <FieldLabel htmlFor={`${id}-${o}`} className="font-normal">
                      {COVERAGE_LABELS[o] ?? o}
                    </FieldLabel>
                  </Field>
                ))}
              </RadioGroup>
            </FieldSet>
            {coverage !== "self" ? (
              <FieldSet>
                <FieldLegend variant="label">Dependents covered</FieldLegend>
                {dependents.length ? (
                  dependents.map((d) => (
                    <Field key={d.id} orientation="horizontal">
                      <Checkbox
                        id={`${id}-d-${d.id}`}
                        checked={selected.includes(d.id)}
                        onCheckedChange={(on) => setSelected((s) => (on ? [...s, d.id] : s.filter((x) => x !== d.id)))}
                      />
                      <FieldLabel htmlFor={`${id}-d-${d.id}`} className="font-normal">
                        {d.name} <span className="text-muted-foreground">· {d.relationship}</span>
                      </FieldLabel>
                    </Field>
                  ))
                ) : (
                  <FieldDescription>No dependents on your profile yet. Add them from your employee profile first.</FieldDescription>
                )}
              </FieldSet>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null} {enrolled ? "Save change" : "Enroll"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WaiveButton({ planId, planName }: { planId: string; planName: string }) {
  const { pending, run } = useRunAction();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => waiveBenefitAction({ planId }), { success: `You waived ${planName}` })}>
      {pending ? <Spinner /> : null} Waive
    </Button>
  );
}
