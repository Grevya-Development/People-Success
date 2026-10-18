"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { Option } from "@/components/forms/fields";

type Value = { entityType: string; action: string; actor: string; from: string; to: string };
const ALL = "__all__";

export function AuditFilters({ value, entityTypes, actors }: { value: Value; entityTypes: Option[]; actors: Option[] }) {
  const router = useRouter();
  const [v, setV] = useState(value);
  const [pending, startTransition] = useTransition();
  const set = (k: keyof Value) => (val: string) => setV((s) => ({ ...s, [k]: val === ALL ? "" : val }));

  const apply = (next: Value) => {
    const qs = new URLSearchParams();
    for (const [k, val] of Object.entries(next)) if (val) qs.set(k, val);
    startTransition(() => router.replace(`/settings/audit${qs.size ? `?${qs}` : ""}`, { scroll: false }));
  };

  return (
    <form
      className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] lg:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        apply(v);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="audit-entity">Record type</Label>
        <Select value={v.entityType || ALL} onValueChange={set("entityType")}>
          <SelectTrigger id="audit-entity" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {entityTypes.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="audit-action">Action contains</Label>
        <Input id="audit-action" value={v.action} onChange={(e) => set("action")(e.target.value)} placeholder="e.g. role" maxLength={80} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="audit-actor">Who</Label>
        <Select value={v.actor || ALL} onValueChange={set("actor")}>
          <SelectTrigger id="audit-actor" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Anyone</SelectItem>
            {actors.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="audit-from">From</Label>
        <Input id="audit-from" type="date" value={v.from} max={v.to || undefined} onChange={(e) => set("from")(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="audit-to">To</Label>
        <Input id="audit-to" type="date" value={v.to} min={v.from || undefined} onChange={(e) => set("to")(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          Apply
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            const empty = { entityType: "", action: "", actor: "", from: "", to: "" };
            setV(empty);
            apply(empty);
          }}
        >
          Clear
        </Button>
      </div>
    </form>
  );
}
