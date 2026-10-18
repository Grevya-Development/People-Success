import type { Metadata } from "next";
import { Suspense } from "react";
import { Bot, ShieldCheck } from "lucide-react";
import { NoAccess, Page, PageHeader, Reveal, Section, TableSkeleton } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, requireContext } from "@/server/auth/context";
import { aiOverview } from "@/server/services/ai-admin";
import { formatDateTime, formatNumber } from "@/lib/format";
import { AgentConfigButton } from "./agent-config";

export const metadata: Metadata = { title: "AI agents" };

export default function AgentsPage() {
  return (
    <Page>
      <PageHeader
        title="AI agents"
        description="Assistants that summarize, explain and draft. They never make hiring, pay or employment decisions, and every run is logged with its cost."
      />
      <Suspense fallback={<TableSkeleton rows={10} columns={6} />}>
        <Body />
      </Suspense>
    </Page>
  );
}

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

async function Body() {
  const ctx = await requireContext();
  if (!can(ctx, "ai.manage", "all")) return <NoAccess />;
  const data = await aiOverview(ctx);
  const p = data.provider;
  return (
    <Reveal className="space-y-6">
      <section className={`flex flex-col gap-2 rounded-xl border p-4 sm:flex-row sm:items-center ${p.configured ? "bg-card" : "bg-warning-soft/50"}`}>
        <Bot className="size-5 text-muted-foreground" aria-hidden />
        <div className="flex-1 text-sm">
          {p.configured ? (
            <>
              Connected to <span className="font-medium capitalize">{p.provider}</span> · default model <span className="font-mono text-xs">{p.model}</span>
            </>
          ) : (
            <>
              <span className="font-medium">AI provider not configured.</span> Features use rule-based results ({p.reason}). Set AI_PROVIDER and an API key in the server environment to enable models.
            </>
          )}
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" /> Prompts are not stored; only hashes, token counts and cost.
        </span>
      </section>

      <Section title="Agents" description="Usage is for the current calendar month (UTC).">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Agent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Runs</TableHead>
                <TableHead className="text-right">Tokens (in / out)</TableHead>
                <TableHead className="text-right">Cost / budget</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.agents.map((a) => (
                <TableRow key={a.key}>
                  <TableCell className="min-w-64">
                    <p className="font-medium">{a.name}</p>
                    <p className="line-clamp-1 text-xs text-muted-foreground">{a.description}</p>
                    {a.approvalTools.length ? <p className="mt-0.5 text-[11px] text-muted-foreground">Needs human approval for: {a.approvalTools.join(", ").replace(/_/g, " ")}</p> : null}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={a.enabled ? "active" : "disabled"} label={a.enabled ? "On" : "Off"} tone={a.enabled ? "success" : "neutral"} />
                  </TableCell>
                  <TableCell className="text-right tabular">
                    {a.usage.runs}
                    {a.usage.failed ? <span className="block text-xs text-danger">{a.usage.failed} failed/blocked</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular text-muted-foreground">
                    {formatNumber(a.usage.inputTokens)} / {formatNumber(a.usage.outputTokens)}
                  </TableCell>
                  <TableCell className="text-right tabular">
                    {usd(a.usage.costUsd)} <span className="text-muted-foreground">/ ${a.monthlyBudgetUsd}</span>
                  </TableCell>
                  <TableCell>
                    <AgentConfigButton agent={{ key: a.key, name: a.name, enabled: a.enabled, monthlyBudgetUsd: a.monthlyBudgetUsd, model: a.model, instructions: a.instructions }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title="Recent executions">
        {data.recent.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>When</TableHead>
                  <TableHead>Agent / task</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Model · prompt</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recent.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular">{formatDateTime(r.createdAt)}</TableCell>
                    <TableCell>
                      {r.agentKey.replace(/_/g, " ")}
                      <span className="block text-xs text-muted-foreground">{r.task}{r.userName ? ` · ${r.userName}` : ""}</span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status === "succeeded" ? "done" : r.status} label={r.status} />
                      {r.error ? <span className="block max-w-56 truncate text-xs text-muted-foreground">{r.error}</span> : null}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {r.model}
                      <span className="block">{r.promptVersion}</span>
                    </TableCell>
                    <TableCell className="text-right tabular text-muted-foreground">{r.latencyMs != null ? `${(r.latencyMs / 1000).toFixed(1)}s` : "—"}</TableCell>
                    <TableCell className="text-right tabular">{usd(r.costUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No AI runs yet.</p>
        )}
      </Section>
    </Reveal>
  );
}
