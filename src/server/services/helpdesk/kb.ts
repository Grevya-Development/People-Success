import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { RequestContext } from "../../auth/context";
import { kbArticles, users } from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { forbidden, invalidState, notFound } from "../../lib/errors";
import type { KbArticleInput } from "@/lib/validation/helpdesk";
import { indexSource, nextArticleVersion, removeSource } from "./knowledge";
import { canManageHelpdesk } from "./rules";

export type KbArticleRow = typeof kbArticles.$inferSelect;

/** Everyone reads published articles; helpdesk managers also see drafts. */
export async function listKbArticles(ctx: RequestContext) {
  const manage = canManageHelpdesk(ctx);
  return ctx.db((tx) =>
    tx
      .select({
        id: kbArticles.id,
        title: kbArticles.title,
        category: kbArticles.category,
        status: kbArticles.status,
        publishedAt: kbArticles.publishedAt,
        updatedAt: kbArticles.updatedAt,
        excerpt: sql<string>`left(${kbArticles.body}, 220)`,
      })
      .from(kbArticles)
      .where(manage ? undefined : eq(kbArticles.status, "published"))
      .orderBy(sql`case ${kbArticles.status} when 'published' then 0 else 1 end`, asc(kbArticles.category), asc(kbArticles.title))
      .limit(500),
  );
}

export async function getKbArticle(ctx: RequestContext, id: string) {
  const manage = canManageHelpdesk(ctx);
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select({ a: kbArticles, author: sql<string | null>`coalesce(${users.fullName}, ${users.email})` })
      .from(kbArticles)
      .leftJoin(users, eq(users.id, kbArticles.createdBy))
      .where(eq(kbArticles.id, id));
    if (!row || (!manage && row.a.status !== "published")) throw notFound("Article");
    return { ...row.a, authorName: row.author, canManage: manage };
  });
}

export async function createKbArticle(ctx: RequestContext, input: KbArticleInput) {
  if (!canManageHelpdesk(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const [a] = await tx
      .insert(kbArticles)
      .values({ tenantId: ctx.tenantId, ...input, status: "draft", createdBy: ctx.userId })
      .returning({ id: kbArticles.id });
    await audit(tx, ctx, { action: "kb_article.created", entityType: "kb_article", entityId: a.id, metadata: { title: input.title } });
    return a;
  });
}

/** Edits to a published article are reindexed in the same transaction. */
export async function updateKbArticle(ctx: RequestContext, input: KbArticleInput & { id: string }) {
  if (!canManageHelpdesk(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const [before] = await tx.select().from(kbArticles).where(eq(kbArticles.id, input.id)).for("update");
    if (!before) throw notFound("Article");
    const { id, ...fields } = input;
    const [after] = await tx.update(kbArticles).set(fields).where(eq(kbArticles.id, id)).returning();
    if (after.status === "published") {
      await indexSource(tx, ctx.tenantId, {
        sourceType: "kb_article",
        sourceId: id,
        version: await nextArticleVersion(tx, ctx.tenantId, id),
        title: after.title,
        body: after.body,
      });
    }
    await audit(tx, ctx, {
      action: "kb_article.updated",
      entityType: "kb_article",
      entityId: id,
      changes: diff({ title: before.title, category: before.category, body: before.body }, { title: after.title, category: after.category, body: after.body }),
    });
    return { id };
  });
}

export async function publishKbArticle(ctx: RequestContext, id: string) {
  if (!canManageHelpdesk(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const [a] = await tx.select().from(kbArticles).where(eq(kbArticles.id, id)).for("update");
    if (!a) throw notFound("Article");
    if (a.status === "published") return { id };
    const [after] = await tx.update(kbArticles).set({ status: "published", publishedAt: new Date() }).where(eq(kbArticles.id, id)).returning();
    const chunks = await indexSource(tx, ctx.tenantId, {
      sourceType: "kb_article",
      sourceId: id,
      version: await nextArticleVersion(tx, ctx.tenantId, id),
      title: after.title,
      body: after.body,
    });
    await audit(tx, ctx, { action: "kb_article.published", entityType: "kb_article", entityId: id, changes: diff({ status: a.status }, { status: "published" }), metadata: { chunks } });
    return { id, chunks };
  });
}

export async function unpublishKbArticle(ctx: RequestContext, id: string) {
  if (!canManageHelpdesk(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const [a] = await tx.select().from(kbArticles).where(eq(kbArticles.id, id)).for("update");
    if (!a) throw notFound("Article");
    if (a.status !== "published") throw invalidState("This article is not published.");
    await tx.update(kbArticles).set({ status: "draft" }).where(eq(kbArticles.id, id));
    await removeSource(tx, ctx.tenantId, "kb_article", id);
    await audit(tx, ctx, { action: "kb_article.unpublished", entityType: "kb_article", entityId: id, changes: diff({ status: a.status }, { status: "draft" }) });
    return { id };
  });
}

export async function deleteKbArticle(ctx: RequestContext, id: string) {
  if (!canManageHelpdesk(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const [a] = await tx.select().from(kbArticles).where(eq(kbArticles.id, id)).for("update");
    if (!a) throw notFound("Article");
    if (a.status === "published") throw invalidState("Unpublish the article before deleting it.");
    await removeSource(tx, ctx.tenantId, "kb_article", id);
    await tx.delete(kbArticles).where(eq(kbArticles.id, id));
    await audit(tx, ctx, { action: "kb_article.deleted", entityType: "kb_article", entityId: id, metadata: { title: a.title } });
    return { id };
  });
}

export const recentKbArticles = (ctx: RequestContext, limit = 5) =>
  ctx.db((tx) =>
    tx
      .select({ id: kbArticles.id, title: kbArticles.title, category: kbArticles.category })
      .from(kbArticles)
      .where(eq(kbArticles.status, "published"))
      .orderBy(desc(kbArticles.publishedAt))
      .limit(limit),
  );
