import { asc, eq, sql } from "drizzle-orm";
import { authorize } from "../../auth/context";
import type { Tx } from "../../db/client";
import { employees, employmentRecords, legalEntities, locations, positions } from "../../db/schema";
import { diff } from "../../lib/audit";
import { notFound, validation } from "../../lib/errors";
import { locationSchema, type LocationInput } from "@/lib/validation/settings";
import { auditAs, friendlyDbError, recordSetupSteps, referenceCount, snapshot, type SettingsCtx } from "./shared";

export type LocationRow = typeof locations.$inferSelect & { legalEntityName: string | null; employeeCount: number };

const UNIQUE_MESSAGES = { locations_tenant_name_key: "Another location already uses this name." };

export async function listLocations(ctx: SettingsCtx): Promise<LocationRow[]> {
  authorize(ctx, "org.manage", "all");
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ location: locations, legalEntityName: legalEntities.name })
      .from(locations)
      .leftJoin(legalEntities, eq(legalEntities.id, locations.legalEntityId))
      .orderBy(sql`${locations.isActive} desc`, asc(locations.name));
    const counts = await tx
      .select({ id: employees.locationId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(employees)
      .where(sql`${employees.deletedAt} is null and ${employees.status} <> 'exited' and ${employees.locationId} is not null`)
      .groupBy(employees.locationId);
    const byId = new Map(counts.map((c) => [c.id, c.n]));
    return rows.map((r) => ({ ...r.location, legalEntityName: r.legalEntityName, employeeCount: byId.get(r.location.id) ?? 0 }));
  });
}

async function assertLegalEntity(tx: Tx, id: string | null) {
  if (!id) return;
  const [le] = await tx.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.id, id));
  if (!le) throw validation("Choose a valid legal entity.", { legalEntityId: ["Legal entity not found"] });
}

export async function saveLocation(ctx: SettingsCtx, raw: LocationInput) {
  authorize(ctx, "org.manage", "all");
  const input = locationSchema.parse(raw);
  try {
    return await ctx.db(async (tx) => {
      const before = input.id ? (await tx.select().from(locations).where(eq(locations.id, input.id)))[0] : null;
      if (input.id && !before) throw notFound("Location");
      await assertLegalEntity(tx, input.legalEntityId);

      const address: Record<string, string> = {};
      for (const [k, v] of Object.entries(input.address)) if (v) address[k] = v;
      if (input.stateCode) address.stateCode = input.stateCode;
      address.countryCode = "IN";

      const values = {
        name: input.name,
        code: input.code ?? null,
        type: input.type,
        legalEntityId: input.legalEntityId,
        stateCode: input.stateCode,
        timezone: input.timezone,
        address,
        geofence:
          input.geofenceEnabled && input.lat != null && input.lng != null && input.radiusMeters != null
            ? { lat: input.lat, lng: input.lng, radiusMeters: Math.round(input.radiusMeters) }
            : null,
        isActive: input.isActive,
      };
      const [row] = before
        ? await tx.update(locations).set(values).where(eq(locations.id, before.id)).returning()
        : await tx.insert(locations).values({ tenantId: ctx.tenantId, ...values }).returning();

      await auditAs(tx, ctx, {
        action: before ? "location.updated" : "location.created",
        entityType: "location",
        entityId: row.id,
        changes: diff(snapshot(before), snapshot(row)!),
      });
      if (row.isActive) await recordSetupSteps(tx, ctx.tenantId, ["locations"]);
      return row;
    });
  } catch (err) {
    friendlyDbError(err, UNIQUE_MESSAGES);
  }
}

/** Deletes an unreferenced location; a location in use is deactivated instead. */
export async function removeLocation(ctx: SettingsCtx, id: string): Promise<{ outcome: "deleted" | "deactivated" }> {
  authorize(ctx, "org.manage", "all");
  return ctx.db(async (tx) => {
    const [before] = await tx.select().from(locations).where(eq(locations.id, id));
    if (!before) throw notFound("Location");
    const n = await referenceCount(
      tx,
      [
        { table: employees, column: employees.locationId },
        { table: positions, column: positions.locationId },
        { table: employmentRecords, column: employmentRecords.locationId },
      ],
      id,
    );
    if (n > 0) {
      await tx.update(locations).set({ isActive: false }).where(eq(locations.id, id));
      await auditAs(tx, ctx, { action: "location.deactivated", entityType: "location", entityId: id, changes: diff({ isActive: before.isActive }, { isActive: false }) });
      return { outcome: "deactivated" as const };
    }
    await tx.delete(locations).where(eq(locations.id, id));
    await auditAs(tx, ctx, { action: "location.deleted", entityType: "location", entityId: id, metadata: { name: before.name } });
    return { outcome: "deleted" as const };
  });
}
