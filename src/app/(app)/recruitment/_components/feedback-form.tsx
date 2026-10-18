"use client";

import { useFieldArray } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { FormError, SelectField, TextareaField } from "@/components/forms/fields";
import { useActionForm } from "@/components/forms/use-action-form";
import { feedbackSchema, RECOMMENDATIONS, RECOMMENDATION_LABELS, type FeedbackInput } from "@/lib/validation/recruitment";
import type { ScorecardCriterion } from "@/server/db/schema/recruitment";
import { submitFeedbackAction } from "../actions";

const RATINGS = [
  { value: "1", label: "1 · Well below the bar" },
  { value: "2", label: "2 · Below the bar" },
  { value: "3", label: "3 · Meets the bar" },
  { value: "4", label: "4 · Above the bar" },
  { value: "5", label: "5 · Exceptional" },
];

export function FeedbackForm({
  interviewId,
  criteria,
  existing,
}: {
  interviewId: string;
  criteria: ScorecardCriterion[];
  existing: { recommendation: string; overallRating: number; scores: { key: string; rating: number; notes?: string | null }[]; strengths: string | null; concerns: string | null } | null;
}) {
  const { form, submit, pending } = useActionForm({
    schema: feedbackSchema,
    defaultValues: {
      interviewId,
      recommendation: (existing?.recommendation as FeedbackInput["recommendation"]) ?? undefined,
      overallRating: existing ? String(existing.overallRating) : undefined,
      scores: criteria.map((c) => {
        const prev = existing?.scores.find((s) => s.key === c.key);
        return { key: c.key, rating: prev ? String(prev.rating) : "3", notes: prev?.notes ?? "" };
      }),
      strengths: existing?.strengths ?? "",
      concerns: existing?.concerns ?? "",
    } as never,
    action: submitFeedbackAction,
    successMessage: existing ? "Feedback updated" : "Feedback submitted",
  });
  const c = form.control;
  const scores = useFieldArray({ control: c, name: "scores" });
  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormError message={form.formState.errors.root?.message} />
        <div className="space-y-4">
          {scores.fields.map((f, i) => {
            const crit = criteria[i];
            return (
              <div key={f.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_14rem]">
                <div>
                  <div className="text-sm font-medium">{crit?.label}</div>
                  {crit?.description ? <div className="text-xs text-muted-foreground">{crit.description}</div> : null}
                  <TextareaField control={c} name={`scores.${i}.notes`} label="Evidence" rows={2} className="mt-2" />
                </div>
                <SelectField control={c} name={`scores.${i}.rating`} label="Rating" options={RATINGS} />
              </div>
            );
          })}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField control={c} name="overallRating" label="Overall rating" options={RATINGS} required />
          <SelectField control={c} name="recommendation" label="Recommendation" options={RECOMMENDATIONS.map((r) => ({ value: r, label: RECOMMENDATION_LABELS[r] }))} required />
        </div>
        <TextareaField control={c} name="strengths" label="Strengths" rows={3} description="Job-related observations with examples." />
        <TextareaField control={c} name="concerns" label="Concerns" rows={3} description="Never comment on age, family, religion, accent, appearance or other personal characteristics." />
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            {existing ? "Update feedback" : "Submit feedback"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
