import { and, asc, desc, eq, gte, ilike, lt, sql } from "drizzle-orm";
import { addDays } from "date-fns";
import { authorize } from "../../auth/context";
import { auditLogs, memberships, users } from "../../db/schema";
import { auditFilterSchema, type AuditFilter } from "@/lib/validation/settings";
import type { SettingsCtx } from "./shared";

export const AUDIT_PAGE_SIZE = 50;

export type AuditRow = {
  id: number;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorType: string;
  actorName: string | null;
  actorEmail: string | null;
  changes: Record<string, { from?: unknown; to?: unknown }> | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
};

/**
 * Keyset-paginated audit trail (id desc). RLS limits rows to the tenant and
 * to users holding audit.view; changes are already redacted at write time.
 */
export async function listAuditLogs(ctx: SettingsCtx, raw: Partial<AuditFilter>) {
  authorize(ctx, "audit.view", "all");
  const f = auditFilterSchema.parse(raw);
  // Date range is interpreted in India time, the product default.
  const fromTs = f.from ? new Date(`${f.from}T00:00:00+05:30`) : null;
  const toTs = f.to ? addDays(new Date(`${f.to}T00:00:00+05:30`), 1) : null;
  const term = f.action?.replace(/[%_\\]/g, "");

  return ctx.db(async (tx) => {
    const where = and(
      eq(auditLogs.tenantId, ctx.tenantId),
      f.entityType ? eq(auditLogs.entityType, f.entityType) : undefined,
      term ? ilike(auditLogs.action, `%${term}%`) : undefined,
      f.actor ? eq(auditLogs.actorUserId, f.actor) : undefined,
      fromTs && !Number.isNaN(fromTs.getTime()) ? gte(auditLogs.createdAt, fromTs) : undefined,
      toTs && !Number.isNaN(toTs.getTime()) ? lt(auditLogs.createdAt, toTs) : undefined,
      f.cursor ? lt(auditLogs.id, f.cursor) : undefined,
    );
    const rows = await tx
      .select({
        id: auditLogs.id,
        createdAt: auditLogs.createdAt,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        actorType: auditLogs.actorType,
        actorName: users.fullName,
        actorEmail: users.email,
        changes: auditLogs.changes,
        metadata: auditLogs.metadata,
        ip: sql<string | null>`host(${auditLogs.ip})`,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(where)
      .orderBy(desc(auditLogs.id))
      .limit(AUDIT_PAGE_SIZE + 1);
    const hasMore = rows.length > AUDIT_PAGE_SIZE;
    const page = rows.slice(0, AUDIT_PAGE_SIZE);
    return {
      rows: page.map<AuditRow>((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  });
}

/** Filter options: entity types present in the log and the tenant's members. */
export async function auditFilterOptions(ctx: SettingsCtx) {
  authorize(ctx, "audit.view", "all");
  return ctx.db(async (tx) => {
    const [types, actors] = await Promise.all([
      tx
        .selectDistinct({ entityType: auditLogs.entityType })
        .from(auditLogs)
        .where(eq(auditLogs.tenantId, ctx.tenantId))
        .orderBy(asc(auditLogs.entityType))
        .limit(200),
      tx
        .select({ id: users.id, name: users.fullName, email: users.email })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.tenantId, ctx.tenantId))
        .orderBy(asc(users.fullName)),
    ]);
    return {
      entityTypes: types.map((t) => t.entityType),
      actors: actors.map((a) => ({ value: a.id, label: a.name ?? a.email, hint: a.email })),
    };
  });
}
