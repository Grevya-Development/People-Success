"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { Option } from "@/server/services/employees/lookups";

const ALL = "__all__";

export function EmployeeFilters({
  departments,
  locations,
  canSeeExited,
}: {
  departments: Option[];
  locations: Option[];
  canSeeExited: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (!v || v === ALL) next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  // Debounced search-as-you-type.
  useEffect(() => {
    if ((params.get("q") ?? "") === q) return;
    const t = setTimeout(() => push({ q: q.trim() || null }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const hasFilters = ["q", "status", "departmentId", "locationId", "employmentType", "joined"].some((k) => params.get(k));

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <InputGroup className="w-full sm:w-72">
        <InputGroupAddon>{pending ? <Spinner /> : <Search />}</InputGroupAddon>
        <InputGroupInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, code, email, title"
          aria-label="Search employees"
        />
      </InputGroup>
      <Select value={params.get("status") ?? "current"} onValueChange={(v) => push({ status: v === "current" ? null : v })}>
        <SelectTrigger size="sm" className="w-36" aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="current">Current</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="pending">Pre-joining</SelectItem>
          <SelectItem value="on_notice">On notice</SelectItem>
          {canSeeExited ? <SelectItem value="exited">Exited</SelectItem> : null}
          {canSeeExited ? <SelectItem value="all">All</SelectItem> : null}
        </SelectContent>
      </Select>
      <Select value={params.get("departmentId") ?? ALL} onValueChange={(v) => push({ departmentId: v })}>
        <SelectTrigger size="sm" className="w-44" aria-label="Department">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All departments</SelectItem>
          {departments.map((d) => (
            <SelectItem key={d.value} value={d.value}>
              {d.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={params.get("locationId") ?? ALL} onValueChange={(v) => push({ locationId: v })}>
        <SelectTrigger size="sm" className="w-40" aria-label="Location">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All locations</SelectItem>
          {locations.map((l) => (
            <SelectItem key={l.value} value={l.value}>
              {l.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            start(() => router.replace(pathname, { scroll: false }));
          }}
        >
          <X /> Clear
        </Button>
      ) : null}
    </div>
  );
}
