"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PERIODS } from "@/lib/periods";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";


export function PeriodSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <Select
      value={params.get("period") ?? "3m"}
      onValueChange={(v) =>
        start(() => {
          const next = new URLSearchParams(params.toString());
          next.set("period", v);
          router.replace(`${pathname}?${next.toString()}`, { scroll: false });
        })
      }
    >
      <SelectTrigger size="sm" className="w-48" aria-label="Period" disabled={pending}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERIODS.map((p) => (
          <SelectItem key={p.value} value={p.value}>
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
