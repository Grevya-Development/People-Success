import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "../db/client";
import { notifications } from "../db/schema";
import type { RequestContext } from "../auth/context";

export type NotifyInput = {
  tenantId: string;
  userIds: string[];
  category: string;
  title: string;
  /** Keep confidential values (salary, ids) out of the body; link to the record. */
  body?: string | null;
  href?: string | null;
  dedupeKey?: string | null;
};

/** Insert in-app notifications. Duplicate dedupe keys per user are ignored. */
export async function notify(tx: Tx, input: NotifyInput) {
  const userIds = [...new Set(input.userIds.filter(Boolean))];
  if (!userIds.length) return;
  await tx
    .insert(notifications)
    .values(
      userIds.map((userId) => ({
        tenantId: input.tenantId,
        userId,
        category: input.category,
        title: input.title,
        body: input.body ?? null,
        href: input.href ?? null,
        dedupeKey: input.dedupeKey ?? null,
      })),
    )
    .onConflictDoNothing();
}

export type NotificationItem = {
  id: string;
  category: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

export async function listNotifications(ctx: RequestContext, limit = 30) {
  return ctx.db(async (tx) => {
    const [items, [{ unread }]] = await Promise.all([
      tx
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, ctx.userId), eq(notifications.tenantId, ctx.tenantId)))
        .orderBy(desc(notifications.createdAt))
        .limit(limit),
      tx
        .select({ unread: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, ctx.userId), eq(notifications.tenantId, ctx.tenantId), isNull(notifications.readAt))),
    ]);
    return {
      unread,
      items: items.map<NotificationItem>((n) => ({
        id: n.id,
        category: n.category,
        title: n.title,
        body: n.body,
        href: n.href,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  });
}

export async function markNotificationsRead(ctx: RequestContext, ids: string[] | "all") {
  await ctx.db((tx) =>
    tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, ctx.userId),
          eq(notifications.tenantId, ctx.tenantId),
          isNull(notifications.readAt),
          ids === "all" ? undefined : inArray(notifications.id, ids),
        ),
      ),
  );
}
