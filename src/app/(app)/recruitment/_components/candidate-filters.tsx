"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FolderPlus, Search, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField, TextareaField } from "@/components/forms/fields";
import { CANDIDATE_SOURCES, SOURCE_LABELS, talentPoolSchema } from "@/lib/validation/recruitment";
import { createPoolAction } from "../actions";

const ALL = "__all__";

export function CandidateFilters({ pools, tags, canManage }: { pools: { value: string; label: string }[]; tags: string[]; canManage: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    next.set("tab", "candidates");
    for (const [k, v] of Object.entries(patch)) {
      if (!v || v === ALL) next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  useEffect(() => {
    if ((params.get("q") ?? "") === q) return;
    const t = setTimeout(() => push({ q: q.trim() || null }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const hasFilters = ["q", "source", "tag", "pool"].some((k) => params.get(k));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <InputGroup className="w-full sm:w-72">
        <InputGroupAddon>{pending ? <Spinner /> : <Search />}</InputGroupAddon>
        <InputGroupInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" aria-label="Search candidates" />
      </InputGroup>
      <Select value={params.get("source") ?? ALL} onValueChange={(v) => push({ source: v })}>
        <SelectTrigger size="sm" className="w-40" aria-label="Source">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All sources</SelectItem>
          {CANDIDATE_SOURCES.map((s) => (
            <SelectItem key={s} value={s}>
              {SOURCE_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {tags.length ? (
        <Select value={params.get("tag") ?? ALL} onValueChange={(v) => push({ tag: v })}>
          <SelectTrigger size="sm" className="w-40" aria-label="Tag">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All tags</SelectItem>
            {tags.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {pools.length ? (
        <Select value={params.get("pool") ?? ALL} onValueChange={(v) => push({ pool: v })}>
          <SelectTrigger size="sm" className="w-48" aria-label="Talent pool">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All talent pools</SelectItem>
            {pools.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            push({ q: null, source: null, tag: null, pool: null });
          }}
        >
          <X /> Clear
        </Button>
      ) : null}
      {canManage ? (
        <FormDialog
          trigger={
            <Button variant="ghost" size="sm">
              <FolderPlus /> New talent pool
            </Button>
          }
          title="New talent pool"
          description="Group candidates you may want for future roles. Add people from their profile."
          schema={talentPoolSchema}
          defaultValues={{ name: "", description: "" }}
          action={createPoolAction}
          submitLabel="Create pool"
          successMessage="Talent pool created"
        >
          {(form) => (
            <>
              <TextField control={form.control} name="name" label="Name" required />
              <TextareaField control={form.control} name="description" label="Description" rows={2} />
            </>
          )}
        </FormDialog>
      ) : null}
    </div>
  );
}
