"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Lightbulb, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { coachingTopicsAction, summarizeFeedbackAction } from "../../actions";

type Summary = { source: "ai" | "rules"; note: string | null; data: { summary: string; strengths: string[]; concerns: string[] } };
type Coaching = { source: "ai" | "rules"; note: string | null; data: { topics: { title: string; why: string }[] } };

function SourceLabel({ source, note }: { source: "ai" | "rules"; note: string | null }) {
  return (
    <p className="text-[11px] text-muted-foreground">
      {source === "ai" ? "AI-generated suggestion. Advisory only; check it against the reviews." : `Rule-based summary${note ? `: ${note}` : ""}.`}
    </p>
  );
}

/**
 * Advisory helpers for the manager / HR. Results are shown here only; they
 * are never written into the review or used to compute a rating.
 */
export function ReviewAssist({ reviewId }: { reviewId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [coaching, setCoaching] = useState<Coaching | null>(null);
  const [pendingS, startS] = useTransition();
  const [pendingC, startC] = useTransition();
  return (
    <div className="space-y-4 px-5 py-4">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pendingS}
          onClick={() =>
            startS(async () => {
              const r = await summarizeFeedbackAction({ id: reviewId });
              if (r.ok) setSummary(r.data);
              else toast.error(r.error.message);
            })
          }
        >
          {pendingS ? <Spinner /> : <Sparkles />} Summarize feedback
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pendingC}
          onClick={() =>
            startC(async () => {
              const r = await coachingTopicsAction({ id: reviewId });
              if (r.ok) setCoaching(r.data);
              else toast.error(r.error.message);
            })
          }
        >
          {pendingC ? <Spinner /> : <Lightbulb />} Suggest coaching topics
        </Button>
      </div>
      {summary ? (
        <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-sm">
          <SourceLabel source={summary.source} note={summary.note} />
          <p>{summary.data.summary}</p>
          {summary.data.strengths.length ? (
            <div>
              <p className="text-xs font-medium text-success">Strengths</p>
              <ul className="list-disc pl-5">
                {summary.data.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {summary.data.concerns.length ? (
            <div>
              <p className="text-xs font-medium text-warning">Development points</p>
              <ul className="list-disc pl-5">
                {summary.data.concerns.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {coaching ? (
        <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-sm">
          <SourceLabel source={coaching.source} note={coaching.note} />
          {coaching.data.topics.length ? (
            <ul className="space-y-1.5">
              {coaching.data.topics.map((t, i) => (
                <li key={i}>
                  <p className="font-medium">{t.title}</p>
                  <p className="text-xs text-muted-foreground">{t.why}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No clear coaching topics in the feedback yet.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
