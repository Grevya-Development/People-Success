"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LEAVE_STATUSES } from "@/lib/validation/time";

const ALL = "__all__";

export function RequestFilters({ types }: { types: { value: string; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    start(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const active = ["status", "leaveTypeId", "from", "to", "q"].some((k) => params.get(k));
  return (
    <div className={cn("mb-4 flex flex-wrap items-center gap-2", pending && "opacity-60")}>
      <Input
        placeholder="Search employee"
        defaultValue={params.get("q") ?? ""}
        className="h-8 w-48"
        onKeyDown={(e) => {
          if (e.key === "Enter") set({ q: (e.target as HTMLInputElement).value.trim() || null });
        }}
        onBlur={(e) => {
          if ((e.target.value.trim() || null) !== params.get("q")) set({ q: e.target.value.trim() || null });
        }}
        aria-label="Search employee"
      />
      <Select value={params.get("status") ?? ALL} onValueChange={(v) => set({ status: v === ALL ? null : v })}>
        <SelectTrigger className="h-8 w-36" aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any status</SelectItem>
          {LEAVE_STATUSES.map((s) => (
            <SelectItem key={s} value={s} className="capitalize">
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={params.get("leaveTypeId") ?? ALL} onValueChange={(v) => set({ leaveTypeId: v === ALL ? null : v })}>
        <SelectTrigger className="h-8 w-44" aria-label="Leave type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All leave types</SelectItem>
          {types.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input type="date" aria-label="From" className="h-8 w-auto" defaultValue={params.get("from") ?? ""} onChange={(e) => set({ from: e.target.value || null })} />
      <span className="text-sm text-muted-foreground">to</span>
      <Input type="date" aria-label="To" className="h-8 w-auto" defaultValue={params.get("to") ?? ""} onChange={(e) => set({ to: e.target.value || null })} />
      {active ? (
        <Button variant="ghost" size="sm" onClick={() => start(() => router.push(`${pathname}?tab=requests`, { scroll: false }))}>
          <X /> Clear
        </Button>
      ) : null}
    </div>
  );
}
