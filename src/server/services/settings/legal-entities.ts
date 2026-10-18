import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { authorize } from "../../auth/context";
import type { Tx } from "../../db/client";
import { employees, legalEntities, type LegalEntityRegistrations } from "../../db/schema";
import { diff } from "../../lib/audit";
import { invalidState, notFound } from "../../lib/errors";
import { legalEntitySchema, type LegalEntityInput } from "@/lib/validation/settings";
import { auditAs, friendlyDbError, recordSetupSteps, snapshot, type SettingsCtx } from "./shared";

export type LegalEntityRow = typeof legalEntities.$inferSelect & { activeEmployees: number };

const UNIQUE_MESSAGES = {
  legal_entities_tenant_name_key: "Another legal entity already uses this name.",
  legal_entities_one_default: "Another legal entity was made default at the same time. Please try again.",
};

/** Employees that still count against an entity: not exited and not deleted. */
async function activeEmployeeCounts(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = await tx
    .select({ id: employees.legalEntityId, n: sql<number>`count(*)`.mapWith(Number) })
    .from(employees)
    .where(and(inArray(employees.legalEntityId, ids), isNull(employees.deletedAt), ne(employees.status, "exited")))
    .groupBy(employees.legalEntityId);
  return new Map(rows.map((r) => [r.id, r.n]));
}

export async function listLegalEntities(ctx: SettingsCtx): Promise<LegalEntityRow[]> {
  authorize(ctx, "settings.manage", "all");
  return ctx.db(async (tx) => {
    const rows = await tx
      .select()
      .from(legalEntities)
      .orderBy(sql`${legalEntities.isDefault} desc`, sql`${legalEntities.isActive} desc`, asc(legalEntities.name));
    const counts = await activeEmployeeCounts(tx, rows.map((r) => r.id));
    return rows.map((r) => ({ ...r, activeEmployees: counts.get(r.id) ?? 0 }));
  });
}

function cleanRegistrations(r: LegalEntityInput["registrations"]): LegalEntityRegistrations {
  const out: LegalEntityRegistrations = {};
  for (const [k, v] of Object.entries(r)) if (v) out[k as keyof LegalEntityRegistrations] = v;
  return out;
}

function cleanAddress(a: LegalEntityInput["address"], stateCode: string | null) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(a)) if (v) out[k] = v;
  if (stateCode) out.stateCode = stateCode;
  out.countryCode = "IN";
  return out;
}

/** Registrations are identifiers, not secrets, but audit only which ones changed. */
const auditView = (row: Record<string, unknown> | null) =>
  row
    ? {
        ...row,
        registrations: Object.fromEntries(
          Object.entries((row.registrations as Record<string, string>) ?? {}).map(([k, v]) => [k, v ? `…${String(v).slice(-4)}` : v]),
        ),
      }
    : null;

/**
 * Create or update a legal entity. Exactly one entity is the default: making
 * one default unsets the others in the same transaction (before setting the
 * new one, so the partial unique index is never violated). The default must
 * stay active, and an entity with active employees cannot be deactivated.
 */
export async function saveLegalEntity(ctx: SettingsCtx, raw: LegalEntityInput) {
  authorize(ctx, "settings.manage", "all");
  const input = legalEntitySchema.parse(raw);
  try {
    return await ctx.db(async (tx) => {
      const before = input.id
        ? (await tx.select().from(legalEntities).where(eq(legalEntities.id, input.id)).for("update"))[0]
        : null;
      if (input.id && !before) throw notFound("Legal entity");

      const [{ n: total }] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(legalEntities);
      // The first entity is always the default.
      const isDefault = input.isDefault || (!before && total === 0);

      if (before?.isDefault && !isDefault) {
        throw invalidState("Choose another legal entity as the default first. There must always be one default entity.");
      }
      if (isDefault && !input.isActive) throw invalidState("The default legal entity must be active.");
      if (before?.isActive && !input.isActive) {
        const counts = await activeEmployeeCounts(tx, [before.id]);
        const n = counts.get(before.id) ?? 0;
        if (n > 0) {
          throw invalidState(
            `This entity still has ${n} active employee${n === 1 ? "" : "s"}. Move or exit them before deactivating it.`,
          );
        }
      }

      if (isDefault) {
        await tx
          .update(legalEntities)
          .set({ isDefault: false })
          .where(and(eq(legalEntities.isDefault, true), before ? ne(legalEntities.id, before.id) : undefined));
      }

      const values = {
        name: input.name,
        legalName: input.legalName,
        stateCode: input.stateCode,
        registrations: cleanRegistrations(input.registrations),
        address: cleanAddress(input.address, input.stateCode),
        isDefault,
        isActive: input.isActive,
      };

      const [row] = before
        ? await tx.update(legalEntities).set(values).where(eq(legalEntities.id, before.id)).returning()
        : await tx.insert(legalEntities).values({ tenantId: ctx.tenantId, ...values }).returning();

      await auditAs(tx, ctx, {
        action: before ? "legal_entity.updated" : "legal_entity.created",
        entityType: "legal_entity",
        entityId: row.id,
        changes: diff(auditView(snapshot(before)), auditView(snapshot(row))!),
      });

      if (row.registrations.pan && row.registrations.tan && row.isActive) {
        await recordSetupSteps(tx, ctx.tenantId, ["legal_entity"]);
      }
      return row;
    });
  } catch (err) {
    friendlyDbError(err, UNIQUE_MESSAGES);
  }
}
