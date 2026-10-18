"use client";

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { initials } from "@/lib/format";

export type ChartNode = {
  id: string;
  displayName: string;
  employeeCode: string;
  designation: string | null;
  department: string | null;
  managerId: string | null;
  status: "pending" | "active" | "on_notice" | "exited";
  directReports: number;
};

/** Levels shown expanded initially (roots + two levels of reports). */
const INITIAL_DEPTH = 2;
const MAX_MATCHES = 8;

type Index = {
  byId: Map<string, ChartNode>;
  children: Map<string, ChartNode[]>;
  roots: ChartNode[];
  depth: Map<string, number>;
};

function buildIndex(nodes: ChartNode[]): Index {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, ChartNode[]>();
  const roots: ChartNode[] = [];
  for (const n of nodes) {
    if (n.managerId && byId.has(n.managerId) && n.managerId !== n.id) {
      const list = children.get(n.managerId);
      if (list) list.push(n);
      else children.set(n.managerId, [n]);
    } else roots.push(n);
  }
  // Leaders with the largest teams first, then alphabetical.
  const sort = (a: ChartNode, b: ChartNode) => b.directReports - a.directReports || a.displayName.localeCompare(b.displayName);
  roots.sort(sort);
  for (const list of children.values()) list.sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Depths via BFS (guards against any accidental cycle with a visited set).
  const depth = new Map<string, number>();
  const queue: [ChartNode, number][] = roots.map((r) => [r, 0]);
  for (let i = 0; i < queue.length; i++) {
    const [n, d] = queue[i];
    if (depth.has(n.id)) continue;
    depth.set(n.id, d);
    for (const c of children.get(n.id) ?? []) queue.push([c, d + 1]);
  }
  return { byId, children, roots, depth };
}

function ancestorsOf(index: Index, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cur = index.byId.get(id);
  while (cur?.managerId && index.byId.has(cur.managerId) && !seen.has(cur.managerId)) {
    seen.add(cur.managerId);
    out.push(cur.managerId);
    cur = index.byId.get(cur.managerId);
  }
  return out;
}

export function OrgChart({ nodes }: { nodes: ChartNode[] }) {
  const index = useMemo(() => buildIndex(nodes), [nodes]);
  const initiallyExpanded = useMemo(() => {
    const s = new Set<string>();
    for (const [id, d] of index.depth) if (d < INITIAL_DEPTH && index.children.has(id)) s.add(id);
    return s;
  }, [index]);
  const [expanded, setExpanded] = useState<Set<string>>(initiallyExpanded);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [highlight, setHighlight] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: ChartNode[] = [];
    for (const n of nodes) {
      if (
        n.displayName.toLowerCase().includes(q) ||
        n.employeeCode.toLowerCase().includes(q) ||
        n.designation?.toLowerCase().includes(q)
      ) {
        out.push(n);
        if (out.length >= MAX_MATCHES) break;
      }
    }
    return out;
  }, [deferredQuery, nodes]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const reveal = (id: string) => {
    setExpanded((prev) => new Set([...prev, ...ancestorsOf(index, id)]));
    setHighlight(id);
    setQuery("");
  };

  useEffect(() => {
    if (!highlight) return;
    const el = treeRef.current?.querySelector<HTMLElement>(`[data-node="${highlight}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
  }, [highlight, expanded]);

  const managers = index.children.size;

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches[0]) {
                e.preventDefault();
                reveal(matches[0].id);
              }
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Find a person, code or title"
            aria-label="Find a person in the org chart"
            aria-controls="org-chart-matches"
            className="pl-8"
          />
          {matches.length ? (
            <ul id="org-chart-matches" role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border bg-popover shadow-md">
              {matches.map((m) => (
                <li key={m.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onClick={() => reveal(m.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    <span className="truncate font-medium">{m.displayName}</span>
                    <span className="truncate text-xs text-muted-foreground">{[m.designation, m.department].filter(Boolean).join(" · ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : deferredQuery.trim().length >= 2 ? (
            <p className="absolute inset-x-0 top-full z-20 mt-1 rounded-lg border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-md">No one matches “{deferredQuery.trim()}”.</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular">
            {nodes.length} people · {managers} managers · {index.roots.length} at top level
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded(new Set(index.children.keys()))}
            title="Expand everyone"
          >
            <ChevronsUpDown data-icon="inline-start" /> Expand all
          </Button>
          <Button variant="outline" size="sm" onClick={() => setExpanded(new Set())} title="Collapse to top level">
            <ChevronsDownUp data-icon="inline-start" /> Collapse
          </Button>
        </div>
      </div>
      <div ref={treeRef} role="tree" aria-label="Organization chart" className="max-h-[70vh] overflow-auto px-2 py-2">
        {index.roots.map((r) => (
          <TreeNode key={r.id} node={r} index={index} level={1} expanded={expanded} toggle={toggle} highlight={highlight} />
        ))}
      </div>
    </div>
  );
}

const TreeNode = memo(function TreeNode({
  node,
  index,
  level,
  expanded,
  toggle,
  highlight,
}: {
  node: ChartNode;
  index: Index;
  level: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
  highlight: string | null;
}) {
  const kids = index.children.get(node.id);
  const open = !!kids && expanded.has(node.id);
  const subtitle = [node.designation, node.department].filter(Boolean).join(" · ");

  return (
    <div role="treeitem" aria-expanded={kids ? open : undefined} aria-level={level} aria-selected={highlight === node.id} data-node={node.id}>
      <div
        className={cn(
          "group flex items-center gap-2 rounded-lg py-1.5 pr-2 transition-colors hover:bg-muted/50",
          highlight === node.id && "bg-brand-soft hover:bg-brand-soft",
        )}
        style={{ paddingLeft: `${Math.min(level - 1, 12) * 20 + 4}px` }}
      >
        {kids ? (
          <button
            type="button"
            onClick={() => toggle(node.id)}
            aria-label={`${open ? "Collapse" : "Expand"} ${node.displayName}'s team`}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden />
        )}
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground" aria-hidden>
          {initials(node.displayName)}
        </span>
        <div className="min-w-0 flex-1">
          <Link href={`/employees/${node.id}`} className="block truncate text-sm font-medium hover:underline focus-visible:underline focus-visible:outline-none">
            {node.displayName}
          </Link>
          {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {node.status !== "active" ? <StatusBadge status={node.status} label={node.status === "pending" ? "Joining" : undefined} /> : null}
        {node.directReports ? (
          <span className="tabular shrink-0 rounded-full bg-muted px-2 text-[11.5px] leading-5 text-muted-foreground" title={`${node.directReports} direct reports`}>
            {node.directReports}
          </span>
        ) : null}
      </div>
      {open ? (
        <div role="group" className="relative">
          {kids!.map((c) => (
            <TreeNode key={c.id} node={c} index={index} level={level + 1} expanded={expanded} toggle={toggle} highlight={highlight} />
          ))}
        </div>
      ) : null}
    </div>
  );
});
