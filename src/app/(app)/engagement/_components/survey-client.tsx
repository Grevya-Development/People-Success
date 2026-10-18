"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { submitSurveyResponseAction, textThemesAction } from "../actions";

type Question = { id: string; label: string; type: "scale" | "enps" | "choice" | "text"; options?: string[]; required: boolean };

function Scale({ min, max, value, onChange, label, lowLabel, highLabel }: { min: number; max: number; value?: number; onChange: (v: number) => void; label: string; lowLabel: string; highLabel: string }) {
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <div>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn(
              "size-9 rounded-md border text-sm tabular transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              value === v ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted",
            )}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="mt-1 flex max-w-md justify-between text-[11px] text-muted-foreground">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}

/**
 * Survey response form. Nothing here is stored in the browser; the server
 * records the answers (without identity for anonymous surveys) and marks you
 * as responded.
 */
export function RespondForm({ surveyId, questions, anonymous }: { surveyId: string; questions: Question[]; anonymous: boolean }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const set = (id: string, v: string | number) => setAnswers((a) => ({ ...a, [id]: v }));
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await submitSurveyResponseAction({ surveyId, answers });
          if (res.ok) {
            toast.success("Thank you. Your response was recorded.");
            router.push("/engagement?tab=surveys");
          } else {
            setErrors(Object.fromEntries(Object.entries(res.error.fieldErrors ?? {}).map(([k, v]) => [k.replace(/^answers\./, ""), v[0]])));
            toast.error(res.error.message);
          }
        });
      }}
    >
      {questions.map((q, i) => (
        <fieldset key={q.id} className={cn("space-y-2 rounded-xl border bg-card p-4", errors[q.id] && "border-danger")}>
          <legend className="sr-only">{q.label}</legend>
          <p className="text-sm font-medium">
            <span className="text-muted-foreground tabular">{i + 1}.</span> {q.label}
            {q.required ? <span className="text-destructive" aria-hidden>*</span> : null}
          </p>
          {q.type === "scale" ? <Scale min={1} max={5} value={answers[q.id] as number | undefined} onChange={(v) => set(q.id, v)} label={q.label} lowLabel="Strongly disagree" highLabel="Strongly agree" /> : null}
          {q.type === "enps" ? <Scale min={0} max={10} value={answers[q.id] as number | undefined} onChange={(v) => set(q.id, v)} label={q.label} lowLabel="Not at all likely" highLabel="Extremely likely" /> : null}
          {q.type === "choice" ? (
            <div className="space-y-1.5">
              {(q.options ?? []).map((o) => (
                <label key={o} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm", answers[q.id] === o && "border-foreground")}>
                  <input type="radio" name={q.id} checked={answers[q.id] === o} onChange={() => set(q.id, o)} className="size-4 accent-foreground" />
                  {o}
                </label>
              ))}
            </div>
          ) : null}
          {q.type === "text" ? (
            <>
              <Textarea rows={4} maxLength={2000} value={(answers[q.id] as string) ?? ""} onChange={(e) => set(q.id, e.target.value)} aria-label={q.label} />
              {anonymous ? <p className="text-[11px] text-muted-foreground">Avoid names or details that identify you. Comments are only summarized for groups large enough to protect anonymity.</p> : null}
            </>
          ) : null}
          {errors[q.id] ? <p className="text-xs text-danger">{errors[q.id]}</p> : null}
        </fieldset>
      ))}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null} Submit response
        </Button>
      </div>
    </form>
  );
}

type Themes = { source: "ai" | "rules"; note: string | null; answered: number; themes: { theme: string; summary: string; mentions: number }[] };

export function ThemeSummary({ surveyId, questionId }: { surveyId: string; questionId: string }) {
  const [data, setData] = useState<Themes | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await textThemesAction({ surveyId, questionId });
            if (res.ok) setData(res.data);
            else toast.error(res.error.message);
          })
        }
      >
        {pending ? <Spinner /> : <Sparkles />} Summarize themes
      </Button>
      {data ? (
        <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-sm">
          <p className="text-[11px] text-muted-foreground">
            {data.source === "ai" ? `AI summary of ${data.answered} comments. Comments are never shown individually.` : `Keyword frequency across ${data.answered} comments${data.note ? ` (${data.note})` : ""}.`}
          </p>
          {data.themes.length ? (
            <ul className="space-y-1.5">
              {data.themes.map((t, i) => (
                <li key={i}>
                  <span className="font-medium">{t.theme}</span> <span className="text-xs text-muted-foreground tabular">· {t.mentions}</span>
                  <p className="text-xs text-muted-foreground">{t.summary}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No recurring themes.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
