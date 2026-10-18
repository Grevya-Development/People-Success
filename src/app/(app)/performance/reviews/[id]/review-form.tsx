"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { computeOverallRating, overrideNeedsJustification, type GoalLite, type RatingLevelLite } from "@/lib/talent/ratings";
import type { ReviewQuestion } from "@/server/db/schema/talent";
import { saveReviewAction } from "../../actions";

type Answers = Record<string, { rating?: number; text?: string }>;

export function RatingPicker({ levels, value, onChange, label, disabled }: { levels: RatingLevelLite[]; value?: number; onChange?: (v: number) => void; label: string; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {levels.map((l) => (
        <button
          key={l.value}
          type="button"
          role="radio"
          aria-checked={value === l.value}
          disabled={disabled}
          title={l.description}
          onClick={() => onChange?.(l.value)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60",
            value === l.value ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted",
          )}
        >
          <span className="font-semibold tabular">{l.value}</span>
          <span className="hidden sm:inline">{l.label}</span>
        </button>
      ))}
    </div>
  );
}

export function ReviewForm({
  reviewId,
  kind,
  questions,
  competencyNames,
  levels,
  initial,
  initialOverall,
  initialJustification,
  initialDevelopment,
  goals,
  includeGoals,
  goalsWeightPercent,
}: {
  reviewId: string;
  kind: string;
  questions: ReviewQuestion[];
  competencyNames: Record<string, string>;
  levels: RatingLevelLite[];
  initial: Answers;
  initialOverall: number | null;
  initialJustification: string | null;
  initialDevelopment: string | null;
  goals: GoalLite[];
  includeGoals: boolean;
  goalsWeightPercent: number;
}) {
  const [answers, setAnswers] = useState<Answers>(initial);
  const [overall, setOverall] = useState<number | null>(initialOverall);
  const [justification, setJustification] = useState(initialJustification ?? "");
  const [development, setDevelopment] = useState(initialDevelopment ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isManager = kind === "manager";

  // Same pure function the server uses, so the suggestion updates as you answer.
  const suggestion = useMemo(
    () => computeOverallRating({ questions, responses: answers, kind, levels, goals, includeGoals, goalsWeightPercent }),
    [answers, questions, kind, levels, goals, includeGoals, goalsWeightPercent],
  );
  const chosen = overall ?? suggestion.overall;
  const needsJustification = isManager && overrideNeedsJustification(suggestion.overall, chosen);

  const set = (id: string, patch: { rating?: number; text?: string }) => setAnswers((a) => ({ ...a, [id]: { ...a[id], ...patch } }));

  const save = (submit: boolean) =>
    new Promise<boolean>((resolve) =>
      start(async () => {
        const res = await saveReviewAction({
          reviewId,
          responses: answers,
          overallRating: isManager ? chosen : null,
          overrideJustification: needsJustification ? justification : null,
          developmentAreas: isManager ? development : null,
          submit,
        });
        if (res.ok) {
          setErrors({});
          toast.success(submit ? "Review submitted" : "Draft saved");
          resolve(true);
        } else {
          const fe = res.error.fieldErrors ?? {};
          setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k.replace(/^responses\./, ""), v[0]])));
          toast.error(res.error.message);
          resolve(false);
        }
      }),
    );

  return (
    <div className="space-y-5">
      {questions.map((q, i) => (
        <Field key={q.id} data-invalid={!!errors[q.id]} className="rounded-xl border bg-card p-4">
          <FieldLabel className="leading-snug">
            <span className="text-muted-foreground tabular">{i + 1}.</span> {q.label}
            {q.required ? <span className="text-destructive" aria-hidden>*</span> : null}
          </FieldLabel>
          {q.type === "competency" && q.competencyId ? <FieldDescription>Competency: {competencyNames[q.competencyId] ?? "—"}</FieldDescription> : null}
          {q.type === "text" ? (
            <Textarea rows={4} value={answers[q.id]?.text ?? ""} onChange={(e) => set(q.id, { text: e.target.value })} aria-invalid={!!errors[q.id]} />
          ) : (
            <>
              <RatingPicker levels={levels} value={answers[q.id]?.rating} onChange={(v) => set(q.id, { rating: v })} label={q.label} />
              <Textarea rows={2} placeholder="Comment (optional)" value={answers[q.id]?.text ?? ""} onChange={(e) => set(q.id, { text: e.target.value })} />
            </>
          )}
          {errors[q.id] ? <FieldError>{errors[q.id]}</FieldError> : null}
        </Field>
      ))}

      {isManager ? (
        <div className="space-y-4 rounded-xl border bg-card p-4">
          <div>
            <p className="text-sm font-semibold">Overall rating</p>
            <p className="text-xs text-muted-foreground">
              Suggested: <span className="font-medium tabular">{suggestion.overall?.toFixed(2) ?? "answer the rating questions"}</span>
              {suggestion.goalsRating != null ? ` (questions ${suggestion.questionAverage?.toFixed(2) ?? "—"}, goals ${suggestion.goalsRating.toFixed(2)} at ${suggestion.goalsWeightPercent}% weight)` : ""}. This is a calculation, not an AI judgement; you decide.
            </p>
          </div>
          <RatingPicker levels={levels} value={overall ?? undefined} onChange={setOverall} label="Overall rating" />
          {overall != null ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setOverall(null)}>
              Use the suggestion
            </Button>
          ) : null}
          {needsJustification ? (
            <Field data-invalid={!!errors.overrideJustification}>
              <FieldLabel>Why does your rating differ from the suggestion?</FieldLabel>
              <Textarea rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} />
              {errors.overrideJustification ? <FieldError>{errors.overrideJustification}</FieldError> : null}
            </Field>
          ) : null}
          <Field>
            <FieldLabel>Agreed development areas</FieldLabel>
            <FieldDescription>One per line. After the cycle closes they can be added to the employee&apos;s development plan.</FieldDescription>
            <Textarea rows={3} value={development} onChange={(e) => setDevelopment(e.target.value)} placeholder={"Delegation\nStakeholder communication"} />
          </Field>
        </div>
      ) : null}

      <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t bg-background/95 py-3 backdrop-blur">
        <Button type="button" variant="outline" disabled={pending} onClick={() => void save(false)}>
          {pending ? <Spinner /> : null} Save draft
        </Button>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogTrigger asChild>
            <Button type="button" disabled={pending}>
              Submit
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Submit this review?</AlertDialogTitle>
              <AlertDialogDescription>
                {kind === "self"
                  ? "Your manager will be able to read it once submitted. You cannot edit it afterwards."
                  : kind === "manager"
                    ? "HR may calibrate the rating before it is shared with the employee. You cannot edit it afterwards."
                    : "You cannot edit it afterwards."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  disabled={pending}
                  onClick={async (e) => {
                    e.preventDefault();
                    await save(true);
                    setConfirmOpen(false);
                  }}
                >
                  {pending ? <Spinner /> : null} Submit review
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
