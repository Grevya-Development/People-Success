"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";

export function BalanceSearch({ defaultValue }: { defaultValue: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  return (
    <form
      role="search"
      className={cn("relative", pending && "opacity-60")}
      onSubmit={(e) => {
        e.preventDefault();
        const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
        start(() => router.push(`${pathname}?tab=balances${q ? `&q=${encodeURIComponent(q)}` : ""}`, { scroll: false }));
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input name="q" defaultValue={defaultValue} placeholder="Search name or code" className="h-8 w-60 pl-8" aria-label="Search employees" />
    </form>
  );
}
