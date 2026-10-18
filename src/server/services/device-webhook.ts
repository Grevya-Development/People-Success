import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { deviceEventSchema } from "@/lib/validation/time";
import { integrationConnections, integrationEvents } from "../db/schema";
import { withSystem } from "../db/tx";
import { decryptField, safeEqual } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { ingestDeviceEventsTx, type IngestResult } from "./time/attendance";

export const MAX_DEVICE_WEBHOOK_BYTES = 512 * 1024;
const PROVIDER = "attendance_device";

const payloadSchema = z.object({ events: z.array(deviceEventSchema).min(1).max(1000) });

export function signDeviceBody(secret: string, rawBody: string) {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

/**
 * Inbound punches from attendance devices / middleware. The connection id in
 * the URL selects the tenant; the HMAC over the raw body (with the connection's
 * encrypted signing secret) authenticates the sender. Unknown connections and
 * bad signatures get the same answer so ids cannot be probed. Ingestion is
 * idempotent on each event's externalId, so retries and replays are harmless.
 */
export async function receiveDeviceWebhook(connectionId: string, rawBody: string, signature: string | null): Promise<IngestResult> {
  const unauthorized = () => new AppError("UNAUTHENTICATED", "Invalid connection or signature.");
  if (!z.uuid().safeParse(connectionId).success || !signature) throw unauthorized();

  const [conn] = await withSystem((tx) => tx.select().from(integrationConnections).where(eq(integrationConnections.id, connectionId)));
  if (!conn || conn.provider !== PROVIDER || !conn.credentialsEnc) throw unauthorized();

  let secret: string | undefined;
  try {
    secret = (JSON.parse(decryptField(conn.credentialsEnc)) as Record<string, string>).signingSecret;
  } catch {
    secret = undefined;
  }
  if (!secret || !safeEqual(signature.trim(), signDeviceBody(secret, rawBody))) throw unauthorized();
  if (conn.status === "disabled") throw new AppError("INVALID_STATE", "This integration is disabled.");

  let parsed: z.infer<typeof payloadSchema>;
  try {
    const result = payloadSchema.safeParse(JSON.parse(rawBody));
    if (!result.success) throw new AppError("VALIDATION", `Invalid payload: ${z.prettifyError(result.error).slice(0, 300)}`);
    parsed = result.data;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("VALIDATION", "Body must be JSON.");
  }

  return withSystem(async (tx) => {
    const result = await ingestDeviceEventsTx(tx, conn.tenantId, parsed.events, { userId: null });
    const now = new Date();
    await tx
      .update(integrationConnections)
      // A successful signed delivery is the real proof this integration works.
      .set({ status: "verified", lastVerifiedAt: now, lastSyncAt: now, lastError: null })
      .where(eq(integrationConnections.id, conn.id));
    await tx.insert(integrationEvents).values({
      tenantId: conn.tenantId,
      connectionId: conn.id,
      provider: PROVIDER,
      direction: "inbound",
      eventType: "attendance.punches",
      status: "succeeded",
      attempts: 1,
      // Counts only; employee codes and timestamps stay out of the log.
      payload: { received: result.received, inserted: result.inserted, duplicates: result.duplicates, unknownEmployees: result.unknownEmployees.length },
      processedAt: now,
    });
    return result;
  }, conn.tenantId);
}
