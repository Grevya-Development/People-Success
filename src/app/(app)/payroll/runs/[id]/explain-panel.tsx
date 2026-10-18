"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/status-badge";
import { explainRunAction } from "../../actions";
import { useRunAction } from "../../_components/use-run-action";

type Result = Extract<Awaited<ReturnType<typeof explainRunAction>>, { ok: true }>["data"];

/** Narrates exceptions and variances. Never changes numbers; rule-based results are labelled. */
export function ExplainPanel({ runId }: { runId: string }) {
  const [result, setResult] = useState<Result | null>(null);
  const { pending, run } = useRunAction();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => explainRunAction({ runId }), { onSuccess: setResult })}>
          {pending ? <Spinner /> : <Sparkles />}
          Explain with AI
        </Button>
        <span className="text-xs text-muted-foreground">The payroll audit agent explains the deterministic results; it never changes amounts.</span>
      </div>
      {result ? (
        <div className="space-y-3 rounded-lg border p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {result.source === "ai" ? <StatusBadge status="ai" tone="brand" label="AI summary" /> : <StatusBadge status="rules" tone="neutral" label="Rule-based summary" />}
            {result.reason ? <span className="text-xs text-muted-foreground">{result.reason}</span> : null}
          </div>
          <p>{result.data.summary}</p>
          {result.data.items.length ? (
            <ul className="divide-y rounded-md border">
              {result.data.items.map((i) => (
                <li key={i.employeeCode} className="flex items-start gap-3 px-3 py-2">
                  <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{i.employeeCode}</span>
                  <span className="flex-1">{i.explanation}</span>
                  {i.needsReview ? <StatusBadge status="review" tone="warning" label="Review" /> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
