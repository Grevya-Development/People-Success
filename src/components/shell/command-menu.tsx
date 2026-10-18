"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, User } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { NavIcon } from "./nav-icon";
import type { NavIcon as NavIconName } from "@/lib/navigation";
import { globalSearchAction, type SearchHit } from "@/app/(app)/shell-actions";

export type CommandLink = { label: string; href: string; icon: NavIconName; group: string };

export function CommandMenu({ links }: { links: CommandLink[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pending, start] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => {
      start(async () => {
        const res = await globalSearchAction({ q });
        setHits(res.ok ? res.data : []);
      });
    }, 160);
    return () => clearTimeout(t);
  }, [query]);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  const visibleHits = query.trim().length >= 2 ? hits : [];

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="w-9 justify-start gap-2 px-2 text-muted-foreground sm:w-56"
        aria-label="Search"
      >
        <Search className="size-3.5" />
        <span className="hidden flex-1 text-left font-normal sm:inline">Search people and pages</span>
        <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search employees and pages">
        <Command shouldFilter={false}>
        <CommandInput placeholder="Search employees, pages…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>{pending ? <Spinner className="mx-auto" /> : "No results."}</CommandEmpty>
          {visibleHits.length ? (
            <CommandGroup heading="People">
              {visibleHits.map((h) => (
                <CommandItem key={h.id} value={`person-${h.id}`} onSelect={() => go(h.href)}>
                  <User className="size-4 text-muted-foreground" />
                  <span className="truncate">{h.title}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">{h.subtitle}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          <CommandGroup heading="Go to">
            {links
              .filter((l) => !query.trim() || l.label.toLowerCase().includes(query.trim().toLowerCase()))
              .map((l) => (
                <CommandItem key={l.href} value={`page-${l.href}`} onSelect={() => go(l.href)}>
                  <NavIcon name={l.icon} className="size-4 text-muted-foreground" />
                  {l.label}
                  <span className="ml-auto text-xs text-muted-foreground">{l.group}</span>
                </CommandItem>
              ))}
          </CommandGroup>
        </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
