"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Download, ExternalLink, PlayCircle } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Progress } from "@/components/ui/progress";
import { courseMaterialLinkAction, enrollSelfAction, submitQuizAction, updateProgressAction } from "../actions";

type Quiz = { passMark: number; questions: { id: string; prompt: string; options: string[] }[] } | null;
type Enrollment = { id: string; status: string; progressPercent: number; score: number | null; attempts: number; certificateDocumentId: string | null } | null;

export function MaterialButton({ courseId, fileName }: { courseId: string; fileName: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await courseMaterialLinkAction({ courseId });
          if (res.ok) window.location.assign(res.data.url);
          else toast.error(res.error.message);
        })
      }
    >
      {pending ? <Spinner /> : <Download />} {fileName}
    </Button>
  );
}

/** Learner controls: enroll, progress, quiz. Scores are computed on the server. */
export function CoursePlayer({ courseId, url, enrollment, quiz }: { courseId: string; url: string | null; enrollment: Enrollment; quiz: Quiz }) {
  const [pending, start] = useTransition();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<{ score: number; passed: boolean; correct: number; total: number } | null>(null);
  const open = enrollment && (enrollment.status === "assigned" || enrollment.status === "in_progress");

  if (!enrollment || enrollment.status === "expired" || enrollment.status === "waived") {
    return (
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await enrollSelfAction({ courseId });
            if (res.ok) toast.success("Enrolled");
            else toast.error(res.error.message);
          })
        }
      >
        {pending ? <Spinner /> : <PlayCircle />} {enrollment?.status === "expired" ? "Retake course" : "Enroll"}
      </Button>
    );
  }

  const progress = (pct: number) =>
    start(async () => {
      const res = await updateProgressAction({ enrollmentId: enrollment.id, progressPercent: pct });
      if (res.ok) toast.success(res.data.status === "completed" ? "Course completed. Your certificate is ready." : "Progress saved");
      else toast.error(res.error.message);
    });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Progress value={enrollment.progressPercent} className="h-2 flex-1" aria-label={`${enrollment.progressPercent}% complete`} />
        <span className="text-sm tabular text-muted-foreground">{enrollment.progressPercent}%</span>
      </div>
      {open ? (
        <div className="flex flex-wrap gap-2">
          {url ? (
            <Button
              asChild
              onClick={() => {
                if (enrollment.progressPercent < 10) progress(10);
              }}
            >
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink /> Open course
              </a>
            </Button>
          ) : null}
          {enrollment.progressPercent < 50 ? (
            <Button variant="outline" disabled={pending} onClick={() => progress(50)}>
              Mark halfway
            </Button>
          ) : null}
          {!quiz ? (
            <Button variant="outline" disabled={pending} onClick={() => progress(100)}>
              {pending ? <Spinner /> : null} Mark as complete
            </Button>
          ) : null}
        </div>
      ) : null}
      {quiz && open ? (
        <form
          className="space-y-4 rounded-xl border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await submitQuizAction({ enrollmentId: enrollment.id, answers });
              if (res.ok) {
                setResult(res.data);
                if (res.data.passed) toast.success(`Passed with ${res.data.score}%. Certificate issued.`);
                else toast.error(`Scored ${res.data.score}%. You need ${quiz.passMark}% to pass.`);
              } else toast.error(res.error.message);
            });
          }}
        >
          <div>
            <p className="text-sm font-semibold">Quiz</p>
            <p className="text-xs text-muted-foreground">
              Pass mark {quiz.passMark}% · {enrollment.attempts} attempt{enrollment.attempts === 1 ? "" : "s"} so far
              {enrollment.score != null ? ` · last score ${enrollment.score}%` : ""}
            </p>
          </div>
          {quiz.questions.map((q, i) => (
            <fieldset key={q.id} className="space-y-1.5">
              <legend className="text-sm font-medium">
                {i + 1}. {q.prompt}
              </legend>
              {q.options.map((o, oi) => (
                <label key={oi} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm", answers[q.id] === oi && "border-foreground")}>
                  <input type="radio" name={q.id} checked={answers[q.id] === oi} onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))} className="size-4 accent-foreground" />
                  {o}
                </label>
              ))}
            </fieldset>
          ))}
          {result && !result.passed ? (
            <p className="text-sm text-danger">
              {result.correct} of {result.total} correct ({result.score}%). Review the material and try again.
            </p>
          ) : null}
          <Button type="submit" disabled={pending || Object.keys(answers).length < quiz.questions.length}>
            {pending ? <Spinner /> : null} Submit answers
          </Button>
        </form>
      ) : null}
      {enrollment.status === "completed" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-success-soft px-4 py-3 text-sm text-success">
          <span>Completed{enrollment.score != null ? ` with ${enrollment.score}%` : ""}.</span>
          {enrollment.certificateDocumentId ? (
            <Button size="sm" variant="outline" asChild>
              <a href={`/api/documents/${enrollment.certificateDocumentId}/download`}>
                <Download /> Certificate
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
