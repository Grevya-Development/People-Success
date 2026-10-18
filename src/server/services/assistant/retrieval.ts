import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "../../db/client";

export type RetrievedChunk = {
  id: string;
  sourceType: "policy" | "kb_article";
  sourceId: string;
  sourceVersion: number;
  sourceTitle: string;
  heading: string | null;
  content: string;
  /** ts_rank_cd against the relaxed (OR) query. */
  rank: number;
  /** Share of the question's meaningful terms found in the chunk (0–1). */
  coverage: number;
  /** Matched the full websearch_to_tsquery (every term present). */
  strict: boolean;
};

/** Below this, a chunk is noise rather than evidence. */
const MIN_COVERAGE = 0.25;

/** A match good enough to quote back without an AI model. */
export const isStrongMatch = (c: Pick<RetrievedChunk, "strict" | "coverage">) => c.strict || c.coverage >= 0.5;

/**
 * Full-text search over the tenant's knowledge chunks (published policies
 * and KB articles only — nothing else is ever indexed). Runs in the caller's
 * transaction: in a request that is the user's RLS-scoped context; the
 * explicit tenant filter keeps it safe in system context too.
 *
 * Ranking: chunks matching websearch_to_tsquery (all terms) first, then by
 * the share of question terms they contain, then ts_rank_cd. The relaxed OR
 * query keeps natural questions ("how many days of paternity leave do I
 * get?") from failing just because one word is missing from the policy.
 */
export async function searchKnowledge(tx: Tx, tenantId: string, question: string, limit = 6): Promise<RetrievedChunk[]> {
  const q = question.slice(0, 1000);
  const lexRows = await tx.execute<{ lexeme: string }>(sql`select lexeme from unnest(to_tsvector('english', ${q}))`);
  const lexemes = [...new Set(lexRows.map((r) => r.lexeme).filter((l) => /^[a-z0-9]{2,40}$/.test(l)))].slice(0, 24);
  if (!lexemes.length) return [];
  const orQuery = lexemes.join(" | ");
  const lexList = lexemes.join(",");

  const rows = await tx.execute<{
    id: string;
    source_type: "policy" | "kb_article";
    source_id: string;
    source_version: number;
    source_title: string;
    heading: string | null;
    content: string;
    rank: number;
    coverage: number;
    strict: boolean;
  }>(sql`
    select c.id, c.source_type, c.source_id, c.source_version, c.source_title, c.heading, c.content,
      ts_rank_cd(c.tsv, to_tsquery('simple', ${orQuery})) as rank,
      coalesce(c.tsv @@ websearch_to_tsquery('english', ${q}), false) as strict,
      (select count(*) from unnest(string_to_array(${lexList}, ',')) l where c.tsv @@ to_tsquery('simple', l))::float
        / ${lexemes.length} as coverage
    from knowledge_chunks c
    where c.tenant_id = ${tenantId}
      and c.tsv @@ to_tsquery('simple', ${orQuery})
    order by strict desc, coverage desc, rank desc, c.chunk_index asc
    limit ${limit * 2}`);

  return rows
    .map((r) => ({
      id: r.id,
      sourceType: r.source_type,
      sourceId: r.source_id,
      sourceVersion: Number(r.source_version),
      sourceTitle: r.source_title,
      heading: r.heading,
      content: r.content,
      rank: Number(r.rank),
      coverage: Number(r.coverage),
      strict: !!r.strict,
    }))
    .filter((r) => r.strict || r.coverage >= MIN_COVERAGE)
    .slice(0, limit);
}
