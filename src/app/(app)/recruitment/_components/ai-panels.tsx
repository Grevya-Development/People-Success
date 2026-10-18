"use client";

import { useState, useTransition } from "react";
import { Mail, ScanText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { StatusBadge } from "@/components/status-badge";
import { Section } from "@/components/page";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRunAction } from "@/components/documents/use-run-action";
import { formatDateTime } from "@/lib/format";
import { EMAIL_DRAFT_KINDS, EMAIL_DRAFT_LABELS } from "@/lib/validation/recruitment";
import type { ApplicationAiSummary, ParsedResume } from "@/server/db/schema/recruitment";
import { emailCandidateAction, emailDraftAction, interviewQuestionsAction, matchApplicationAction, parseResumeAction } from "../actions";

export function AdvisoryNote({ rules }: { rules: boolean }) {
  return (
    <p className="text-xs text-muted-foreground">
      {rules ? (
        <>
          <StatusBadge status="rules" label="Rule-based" tone="neutral" className="mr-1" /> Keyword matching against the job’s stated skills — not an assessment of ability.
        </>
      ) : (
        <>
          <StatusBadge status="ai" label="AI-generated" tone="info" className="mr-1" /> Verify before use. Advisory only; never used to rank or filter candidates.
        </>
      )}
    </p>
  );
}

/* Interview questions ------------------------------------------------- */

export function InterviewQuestions({ openingId }: { openingId: string }) {
  const [round, setRound] = useState("Technical interview");
  const [result, setResult] = useState<{ source: "ai" | "rules"; reason: string | null; questions: { question: string; criterion: string }[] } | null>(null);
  const { pending, run } = useRunAction();
  return (
    <Section title="Interview questions" description="Job-related questions mapped to the stated skills and requirements.">
      <div className="space-y-3 p-5">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => interviewQuestionsAction({ openingId, roundName: round }), { onSuccess: setResult });
          }}
        >
          <Input value={round} onChange={(e) => setRound(e.target.value)} aria-label="Interview round" maxLength={80} />
          <Button type="submit" size="sm" variant="outline" disabled={pending || round.trim().length < 2}>
            {pending ? <Spinner /> : <Sparkles />} Suggest
          </Button>
        </form>
        {result ? (
          <>
            <AdvisoryNote rules={result.source === "rules"} />
            {result.reason ? <p className="text-xs text-muted-foreground">{result.reason}</p> : null}
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              {result.questions.map((q, i) => (
                <li key={i}>
                  {q.question}
                  <div className="text-xs text-muted-foreground">{q.criterion}</div>
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </div>
    </Section>
  );
}

/* Job match ----------------------------------------------------------- */

const TONE = { meets: "success", partially: "warning", not_evident: "neutral" } as const;
const LABEL = { meets: "Meets", partially: "Partially", not_evident: "Not evident" } as const;

export function MatchPanel({ applicationId, summary, canManage }: { applicationId: string; summary: ApplicationAiSummary | null; canManage: boolean }) {
  const { pending, run } = useRunAction();
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState("");
  const generate = () =>
    run(() => matchApplicationAction({ applicationId, pastedText: paste && text.trim() ? text : null }), {
      success: (d) => (d.source === "ai" ? "Job match generated" : "Rule-based job match generated"),
      onSuccess: () => setPaste(false),
    });
  return (
    <div className="space-y-3">
      {summary ? (
        <>
          <AdvisoryNote rules={summary.model === "rule-based"} />
          <p className="text-sm">{summary.summary}</p>
          <ul className="divide-y rounded-lg border">
            {summary.criteria.map((c, i) => (
              <li key={i} className="space-y-1 px-3 py-2">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{c.criterion}</span>
                  <StatusBadge status={c.assessment} label={LABEL[c.assessment]} tone={TONE[c.assessment]} />
                </div>
                <p className="text-xs text-muted-foreground">{c.evidence}</p>
              </li>
            ))}
          </ul>
          {summary.missingInformation.length ? (
            <div>
              <div className="text-xs font-medium text-muted-foreground">Ask the candidate about</div>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {summary.missingInformation.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Generated {formatDateTime(summary.generatedAt)} · {summary.model} · {summary.promptVersion}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No match notes yet. They compare the resume only with this job’s stated skills, experience and requirements.</p>
      )}
      {canManage ? (
        <div className="space-y-2">
          {paste ? (
            <Field>
              <FieldLabel htmlFor={`paste-${applicationId}`}>Resume text</FieldLabel>
              <Textarea id={`paste-${applicationId}`} rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the resume text if the file could not be read" />
              <FieldDescription>Personal details such as age, gender and marital status are removed before processing.</FieldDescription>
            </Field>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={pending} onClick={generate}>
              {pending ? <Spinner /> : <Sparkles />} {summary ? "Regenerate" : "Generate"} match notes
            </Button>
            {!paste ? (
              <Button size="sm" variant="ghost" onClick={() => setPaste(true)}>
                Paste resume text
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* Resume parsing ------------------------------------------------------ */

export function ParsedProfile({ candidateId, profile, canManage, hasResume }: { candidateId: string; profile: ParsedResume | null; canManage: boolean; hasResume: boolean }) {
  const { pending, run } = useRunAction();
  const [paste, setPaste] = useState(!hasResume);
  const [text, setText] = useState("");
  return (
    <div className="space-y-3 p-5">
      {profile ? (
        <>
          <AdvisoryNote rules={profile.meta?.model === "rule-based"} />
          {profile.meta?.warnings?.length ? (
            <ul className="list-disc pl-5 text-xs text-muted-foreground">
              {profile.meta.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Skills</dt>
              <dd className="mt-1 flex flex-wrap gap-1">{profile.skills.length ? profile.skills.map((s) => <StatusBadge key={s} status={s} tone="neutral" className="normal-case" />) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Experience</dt>
              <dd>{profile.totalExperienceMonths != null ? `${Math.round((profile.totalExperienceMonths / 12) * 10) / 10} years` : "—"}</dd>
            </div>
            {profile.workHistory.length ? (
              <div>
                <dt className="text-xs text-muted-foreground">Work history</dt>
                <dd>
                  <ul className="space-y-1">
                    {profile.workHistory.map((w, i) => (
                      <li key={i}>
                        {w.title} · {w.company} <span className="text-muted-foreground">({w.from ?? "?"}–{w.to ?? "present"})</span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
            {profile.education.length ? (
              <div>
                <dt className="text-xs text-muted-foreground">Education</dt>
                <dd>
                  <ul className="space-y-1">
                    {profile.education.map((e, i) => (
                      <li key={i}>
                        {e.degree} · {e.institution} {e.year ? <span className="text-muted-foreground">({e.year})</span> : null}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
            {profile.certifications.length ? (
              <div>
                <dt className="text-xs text-muted-foreground">Certifications</dt>
                <dd>{profile.certifications.join("; ")}</dd>
              </div>
            ) : null}
          </dl>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Not parsed yet. Parsing extracts skills, work history, education and certifications from the resume.</p>
      )}
      {canManage ? (
        <div className="space-y-2">
          {paste ? (
            <Field>
              <FieldLabel htmlFor={`resume-${candidateId}`}>Resume text</FieldLabel>
              <Textarea id={`resume-${candidateId}`} rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the resume text" />
              <FieldDescription>Scanned PDFs and some embedded-font PDFs cannot be read automatically; paste the text instead.</FieldDescription>
            </Field>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending || (paste && text.trim().length < 40) || (!paste && !hasResume)}
              onClick={() =>
                run(() => parseResumeAction({ candidateId, pastedText: paste ? text : null }), {
                  onSuccess: (d) => {
                    if (!d.ok) toast.warning(d.warning);
                    else toast.success(d.source === "ai" ? "Resume parsed" : "Resume parsed (rule-based)");
                  },
                })
              }
            >
              {pending ? <Spinner /> : <ScanText />} {profile ? "Parse again" : "Parse resume"}
            </Button>
            {hasResume ? (
              <Button size="sm" variant="ghost" onClick={() => setPaste((p) => !p)}>
                {paste ? "Use the uploaded file" : "Paste text instead"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* Email composer ------------------------------------------------------ */

export function EmailComposer({ applicationId, candidateName }: { applicationId: string; candidateName: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof EMAIL_DRAFT_KINDS)[number]>("status_update");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [source, setSource] = useState<"ai" | "rules" | null>(null);
  const [drafting, startDraft] = useTransition();
  const { pending, run } = useRunAction();
  const draft = () =>
    startDraft(async () => {
      const r = await emailDraftAction({ applicationId, kind });
      if (!r.ok) return void toast.error(r.error.message);
      setSubject(r.data.draft.subject);
      setBody(r.data.draft.body);
      setSource(r.data.source);
    });
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Mail /> Email
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Email {candidateName}</DialogTitle>
          <DialogDescription>Sent from PeopleSuccess and saved to the application’s communication history.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger size="sm" className="w-56" aria-label="Draft type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMAIL_DRAFT_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {EMAIL_DRAFT_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" onClick={draft} disabled={drafting}>
              {drafting ? <Spinner /> : <Sparkles />} Draft
            </Button>
          </div>
          {source ? <AdvisoryNote rules={source === "rules"} /> : null}
          <Field>
            <FieldLabel htmlFor="email-subject">Subject</FieldLabel>
            <Input id="email-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
          </Field>
          <Field>
            <FieldLabel htmlFor="email-body">Message</FieldLabel>
            <Textarea id="email-body" rows={9} value={body} onChange={(e) => setBody(e.target.value)} maxLength={6000} />
            <FieldDescription>Replace any [placeholders] before sending.</FieldDescription>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={pending || subject.trim().length < 3 || body.trim().length < 10 || /\[[a-z ]+\]/i.test(body)}
            onClick={() => run(() => emailCandidateAction({ applicationId, subject, body }), { success: "Email sent", onSuccess: () => setOpen(false) })}
          >
            {pending ? <Spinner /> : null}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
