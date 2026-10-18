import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { BookOpen, Plus } from "lucide-react";
import { EmptyState, ErrorState, Reveal, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import type { RequestContext } from "@/server/auth/context";
import { logger } from "@/server/lib/logger";
import { listKbArticles } from "@/server/services/helpdesk/kb";
import { knowledgeStatus, type KnowledgeStatus } from "@/server/services/helpdesk/knowledge";
import { canManageHelpdesk } from "@/server/services/helpdesk/rules";
import { formatDateTime, titleCase } from "@/lib/format";
import { ReindexButton } from "./reindex-button";

export async function KnowledgeBase({ ctx }: { ctx: RequestContext }) {
  const manage = canManageHelpdesk(ctx);
  let articles: Awaited<ReturnType<typeof listKbArticles>>;
  let status: KnowledgeStatus | null = null;
  try {
    [articles, status] = await Promise.all([listKbArticles(ctx), manage ? knowledgeStatus(ctx) : Promise.resolve(null)]);
  } catch (err) {
    unstable_rethrow(err);
    logger.error("helpdesk.kb_failed", { err });
    return <ErrorState title="Could not load the knowledge base" />;
  }

  const groups = new Map<string, typeof articles>();
  for (const a of articles) groups.set(a.category, [...(groups.get(a.category) ?? []), a]);

  return (
    <Reveal className="space-y-5">
      {manage && status ? (
        <Section
          title="Assistant knowledge index"
          description="The HR assistant and draft replies only use published policies and published articles. Articles are indexed when published; policies are synced nightly, before assistant answers when they changed, or with Reindex."
          actions={<ReindexButton />}
        >
          <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
            {[
              ["Published policies", status.publishedPolicies],
              ["Published articles", status.publishedArticles],
              ["Indexed sources", status.sources.length],
              ["Indexed sections", status.sources.reduce((s, x) => s + x.chunks, 0)],
            ].map(([label, value]) => (
              <div key={label} className="bg-card px-5 py-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-lg font-semibold tabular">{value}</dd>
              </div>
            ))}
          </dl>
          {status.sources.length ? (
            <details className="border-t px-5 py-3 text-sm">
              <summary className="cursor-pointer text-muted-foreground">Indexed sources</summary>
              <ul className="mt-2 space-y-1">
                {status.sources.map((s) => (
                  <li key={`${s.sourceType}:${s.sourceId}`} className="flex flex-wrap justify-between gap-2">
                    <span>
                      {s.title} <span className="text-xs text-muted-foreground">· {s.sourceType === "policy" ? "Policy" : "Article"} v{s.version}</span>
                    </span>
                    <span className="text-xs text-muted-foreground tabular">
                      {s.chunks} sections · {formatDateTime(s.indexedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Section>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Articles</h2>
        {manage ? (
          <Button asChild size="sm">
            <Link href="/helpdesk/kb/new">
              <Plus data-icon="inline-start" /> New article
            </Link>
          </Button>
        ) : null}
      </div>
      {articles.length ? (
        <div className="grid gap-5 md:grid-cols-2">
          {[...groups.entries()].map(([category, list]) => (
            <Section key={category} title={titleCase(category)}>
              <ul className="divide-y">
                {list.map((a) => (
                  <li key={a.id} className="px-5 py-3">
                    <Link href={`/helpdesk/kb/${a.id}`} className="font-medium hover:underline">
                      {a.title}
                    </Link>
                    {manage && a.status !== "published" ? <StatusBadge status={a.status} className="ml-2" /> : null}
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.excerpt.replace(/[#*_`>]/g, "")}</p>
                  </li>
                ))}
              </ul>
            </Section>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={BookOpen}
          title="No articles yet"
          description={manage ? "Write short how-to articles (e.g. downloading Form 16). Published articles are searchable by the HR assistant." : "HR hasn't published any help articles yet. Company policies are under Documents → Policies."}
        />
      )}
    </Reveal>
  );
}
