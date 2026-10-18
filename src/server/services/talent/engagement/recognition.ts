import { and, desc, eq, or } from "drizzle-orm";
import type { z } from "zod";
import type { RequestContext } from "../../../auth/context";
import { recognitions } from "../../../db/schema";
import { audit } from "../../../lib/audit";
import { forbidden, notFound, validation } from "../../../lib/errors";
import { notify } from "../../notifications";
import type { recognitionSchema } from "@/lib/validation/talent";
import { CURRENT_STATUSES, employeeBasics, requireEmployeeId } from "../shared";

export type RecognitionItem = {
  id: string;
  badge: string;
  message: string;
  isPublic: boolean;
  createdAt: string;
  from: { id: string; name: string };
  to: { id: string; name: string };
};

/** Public wall plus private recognitions the signed-in employee sent or received. */
export async function listRecognitions(ctx: RequestContext, limit = 60): Promise<RecognitionItem[]> {
  if (!ctx.grants["engagement.view"]) throw forbidden();
  return ctx.db(async (tx) => {
    const rows = await tx
      .select()
      .from(recognitions)
      .where(
        or(
          eq(recognitions.isPublic, true),
          ctx.employeeId ? and(eq(recognitions.isPublic, false), or(eq(recognitions.fromEmployeeId, ctx.employeeId), eq(recognitions.toEmployeeId, ctx.employeeId))) : undefined,
        ),
      )
      .orderBy(desc(recognitions.createdAt))
      .limit(limit);
    const people = await employeeBasics(tx, rows.flatMap((r) => [r.fromEmployeeId, r.toEmployeeId]));
    return rows.map((r) => ({
      id: r.id,
      badge: r.badge,
      message: r.message,
      isPublic: r.isPublic,
      createdAt: r.createdAt.toISOString(),
      from: { id: r.fromEmployeeId, name: people.get(r.fromEmployeeId)?.name ?? "Former colleague" },
      to: { id: r.toEmployeeId, name: people.get(r.toEmployeeId)?.name ?? "Former colleague" },
    }));
  });
}

export async function giveRecognition(ctx: RequestContext, input: z.output<typeof recognitionSchema>) {
  const me = requireEmployeeId(ctx);
  if (!ctx.grants["engagement.view"]) throw forbidden();
  if (input.toEmployeeId === me) throw validation("Recognize a colleague rather than yourself.", { toEmployeeId: ["Choose someone else"] });
  return ctx.db(async (tx) => {
    const people = await employeeBasics(tx, [me, input.toEmployeeId]);
    const to = people.get(input.toEmployeeId);
    if (!to || !(CURRENT_STATUSES as readonly string[]).includes(to.status)) throw notFound("Colleague");
    const [row] = await tx
      .insert(recognitions)
      .values({ tenantId: ctx.tenantId, fromEmployeeId: me, toEmployeeId: input.toEmployeeId, badge: input.badge, message: input.message, isPublic: input.isPublic })
      .returning({ id: recognitions.id });
    await audit(tx, ctx, { action: "recognition.given", entityType: "recognition", entityId: row.id, metadata: { toEmployeeId: input.toEmployeeId, badge: input.badge, isPublic: input.isPublic } });
    if (to.userId) {
      await notify(tx, {
        tenantId: ctx.tenantId,
        userIds: [to.userId],
        category: "engagement",
        title: `${people.get(me)?.name ?? "A colleague"} recognized you: ${input.badge}`,
        body: input.message.length > 140 ? `${input.message.slice(0, 137)}...` : input.message,
        href: "/engagement?tab=recognition",
        dedupeKey: `recognition:${row.id}`,
      });
    }
    return row;
  });
}
