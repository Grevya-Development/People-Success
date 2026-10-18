"use client";

import { useMemo, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Section } from "@/components/page";
import type { Grants, Permission, Scope } from "@/lib/permissions";
import { useRunAction } from "../../_components/run-action";
import { updateRoleAction } from "../actions";

type Group = { group: string; items: { key: Permission; label: string; scoped: boolean; sensitive: boolean }[] };

const SCOPE_LABELS: Record<Scope, string> = { self: "Own records", team: "Their team", all: "Everyone" };

export function RoleEditor({
  role,
  groups,
}: {
  role: { id: string; name: string; description: string; grants: Grants; editable: boolean; canRename: boolean };
  groups: Group[];
}) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [grants, setGrants] = useState<Grants>(role.grants);
  const [saved, setSaved] = useState({ name: role.name, description: role.description, grants: role.grants });
  const { pending, run } = useRunAction();
  const readOnly = !role.editable;

  const dirty = useMemo(
    () => name !== saved.name || description !== saved.description || JSON.stringify(sortGrants(grants)) !== JSON.stringify(sortGrants(saved.grants)),
    [name, description, grants, saved],
  );
  const total = Object.keys(grants).length;

  const toggle = (perm: Permission, on: boolean, scoped: boolean) =>
    setGrants((g) => {
      const next = { ...g };
      if (on) next[perm] = scoped ? (role.grants[perm] ?? "self") : "all";
      else delete next[perm];
      return next;
    });

  const setGroup = (items: Group["items"], on: boolean) =>
    setGrants((g) => {
      const next = { ...g };
      for (const i of items) {
        if (on) next[i.key] = next[i.key] ?? (i.scoped ? "self" : "all");
        else delete next[i.key];
      }
      return next;
    });

  const save = () =>
    run(
      () =>
        updateRoleAction({
          id: role.id,
          name: name.trim(),
          description: description.trim() || undefined,
          permissions: Object.entries(grants).map(([permission, scope]) => ({ permission: permission as Permission, scope: scope! })),
        }),
      {
        success: (d) => (d.changed ? `Role saved${d.affected ? `. Access updated for ${d.affected} member${d.affected === 1 ? "" : "s"}` : ""}` : "No changes to save"),
        onSuccess: () => setSaved({ name: name.trim(), description: description.trim(), grants }),
      },
    );

  return (
    <div className="space-y-6 pb-20">
      <Section title="Details">
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="role-name">Name</Label>
            <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly || !role.canRename} maxLength={60} />
            {!role.canRename && !readOnly ? <p className="text-xs text-muted-foreground">Built-in roles keep their names.</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="role-description">Description</Label>
            <Textarea id="role-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} disabled={readOnly} maxLength={300} />
          </div>
        </div>
      </Section>

      {groups.map((g) => {
        const on = g.items.filter((i) => grants[i.key]).length;
        return (
          <Section
            key={g.group}
            title={g.group}
            description={`${on} of ${g.items.length} granted`}
            actions={
              readOnly ? null : (
                <Button variant="ghost" size="xs" onClick={() => setGroup(g.items, on < g.items.length)}>
                  {on < g.items.length ? "Grant all" : "Clear"}
                </Button>
              )
            }
          >
            <ul className="divide-y">
              {g.items.map((i) => {
                const id = `perm-${i.key}`;
                const checked = !!grants[i.key];
                return (
                  <li key={i.key} className={cn("flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between", checked && "bg-muted/30")}>
                    <div className="flex items-start gap-3">
                      <Checkbox id={id} checked={checked} disabled={readOnly} onCheckedChange={(v) => toggle(i.key, v === true, i.scoped)} className="mt-0.5" />
                      <div>
                        <Label htmlFor={id} className="font-normal">
                          {i.label}
                          {i.sensitive ? (
                            <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-warning-soft px-1.5 py-px text-[11px] font-medium text-warning">
                              <ShieldAlert className="size-3" aria-hidden /> Sensitive
                            </span>
                          ) : null}
                        </Label>
                        <p className="font-mono text-[11px] text-muted-foreground">{i.key}</p>
                      </div>
                    </div>
                    {i.scoped && checked ? (
                      <Select
                        value={grants[i.key]}
                        disabled={readOnly}
                        onValueChange={(v) => setGrants((gr) => ({ ...gr, [i.key]: v as Scope }))}
                      >
                        <SelectTrigger size="sm" className="w-40 sm:ml-4" aria-label={`Scope for ${i.label}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(SCOPE_LABELS) as Scope[]).map((s) => (
                            <SelectItem key={s} value={s}>
                              {SCOPE_LABELS[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Section>
        );
      })}

      {readOnly ? null : (
        <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {total} permission{total === 1 ? "" : "s"} selected{dirty ? " · unsaved changes" : ""}
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={!dirty || pending}
              onClick={() => {
                setName(saved.name);
                setDescription(saved.description);
                setGrants(saved.grants);
              }}
            >
              Discard
            </Button>
            <Button onClick={save} disabled={!dirty || pending || name.trim().length < 2}>
              {pending ? <Spinner /> : null}
              Save role
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function sortGrants(g: Grants) {
  return Object.entries(g).sort(([a], [b]) => a.localeCompare(b));
}
