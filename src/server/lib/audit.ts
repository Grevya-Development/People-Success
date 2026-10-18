import type { Tx } from "../db/client";
import { auditLogs } from "../db/schema";

/** Field names whose values must never be written to audit logs or app logs. */
const REDACTED_KEYS = new Set([
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "pan",
  "aadhaar",
  "passport",
  "bankAccount",
  "bankAccountNumber",
  "panEnc",
  "aadhaarEnc",
  "passportEnc",
  "bankAccountEnc",
  "apiKey",
  "secret",
]);

const SENSITIVE_VALUE_KEYS = new Set(["annualCtc", "components", "grossPay", "netPay", "amount"]);

export type AuditActor = {
  tenantId: string;
  userId: string | null;
  actorType?: "user" | "system" | "agent" | "integration";
};

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | null;
  changes?: Record<string, { from?: unknown; to?: unknown }>;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

function redactValue(key: string, value: unknown) {
  if (REDACTED_KEYS.has(key)) return "[redacted]";
  if (SENSITIVE_VALUE_KEYS.has(key)) return value === undefined ? undefined : "[changed]";
  return value;
}

/** Field-level diff of two plain objects, with sensitive values redacted. */
export function diff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
): Record<string, { from?: unknown; to?: unknown }> {
  const out: Record<string, { from?: unknown; to?: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (key === "updatedAt" || key === "createdAt") continue;
    const a = before?.[key];
    const b = after[key];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    out[key] = { from: redactValue(key, a), to: redactValue(key, b) };
  }
  return out;
}

export async function audit(tx: Tx, actor: AuditActor, entry: AuditEntry) {
  await tx.insert(auditLogs).values({
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    actorType: actor.actorType ?? (actor.userId ? "user" : "system"),
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    changes: entry.changes && Object.keys(entry.changes).length ? entry.changes : null,
    metadata: entry.metadata ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent?.slice(0, 400) ?? null,
    requestId: entry.requestId ?? null,
  });
}
