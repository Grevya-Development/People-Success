import "server-only";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { RequestContext } from "../../auth/context";
import type { Tx } from "../../db/client";
import { withSystem } from "../../db/tx";
import { kbArticles, knowledgeChunks, policies } from "../../db/schema";
import { audit } from "../../lib/audit";
import { forbidden } from "../../lib/errors";
import { canManageHelpdesk } from "./rules";

export type KnowledgeSourceType = "policy" | "kb_article";

export type Chunk = { heading: string | null; content: string };

const MAX_CHARS = 800;

function splitLong(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?\n]+[.!?]*\s*/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (s.length > max) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim());
      continue;
    }
    if ((cur + s).length > max && cur.trim()) {
      out.push(cur.trim());
      cur = "";
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

/**
 * Split a Markdown document into retrieval chunks of about 800 characters.
 * Chunks never cross a heading; each keeps its heading path (e.g.
 * "Leave policy › Casual leave") so citations point to the right section.
 * Paragraphs stay whole where possible; long ones split on sentences.
 */
export function chunkMarkdown(title: string, body: string, maxChars = MAX_CHARS): Chunk[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const stack: string[] = [];
  const sections: { heading: string | null; paragraphs: string[] }[] = [{ heading: null, paragraphs: [] }];
  let para: string[] = [];
  const flushPara = () => {
    const text = para.join("\n").trim();
    if (text) sections[sections.length - 1].paragraphs.push(text);
    para = [];
  };
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flushPara();
      const level = h[1].length;
      stack.length = level - 1;
      stack[level - 1] = h[2].trim();
      const path = stack.filter(Boolean);
      // Drop a leading H1 that just repeats the document title.
      const parts = path[0] && path[0].toLowerCase() === title.trim().toLowerCase() && path.length > 1 ? path.slice(1) : path;
      sections.push({ heading: parts.join(" › ") || null, paragraphs: [] });
      continue;
    }
    if (!line.trim()) flushPara();
    else para.push(line);
  }
  flushPara();

  const chunks: Chunk[] = [];
  for (const s of sections) {
    let cur = "";
    for (const p of s.paragraphs.flatMap((x) => splitLong(x, maxChars))) {
      if (cur && cur.length + p.length + 2 > maxChars) {
        chunks.push({ heading: s.heading, content: cur });
        cur = "";
      }
      cur = cur ? `${cur}\n\n${p}` : p;
    }
    if (cur) chunks.push({ heading: s.heading, content: cur });
  }
  // Untitled sections are labelled with the document title so they stay findable by it.
  return chunks.map((c) => ({ heading: c.heading ?? title, content: c.content }));
}

export type KnowledgeSource = { sourceType: KnowledgeSourceType; sourceId: string; version: number; title: string; body: string };

/** Fingerprint of what gets indexed. Must match `sourceHashSql` below. */
export const sourceHash = (title: string, body: string) => createHash("sha256").update(`${title}\n${body}`, "utf8").digest("hex");
const sourceHashSql = (title: unknown, body: unknown) => sql`encode(sha256(convert_to(${title} || chr(10) || ${body}, 'UTF8')), 'hex')`;

/** Serializes index writes per tenant so concurrent syncs never duplicate chunks. */
async function lockIndex(tx: Tx, tenantId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"knowledge:" + tenantId}))`);
}

/** Replace every chunk of one source (delete + insert, in the caller's transaction). */
export async function indexSource(tx: Tx, tenantId: string, src: KnowledgeSource) {
  await lockIndex(tx, tenantId);
  await removeSource(tx, tenantId, src.sourceType, src.sourceId);
  const chunks = chunkMarkdown(src.title, src.body);
  if (!chunks.length) return 0;
  const hash = sourceHash(src.title, src.body);
  await tx.insert(knowledgeChunks).values(
    chunks.map((c, i) => ({
      tenantId,
      sourceType: src.sourceType,
      sourceId: src.sourceId,
      sourceVersion: src.version,
      sourceTitle: src.title,
      sourceHash: hash,
      heading: c.heading,
      chunkIndex: i,
      content: c.content,
    })),
  );
  return chunks.length;
}

export async function removeSource(tx: Tx, tenantId: string, sourceType: KnowledgeSourceType, sourceId: string) {
  await tx
    .delete(knowledgeChunks)
    .where(and(eq(knowledgeChunks.tenantId, tenantId), eq(knowledgeChunks.sourceType, sourceType), eq(knowledgeChunks.sourceId, sourceId)));
}

/** Next index version for a KB article (articles have no version column). */
export async function nextArticleVersion(tx: Tx, tenantId: string, articleId: string) {
  const [row] = await tx
    .select({ v: sql<number>`coalesce(max(${knowledgeChunks.sourceVersion}), 0)`.mapWith(Number) })
    .from(knowledgeChunks)
    .where(and(eq(knowledgeChunks.tenantId, tenantId), eq(knowledgeChunks.sourceType, "kb_article"), eq(knowledgeChunks.sourceId, articleId)));
  return (row?.v ?? 0) + 1;
}

export type SyncResult = { indexed: number; removed: number; unchanged: number; chunks: number };

/**
 * Bring the index in line with published content: (re)index published
 * policies whose version or edit time is newer than their chunks, and
 * published KB articles edited since they were indexed; drop chunks of
 * anything no longer published. `force` reindexes everything. Explicit
 * tenant filters make this safe in system context too.
 */
export async function syncKnowledge(tx: Tx, tenantId: string, opts: { force?: boolean } = {}): Promise<SyncResult> {
  await lockIndex(tx, tenantId);
  const [pubPolicies, pubArticles, existing] = await Promise.all([
    tx
      .select({ id: policies.id, title: policies.title, body: policies.body, version: policies.version, updatedAt: policies.updatedAt })
      .from(policies)
      .where(and(eq(policies.tenantId, tenantId), eq(policies.status, "published"))),
    tx
      .select({ id: kbArticles.id, title: kbArticles.title, body: kbArticles.body, updatedAt: kbArticles.updatedAt })
      .from(kbArticles)
      .where(and(eq(kbArticles.tenantId, tenantId), eq(kbArticles.status, "published"))),
    tx
      .select({
        sourceType: knowledgeChunks.sourceType,
        sourceId: knowledgeChunks.sourceId,
        version: sql<number>`max(${knowledgeChunks.sourceVersion})`.mapWith(Number),
        hash: sql<string>`max(${knowledgeChunks.sourceHash})`,
      })
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.tenantId, tenantId))
      .groupBy(knowledgeChunks.sourceType, knowledgeChunks.sourceId),
  ]);
  const key = (t: string, id: string) => `${t}:${id}`;
  const have = new Map(existing.map((e) => [key(e.sourceType, e.sourceId), e]));
  const keep = new Set<string>();
  const result: SyncResult = { indexed: 0, removed: 0, unchanged: 0, chunks: 0 };

  for (const p of pubPolicies) {
    const k = key("policy", p.id);
    keep.add(k);
    const e = have.get(k);
    if (!opts.force && e && e.version === p.version && e.hash === sourceHash(p.title, p.body)) {
      result.unchanged++;
      continue;
    }
    result.chunks += await indexSource(tx, tenantId, { sourceType: "policy", sourceId: p.id, version: p.version, title: p.title, body: p.body });
    result.indexed++;
  }
  for (const a of pubArticles) {
    const k = key("kb_article", a.id);
    keep.add(k);
    const e = have.get(k);
    const changed = !e || e.hash !== sourceHash(a.title, a.body);
    if (!opts.force && !changed) {
      result.unchanged++;
      continue;
    }
    const version = changed ? (e?.version ?? 0) + 1 : e!.version;
    result.chunks += await indexSource(tx, tenantId, { sourceType: "kb_article", sourceId: a.id, version, title: a.title, body: a.body });
    result.indexed++;
  }
  for (const e of existing) {
    if (keep.has(key(e.sourceType, e.sourceId))) continue;
    await removeSource(tx, tenantId, e.sourceType as KnowledgeSourceType, e.sourceId);
    result.removed++;
  }
  return result;
}

/** "Reindex knowledge" for helpdesk managers. */
export async function reindexKnowledge(ctx: RequestContext, opts: { force?: boolean } = {}) {
  if (!canManageHelpdesk(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const r = await syncKnowledge(tx, ctx.tenantId, opts);
    await audit(tx, ctx, { action: "knowledge.reindexed", entityType: "knowledge_index", metadata: { ...r, force: !!opts.force } });
    return r;
  });
}

/** Scheduled sync (system context). */
export async function syncKnowledgeForTenant(tenantId: string) {
  return withSystem((tx) => syncKnowledge(tx, tenantId), tenantId);
}

export type KnowledgeStatus = {
  sources: { sourceType: string; sourceId: string; title: string; version: number; chunks: number; indexedAt: string }[];
  publishedPolicies: number;
  publishedArticles: number;
};

export async function knowledgeStatus(ctx: RequestContext): Promise<KnowledgeStatus> {
  if (!canManageHelpdesk(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const [rows, [pc], [ac]] = await Promise.all([
      tx
        .select({
          sourceType: knowledgeChunks.sourceType,
          sourceId: knowledgeChunks.sourceId,
          title: sql<string>`max(${knowledgeChunks.sourceTitle})`,
          version: sql<number>`max(${knowledgeChunks.sourceVersion})`.mapWith(Number),
          chunks: sql<number>`count(*)::int`,
          indexedAt: sql<string>`max(${knowledgeChunks.createdAt})`.mapWith((v) => new Date(v).toISOString()),
        })
        .from(knowledgeChunks)
        .groupBy(knowledgeChunks.sourceType, knowledgeChunks.sourceId)
        .orderBy(sql`3`),
      tx.select({ n: sql<number>`count(*)::int` }).from(policies).where(eq(policies.status, "published")),
      tx.select({ n: sql<number>`count(*)::int` }).from(kbArticles).where(eq(kbArticles.status, "published")),
    ]);
    return {
      sources: rows.map((r) => ({ ...r, chunks: Number(r.chunks) })),
      publishedPolicies: Number(pc?.n ?? 0),
      publishedArticles: Number(ac?.n ?? 0),
    };
  });
}

/** Cheap check (no lock) whether published content changed since it was indexed. */
export async function knowledgeIsStale(tx: Tx, tenantId: string) {
  const [row] = await tx.execute<{ stale: boolean }>(sql`
    select
      exists (
        select 1 from policies p
        where p.tenant_id = ${tenantId} and p.status = 'published'
          and not exists (
            select 1 from knowledge_chunks k
            where k.tenant_id = ${tenantId} and k.source_type = 'policy' and k.source_id = p.id
              and k.source_version = p.version and k.source_hash = ${sourceHashSql(sql`p.title`, sql`p.body`)}
          )
      )
      or exists (
        select 1 from kb_articles a
        where a.tenant_id = ${tenantId} and a.status = 'published'
          and not exists (
            select 1 from knowledge_chunks k
            where k.tenant_id = ${tenantId} and k.source_type = 'kb_article' and k.source_id = a.id and k.source_hash = ${sourceHashSql(sql`a.title`, sql`a.body`)}
          )
      )
      or exists (
        select 1 from knowledge_chunks k
        where k.tenant_id = ${tenantId}
          and not exists (select 1 from policies p where p.id = k.source_id and p.status = 'published')
          and not exists (select 1 from kb_articles a where a.id = k.source_id and a.status = 'published')
      ) as stale`);
  return !!row?.stale;
}
