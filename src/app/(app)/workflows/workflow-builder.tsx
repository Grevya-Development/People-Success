"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { FormError } from "@/components/forms/fields";
import type { ActionSpec } from "@/server/services/workflows/catalog";
import { saveWorkflowAction } from "./actions";

type Step = { key: string; action: string; name: string; params: Record<string, unknown> };
type Option = { value: string; label: string };

/** Facts that conditions can test, with input kinds. */
const CONDITION_FIELDS: { key: string; label: string; kind: "department" | "location" | "employmentType" | "number" | "text" }[] = [
  { key: "departmentId", label: "Department is", kind: "department" },
  { key: "locationId", label: "Location is", kind: "location" },
  { key: "employmentType", label: "Employment type is", kind: "employmentType" },
  { key: "tenureDays", label: "Tenure (days) at least", kind: "number" },
  { key: "days", label: "Leave days at least", kind: "number" },
  { key: "milestone", label: "Milestone is", kind: "text" },
];

const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern", "consultant", "temporary"];

export function WorkflowBuilder({
  initial,
  triggers,
  actions,
  departments,
  locations,
}: {
  initial?: { id: string; name: string; description: string | null; trigger: string; conditions: Record<string, unknown>; steps: Step[] };
  triggers: { event: string; label: string }[];
  actions: ActionSpec[];
  departments: Option[];
  locations: Option[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [trigger, setTrigger] = useState(initial?.trigger ?? triggers[0].event);
  const [conditions, setConditions] = useState<Record<string, unknown>>(initial?.conditions ?? {});
  const [steps, setSteps] = useState<Step[]>(initial?.steps ?? []);

  const spec = (a: string) => actions.find((x) => x.action === a)!;
  const addStep = (action: string) =>
    setSteps((s) => [...s, { key: `${action}_${s.length + 1}`.slice(0, 40), action, name: spec(action).label, params: {} }]);
  const updateStep = (i: number, patch: Partial<Step>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) =>
    setSteps((s) => {
      const n = [...s];
      const [x] = n.splice(i, 1);
      n.splice(i + d, 0, x);
      return n;
    });

  const setCondition = (key: string, value: unknown) =>
    setConditions((c) => {
      const n = { ...c };
      if (value === "" || value === null || value === undefined) delete n[key];
      else n[key] = value;
      return n;
    });

  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveWorkflowAction({ id: initial?.id, name, description, trigger, conditions, steps });
      if (res.ok) {
        toast.success(initial ? `Saved as version ${res.data.version}` : "Workflow created (inactive)");
        router.push(`/workflows/${res.data.id}`);
        router.refresh();
      } else {
        const fe = res.error.fieldErrors ? Object.entries(res.error.fieldErrors).map(([k, v]) => `${k}: ${v[0]}`).join("; ") : "";
        setError(`${res.error.message}${fe ? ` (${fe})` : ""}`);
      }
    });

  return (
    <div className="space-y-5">
      <FormError message={error ?? undefined} />
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="wf-name">Name</Label>
            <Input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>When this happens</Label>
            <Select value={trigger} onValueChange={setTrigger}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {triggers.map((t) => (
                  <SelectItem key={t.event} value={t.event}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="wf-desc">Description</Label>
          <Textarea id="wf-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">Only if</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Leave blank to run for every event of this type.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CONDITION_FIELDS.map((f) => {
            const v = conditions[f.key];
            const opts = f.kind === "department" ? departments : f.kind === "location" ? locations : f.kind === "employmentType" ? EMPLOYMENT_TYPES.map((e) => ({ value: e, label: e.replace("_", " ") })) : null;
            return (
              <div key={f.key} className="space-y-2">
                <Label>{f.label}</Label>
                {opts ? (
                  <Select value={typeof v === "string" ? v : "__any__"} onValueChange={(x) => setCondition(f.key, x === "__any__" ? "" : x)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__any__">Any</SelectItem>
                      {opts.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : f.kind === "number" ? (
                  <Input
                    type="number"
                    value={typeof v === "object" && v && "gte" in v ? String((v as { gte: number }).gte) : ""}
                    onChange={(e) => setCondition(f.key, e.target.value === "" ? "" : { gte: Number(e.target.value) })}
                    placeholder="Any"
                  />
                ) : (
                  <Input value={typeof v === "string" ? v : ""} onChange={(e) => setCondition(f.key, e.target.value)} placeholder="Any" />
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5">
          <h2 className="text-sm font-semibold">Then do</h2>
          <Select value="" onValueChange={addStep}>
            <SelectTrigger size="sm" className="w-48">
              <Plus className="size-3.5" />
              <SelectValue placeholder="Add step" />
            </SelectTrigger>
            <SelectContent>
              {actions.map((a) => (
                <SelectItem key={a.action} value={a.action}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </header>
        {steps.length ? (
          <ol className="divide-y">
            {steps.map((s, i) => {
              const sp = spec(s.action);
              return (
                <li key={i} className="space-y-3 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular">{i + 1}</span>
                    <Input aria-label="Step name" value={s.name} onChange={(e) => updateStep(i, { name: e.target.value })} className="h-8 max-w-xs" />
                    <span className="text-xs text-muted-foreground">{sp.label}</span>
                    <div className="ml-auto flex gap-1">
                      <Button size="icon-xs" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                        <ArrowUp />
                      </Button>
                      <Button size="icon-xs" variant="ghost" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                        <ArrowDown />
                      </Button>
                      <Button size="icon-xs" variant="ghost" onClick={() => setSteps((x) => x.filter((_, j) => j !== i))} aria-label="Remove step">
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-3 pl-8 sm:grid-cols-2">
                    {sp.params.map((p) => {
                      const v = s.params[p.key];
                      const set = (val: unknown) => updateStep(i, { params: { ...s.params, [p.key]: val } });
                      return (
                        <div key={p.key} className={p.type === "textarea" ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
                          <Label className="text-xs">
                            {p.label}
                            {p.required ? <span className="text-destructive">*</span> : null}
                          </Label>
                          {p.type === "select" ? (
                            <Select value={typeof v === "string" ? v : ""} onValueChange={set}>
                              <SelectTrigger size="sm" className="w-full">
                                <SelectValue placeholder="Choose…" />
                              </SelectTrigger>
                              <SelectContent>
                                {p.options!.map((o) => (
                                  <SelectItem key={o} value={o}>
                                    {o.replace(/_/g, " ")}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : p.type === "textarea" ? (
                            <Textarea rows={2} value={String(v ?? "")} onChange={(e) => set(e.target.value)} />
                          ) : (
                            <Input
                              type={p.type === "number" ? "number" : "text"}
                              value={String(v ?? "")}
                              onChange={(e) => set(p.type === "number" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value)}
                              className="h-8"
                            />
                          )}
                          {p.help ? <p className="text-[11px] text-muted-foreground">{p.help}</p> : null}
                        </div>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">Add the first step: a task, notification, approval or wait.</p>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Text fields support placeholders such as {"{{employee.name}}"}, {"{{employee.department}}"} and {"{{event.date}}"}. Saving creates a new version;
        runs already in progress keep the version they started with.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button onClick={save} disabled={pending}>
          {pending ? <Spinner /> : null}
          {initial ? "Save new version" : "Create workflow"}
        </Button>
      </div>
    </div>
  );
}
