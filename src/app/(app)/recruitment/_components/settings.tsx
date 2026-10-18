"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/status-badge";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { useRunAction } from "@/components/documents/use-run-action";
import { scorecardSchema, STAGE_KIND_LABELS, stageSchema } from "@/lib/validation/recruitment";
import type { StageRow, ScorecardRow } from "@/server/services/recruitment/stages";
import { addStageAction, installDefaultScorecardAction, moveStageOrderAction, renameStageAction, saveScorecardAction, setStageActiveAction } from "../actions";

const FIXED = new Set(["applied", "hired"]);

function StageItem({ s, first, last }: { s: StageRow; first: boolean; last: boolean }) {
  const { pending, run } = useRunAction();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.name);
  const fixed = FIXED.has(s.kind);
  return (
    <li className="flex flex-wrap items-center gap-2 px-5 py-2.5">
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => renameStageAction({ id: s.id, name }), { success: "Stage renamed", onSuccess: () => setEditing(false) });
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Stage name" className="h-7" autoFocus />
            <Button size="icon-sm" type="submit" disabled={pending || name.trim().length < 2} aria-label="Save name">
              {pending ? <Spinner /> : <Check />}
            </Button>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <span className={s.isActive ? "font-medium" : "font-medium text-muted-foreground line-through"}>{s.name}</span>
            <StatusBadge status={s.kind} label={STAGE_KIND_LABELS[s.kind]} tone="neutral" />
            {s.activeApplications ? <span className="text-xs text-muted-foreground tabular">{s.activeApplications} active</span> : null}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        {!editing ? (
          <Button size="icon-sm" variant="ghost" aria-label={`Rename ${s.name}`} onClick={() => setEditing(true)}>
            <Pencil />
          </Button>
        ) : null}
        <Button size="icon-sm" variant="ghost" aria-label={`Move ${s.name} up`} disabled={pending || fixed || first} onClick={() => run(() => moveStageOrderAction({ id: s.id, direction: "up" }))}>
          <ArrowUp />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={`Move ${s.name} down`} disabled={pending || fixed || last} onClick={() => run(() => moveStageOrderAction({ id: s.id, direction: "down" }))}>
          <ArrowDown />
        </Button>
        <Switch
          aria-label={s.isActive ? `Turn off ${s.name}` : `Turn on ${s.name}`}
          checked={s.isActive}
          disabled={pending || fixed || s.kind === "offer"}
          onCheckedChange={(v) => run(() => setStageActiveAction({ id: s.id, isActive: v }), { success: v ? "Stage turned on" : "Stage turned off" })}
        />
      </div>
    </li>
  );
}

export function StagesManager({ stages }: { stages: StageRow[] }) {
  return (
    <div>
      <ol className="divide-y">
        {stages.map((s, i) => (
          <StageItem key={s.id} s={s} first={i <= 1} last={i >= stages.length - 2} />
        ))}
      </ol>
      <div className="border-t px-5 py-3">
        <FormDialog
          trigger={
            <Button size="sm" variant="outline">
              <Plus /> Add stage
            </Button>
          }
          title="Add a stage"
          description="New stages are added before the Offer stage. Reorder them afterwards."
          schema={stageSchema}
          defaultValues={{ name: "", kind: "review" }}
          action={addStageAction}
          submitLabel="Add stage"
          successMessage="Stage added"
        >
          {(form) => (
            <>
              <TextField control={form.control} name="name" label="Name" required placeholder="e.g. Take-home assignment" />
              <SelectField
                control={form.control}
                name="kind"
                label="Kind"
                description="Used for analytics and referral status."
                options={(["screening", "review", "assessment", "interview", "final"] as const).map((k) => ({ value: k, label: STAGE_KIND_LABELS[k] }))}
              />
            </>
          )}
        </FormDialog>
      </div>
    </div>
  );
}

function ScorecardDialog({ card, trigger }: { card?: ScorecardRow; trigger: React.ReactNode }) {
  return (
    <FormDialog
      trigger={trigger}
      title={card ? "Edit scorecard" : "New scorecard"}
      description="One criterion per line. Add a description after a colon, e.g. “Communication: clarity and listening”."
      schema={scorecardSchema}
      defaultValues={{
        id: card?.id ?? null,
        name: card?.name ?? "",
        criteriaText: card ? card.criteria.map((c) => (c.description ? `${c.label}: ${c.description}` : c.label)).join("\n") : "",
      }}
      action={saveScorecardAction}
      submitLabel="Save scorecard"
      successMessage="Scorecard saved"
    >
      {(form) => (
        <>
          <TextField control={form.control} name="name" label="Name" required />
          <TextareaField control={form.control} name="criteriaText" label="Criteria" rows={6} required />
        </>
      )}
    </FormDialog>
  );
}

export function ScorecardsManager({ scorecards }: { scorecards: ScorecardRow[] }) {
  const { pending, run } = useRunAction();
  return (
    <div>
      {scorecards.length ? (
        <ul className="divide-y">
          {scorecards.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.criteria.map((c) => c.label).join(" · ")}</div>
              </div>
              <ScorecardDialog
                card={s}
                trigger={
                  <Button size="icon-sm" variant="ghost" aria-label={`Edit ${s.name}`}>
                    <Pencil />
                  </Button>
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-4 text-sm text-muted-foreground">No scorecards yet. Interviews without a scorecard use three general criteria.</p>
      )}
      <div className="flex flex-wrap gap-2 border-t px-5 py-3">
        <ScorecardDialog
          trigger={
            <Button size="sm" variant="outline">
              <Plus /> New scorecard
            </Button>
          }
        />
        {!scorecards.some((s) => s.name === "General interview") ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => installDefaultScorecardAction({}), { success: "Default scorecard added" })}>
            {pending ? <Spinner /> : null}
            Add a general scorecard
          </Button>
        ) : null}
      </div>
    </div>
  );
}
