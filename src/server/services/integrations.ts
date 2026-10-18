import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { authorize, type RequestContext } from "../auth/context";
import { integrationConnections, integrationEvents } from "../db/schema";
import { audit } from "../lib/audit";
import { decryptField, encryptField } from "../lib/crypto";
import { AppError, notFound } from "../lib/errors";
import { PROVIDERS, providerDefinition } from "../integrations/providers";

export type IntegrationView = {
  key: string;
  name: string;
  category: string;
  description: string;
  capabilities: string[];
  setupSteps: string[];
  canVerify: boolean;
  fields: { key: string; label: string; secret: boolean; placeholder?: string; help?: string; saved: boolean; value: string | null }[];
  connection: null | {
    id: string;
    status: string;
    lastVerifiedAt: string | null;
    lastError: string | null;
    updatedAt: string;
  };
};

function readCreds(enc: string | null): Record<string, string> {
  if (!enc) return {};
  try {
    return JSON.parse(decryptField(enc)) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Catalogue merged with this tenant's connections. Secrets never leave the server. */
export async function listIntegrations(ctx: RequestContext): Promise<IntegrationView[]> {
  authorize(ctx, "integrations.manage", "all");
  const conns = await ctx.db((tx) => tx.select().from(integrationConnections));
  return PROVIDERS.map((p) => {
    const c = conns.find((x) => x.provider === p.key) ?? null;
    const creds = readCreds(c?.credentialsEnc ?? null);
    return {
      key: p.key,
      name: p.name,
      category: p.category,
      description: p.description,
      capabilities: p.capabilities,
      setupSteps: p.setupSteps,
      canVerify: !!p.verify,
      fields: p.credentials.map((f) => ({
        ...f,
        saved: !!creds[f.key],
        // Non-secret values are shown for editing; secrets only as "saved".
        value: f.secret ? null : (creds[f.key] ?? null),
      })),
      connection: c
        ? {
            id: c.id,
            status: c.status,
            lastVerifiedAt: c.lastVerifiedAt?.toISOString() ?? null,
            lastError: c.lastError,
            updatedAt: c.updatedAt.toISOString(),
          }
        : null,
    };
  });
}

export const saveIntegrationSchema = z.object({
  provider: z.string().min(1),
  values: z.record(z.string(), z.string().max(8000)),
});

/**
 * Save credentials (encrypted). Blank secret fields keep the stored value.
 * Saving resets the status to "configured": it must be verified again.
 */
export async function saveIntegration(ctx: RequestContext, input: z.infer<typeof saveIntegrationSchema>) {
  authorize(ctx, "integrations.manage", "all");
  const def = providerDefinition(input.provider);
  if (!def) throw new AppError("VALIDATION", "Unknown provider.");
  return ctx.db(async (tx) => {
    const [existing] = await tx.select().from(integrationConnections).where(eq(integrationConnections.provider, def.key)).for("update");
    const current = readCreds(existing?.credentialsEnc ?? null);
    const merged: Record<string, string> = {};
    for (const f of def.credentials) {
      const v = (input.values[f.key] ?? "").trim();
      merged[f.key] = v || current[f.key] || "";
    }
    const missing = def.credentials.filter((f) => !merged[f.key]).map((f) => f.label);
    if (missing.length) throw new AppError("VALIDATION", `Fill in: ${missing.join(", ")}.`);
    const credentialsEnc = def.credentials.length ? encryptField(JSON.stringify(merged)) : null;
    const status = "configured" as const;
    const [row] = await tx
      .insert(integrationConnections)
      .values({ tenantId: ctx.tenantId, provider: def.key, category: def.category, displayName: def.name, status, credentialsEnc, createdBy: ctx.userId })
      .onConflictDoUpdate({
        target: [integrationConnections.tenantId, integrationConnections.provider],
        set: { credentialsEnc, status, lastError: null, lastVerifiedAt: null },
      })
      .returning({ id: integrationConnections.id });
    await audit(tx, ctx, { action: "integration.configured", entityType: "integration", entityId: row.id, metadata: { provider: def.key } });
    return { id: row.id };
  });
}

/** Run the provider's real connectivity check and record the outcome. */
export async function verifyIntegration(ctx: RequestContext, provider: string) {
  authorize(ctx, "integrations.manage", "all");
  const def = providerDefinition(provider);
  if (!def) throw notFound("Integration");
  if (!def.verify) throw new AppError("PRECONDITION", "This integration cannot be verified automatically. It is marked verified after its first successful sync.");
  const conn = await ctx.db(async (tx) => (await tx.select().from(integrationConnections).where(eq(integrationConnections.provider, provider)))[0]);
  if (!conn) throw new AppError("PRECONDITION", "Save the credentials first.");
  if (conn.status === "disabled") throw new AppError("INVALID_STATE", "Enable the integration before testing it.");
  const result = await def.verify(readCreds(conn.credentialsEnc));
  await ctx.db(async (tx) => {
    await tx
      .update(integrationConnections)
      .set(result.ok ? { status: "verified", lastVerifiedAt: new Date(), lastError: null } : { status: "error", lastError: result.message.slice(0, 500) })
      .where(eq(integrationConnections.id, conn.id));
    await tx.insert(integrationEvents).values({
      tenantId: ctx.tenantId,
      connectionId: conn.id,
      provider,
      direction: "outbound",
      eventType: "connection.verify",
      status: result.ok ? "succeeded" : "failed",
      attempts: 1,
      error: result.ok ? null : result.message.slice(0, 500),
      processedAt: new Date(),
    });
    await audit(tx, ctx, { action: result.ok ? "integration.verified" : "integration.verify_failed", entityType: "integration", entityId: conn.id, metadata: { provider } });
  });
  return result;
}

export async function setIntegrationEnabled(ctx: RequestContext, provider: string, enabled: boolean) {
  authorize(ctx, "integrations.manage", "all");
  return ctx.db(async (tx) => {
    const [conn] = await tx.select().from(integrationConnections).where(eq(integrationConnections.provider, provider)).for("update");
    if (!conn) throw notFound("Integration");
    await tx
      .update(integrationConnections)
      .set({ status: enabled ? "configured" : "disabled", lastVerifiedAt: enabled ? null : conn.lastVerifiedAt })
      .where(eq(integrationConnections.id, conn.id));
    await audit(tx, ctx, { action: enabled ? "integration.enabled" : "integration.disabled", entityType: "integration", entityId: conn.id });
  });
}

export async function removeIntegration(ctx: RequestContext, provider: string) {
  authorize(ctx, "integrations.manage", "all");
  return ctx.db(async (tx) => {
    const [conn] = await tx.select().from(integrationConnections).where(eq(integrationConnections.provider, provider));
    if (!conn) throw notFound("Integration");
    await tx
      .update(integrationConnections)
      .set({ credentialsEnc: null, status: "not_configured", lastVerifiedAt: null, lastError: null })
      .where(eq(integrationConnections.id, conn.id));
    await audit(tx, ctx, { action: "integration.removed", entityType: "integration", entityId: conn.id, metadata: { provider } });
  });
}

export async function integrationEventsFor(ctx: RequestContext, provider: string) {
  authorize(ctx, "integrations.manage", "all");
  return ctx.db((tx) =>
    tx
      .select({
        id: integrationEvents.id,
        direction: integrationEvents.direction,
        eventType: integrationEvents.eventType,
        status: integrationEvents.status,
        error: integrationEvents.error,
        createdAt: integrationEvents.createdAt,
      })
      .from(integrationEvents)
      .where(and(eq(integrationEvents.provider, provider)))
      .orderBy(desc(integrationEvents.createdAt))
      .limit(25),
  );
}
