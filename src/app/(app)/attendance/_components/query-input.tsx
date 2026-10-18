"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "cn";
import { Input } from "@/components/ui/input";

/** Date or month input bound to a query parameter. */
export function QueryInput({ name, value, type, label, className }: { name: string; value: string; type: "date" | "month"; label: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <label className={cn("flex items-center gap-2 text-sm text-muted-foreground", pending && "opacity-60", className)}>
      <span className="shrink-0">{label}</span>
      <Input
        type={type}
        defaultValue={value}
        className="h-8 w-auto"
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          const next = new URLSearchParams(params.toString());
          next.set(name, v);
          start(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
        }}
      />
    </label>
  );
}
