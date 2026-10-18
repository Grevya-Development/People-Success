"use server";

import { cookies } from "next/headers";
import { updateTag } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { defineAction } from "@/server/lib/action";
import { listNotifications, markNotificationsRead } from "@/server/services/notifications";
import { TENANT_COOKIE, can } from "@/server/auth/context";
import { accessTag } from "@/server/auth/access";
import { employees, users, designations } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";

export const getNotificationsAction = defineAction({ input: z.object({}) }, async (ctx) => listNotifications(ctx));

export const markNotificationsReadAction = defineAction(
  { input: z.object({ ids: z.union([z.array(z.uuid()).max(100), z.literal("all")]) }) },
  async (ctx, { ids }) => {
    await markNotificationsRead(ctx, ids);
    return null;
  },
);

export const switchTenantAction = defineAction({ input: z.object({ tenantId: z.uuid() }) }, async (ctx, { tenantId }) => {
  if (!ctx.tenants.some((t) => t.id === tenantId)) throw new AppError("FORBIDDEN", "You are not a member of that organization.");
  (await cookies()).set(TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  await ctx.db((tx) => tx.update(users).set({ lastActiveTenantId: tenantId }).where(eq(users.id, ctx.userId)));
  updateTag(accessTag(ctx.userId));
  return null;
});

export type SearchHit = { type: "employee"; id: string; title: string; subtitle: string; href: string };

/** Command-palette search. Uses the trigram index on the employee directory. */
export const globalSearchAction = defineAction(
  { input: z.object({ q: z.string().trim().min(1).max(80) }) },
  async (ctx, { q }): Promise<SearchHit[]> => {
    if (!can(ctx, "directory.view") && !can(ctx, "employees.view")) return [];
    const term = q.replace(/[%_]/g, "");
    const rows = await ctx.db((tx) =>
      tx
        .select({
          id: employees.id,
          name: employees.displayName,
          code: employees.employeeCode,
          title: designations.title,
          status: employees.status,
        })
        .from(employees)
        .leftJoin(designations, eq(designations.id, employees.designationId))
        .where(
          and(
            isNull(employees.deletedAt),
            sql`(${employees.displayName} || ' ' || ${employees.employeeCode} || ' ' || coalesce(${employees.workEmail}, '')) ilike ${"%" + term + "%"}`,
          ),
        )
        .orderBy(sql`similarity(${employees.displayName}, ${term}) desc`, employees.displayName)
        .limit(8),
    );
    return rows.map((r) => ({
      type: "employee" as const,
      id: r.id,
      title: r.name,
      subtitle: [r.code, r.title, r.status === "exited" ? "Exited" : null].filter(Boolean).join(" · "),
      href: `/employees/${r.id}`,
    }));
  },
);
