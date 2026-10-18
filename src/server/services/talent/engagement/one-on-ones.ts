import { desc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { RequestContext } from "../../../auth/context";
import { employees, oneOnOnes } from "../../../db/schema";
import { audit } from "../../../lib/audit";
import { forbidden, notFound } from "../../../lib/errors";
import { notify } from "../../notifications";
import type { oneOnOneSchema } from "@/lib/validation/talent";
import { employeeBasics, requireEmployeeId } from "../shared";

/**
 * 1:1s are visible only to the manager and the report (enforced by RLS and
 * here). Agenda and notes are private: they are never written to audit logs
 * or notifications, only the fact that a meeting was recorded.
 */

export type OneOnOneItem = {
  id: string;
  heldOn: string;
  agenda: string | null;
  notes: string | null;
  actionItems: { text: string; owner: "manager" | "employee"; done: boolean }[];
  managerEmployeeId: string;
  employeeId: string;
  counterpart: { id: string; name: string };
  iAmManager: boolean;
};

export async function listOneOnOnes(ctx: RequestContext): Promise<OneOnOneItem[]> {
  if (!ctx.employeeId) return [];
  const me = ctx.employeeId;
  return ctx.db(async (tx) => {
    const rows = await tx.select().from(oneOnOnes).orderBy(desc(oneOnOnes.heldOn)).limit(300);
    const mine = rows.filter((r) => r.managerEmployeeId === me || r.employeeId === me);
    const people = await employeeBasics(tx, mine.flatMap((r) => [r.managerEmployeeId, r.employeeId]));
    return mine.map((r) => {
      const iAmManager = r.managerEmployeeId === me;
      const otherId = iAmManager ? r.employeeId : r.managerEmployeeId;
      return {
        id: r.id,
        heldOn: r.heldOn,
        agenda: r.agenda,
        notes: r.notes,
        actionItems: r.actionItems,
        managerEmployeeId: r.managerEmployeeId,
        employeeId: r.employeeId,
        counterpart: { id: otherId, name: people.get(otherId)?.name ?? "Unknown" },
        iAmManager,
      };
    });
  });
}

/** People the signed-in employee can hold 1:1s with: their manager and direct reports. */
export async function oneOnOnePartners(ctx: RequestContext) {
  if (!ctx.employeeId) return [];
  const me = ctx.employeeId;
  return ctx.db(async (tx) => {
    const [self] = await tx.select({ managerId: employees.managerId }).from(employees).where(eq(employees.id, me));
    const reports = await tx
      .select({ id: employees.id, name: employees.displayName, status: employees.status, deletedAt: employees.deletedAt })
      .from(employees)
      .where(eq(employees.managerId, me));
    const out: { value: string; label: string; hint: string }[] = [];
    if (self?.managerId) {
      const m = (await employeeBasics(tx, [self.managerId])).get(self.managerId);
      if (m) out.push({ value: m.id, label: m.name, hint: "My manager" });
    }
    for (const r of reports) if (!r.deletedAt && (r.status === "active" || r.status === "on_notice")) out.push({ value: r.id, label: r.name, hint: "Direct report" });
    return out;
  });
}

export async function saveOneOnOne(ctx: RequestContext, input: z.output<typeof oneOnOneSchema>) {
  const me = requireEmployeeId(ctx);
  return ctx.db(async (tx) => {
    const people = await employeeBasics(tx, [me, input.withEmployeeId]);
    const other = people.get(input.withEmployeeId);
    const self = people.get(me);
    if (!other || !self) throw notFound("Employee");
    let managerEmployeeId: string;
    let employeeId: string;
    if (other.managerId === me) [managerEmployeeId, employeeId] = [me, other.id];
    else if (self.managerId === other.id) [managerEmployeeId, employeeId] = [other.id, me];
    else throw forbidden("1:1s are between a manager and a direct report.");

    const values = { heldOn: input.heldOn, agenda: input.agenda, notes: input.notes, actionItems: input.actionItems };
    if (input.id) {
      const [before] = await tx.select().from(oneOnOnes).where(eq(oneOnOnes.id, input.id)).for("update");
      if (!before || (before.managerEmployeeId !== me && before.employeeId !== me)) throw notFound("1:1");
      if (before.managerEmployeeId !== managerEmployeeId || before.employeeId !== employeeId) throw forbidden("A 1:1 cannot be moved to someone else.");
      await tx.update(oneOnOnes).set(values).where(eq(oneOnOnes.id, before.id));
      await audit(tx, ctx, { action: "one_on_one.updated", entityType: "one_on_one", entityId: before.id, metadata: { heldOn: input.heldOn, actionItems: input.actionItems.length } });
      return { id: before.id };
    }
    const [row] = await tx.insert(oneOnOnes).values({ tenantId: ctx.tenantId, managerEmployeeId, employeeId, ...values }).returning({ id: oneOnOnes.id });
    await audit(tx, ctx, { action: "one_on_one.created", entityType: "one_on_one", entityId: row.id, metadata: { heldOn: input.heldOn } });
    if (other.userId) {
      await notify(tx, {
        tenantId: ctx.tenantId,
        userIds: [other.userId],
        category: "engagement",
        title: `1:1 with ${self.name} on ${input.heldOn}`,
        body: "Agenda and notes are visible only to the two of you.",
        href: "/engagement?tab=one-on-ones",
        dedupeKey: `one-on-one:${row.id}`,
      });
    }
    return row;
  });
}
