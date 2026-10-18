import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { idempotencyKeys, memberships, users } from "../db/schema";
import { env } from "../env";
import { contextForUser } from "../auth/system-context";
import { requireActionContext, type RequestContext } from "../auth/context";
import { AppError, toAppError } from "../lib/errors";
import { rateLimit } from "../lib/rate-limit";
import { sha256 } from "../lib/crypto";
import { logger } from "../lib/logger";
import { zodFieldErrors } from "../lib/action";

/**
 * REST API plumbing. Authentication:
 *   - Browser session cookie (same as the app), or
 *   - `Authorization: Bearer <Supabase access token>` + optional `X-Tenant-Id`
 *     (defaults to the user's last active organization).
 * The API runs the same services as the UI, so authorization and RLS are
 * identical. Errors use one shape: { error: { code, message, fieldErrors? }, requestId }.
 */

let verifier: ReturnType<typeof createClient> | undefined;

async function contextFromBearer(token: string, tenantHeader: string | null): Promise<RequestContext> {
  verifier ??= createClient(env().NEXT_PUBLIC_SUPABASE_URL, env().NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await verifier.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || !userId) throw new AppError("UNAUTHENTICATED", "Invalid or expired access token.");
  let tenantId = tenantHeader;
  if (!tenantId) {
    const [u] = await db.select({ t: users.lastActiveTenantId }).from(users).where(eq(users.id, userId));
    tenantId = u?.t ?? null;
    if (!tenantId) {
      const [m] = await db.select({ t: memberships.tenantId }).from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.status, "active"))).limit(1);
      tenantId = m?.t ?? null;
    }
  }
  if (!tenantId || !z.uuid().safeParse(tenantId).success) throw new AppError("FORBIDDEN", "Specify X-Tenant-Id for an organization you belong to.");
  const ctx = await contextForUser(tenantId, userId);
  if (!ctx) throw new AppError("FORBIDDEN", "You are not an active member of that organization.");
  return ctx;
}

export async function apiContext(request: NextRequest): Promise<RequestContext> {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return contextFromBearer(auth.slice(7).trim(), request.headers.get("x-tenant-id"));
  return requireActionContext();
}

export function apiError(err: unknown, requestId: string) {
  const e = toAppError(err);
  if (e.code === "INTERNAL") logger.error("api.error", { requestId, err });
  return NextResponse.json(
    { error: { code: e.code, message: e.message, ...(e.fieldErrors ? { fieldErrors: e.fieldErrors } : {}) }, requestId },
    { status: e.status, headers: { "x-request-id": requestId, "cache-control": "no-store" } },
  );
}

export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AppError("VALIDATION", "Request body is invalid.", { fieldErrors: zodFieldErrors(parsed.error) });
  return parsed.data;
}

type Handler = (args: { request: NextRequest; ctx: RequestContext; requestId: string }) => Promise<unknown>;

/** Wrap a handler: auth, per-user rate limit (600 requests / 5 min), error mapping, JSON response. */
export function apiHandler(handler: Handler, opts: { status?: number } = {}) {
  return async (request: NextRequest) => {
    const requestId = request.headers.get("x-request-id") ?? randomUUID();
    try {
      const ctx = await apiContext(request);
      await rateLimit(`api:${ctx.userId}`, 600, 300);
      const data = await handler({ request, ctx, requestId });
      return NextResponse.json({ data }, { status: opts.status ?? 200, headers: { "x-request-id": requestId, "cache-control": "no-store" } });
    } catch (err) {
      return apiError(err, requestId);
    }
  };
}

/**
 * Idempotent create: the same Idempotency-Key with the same body returns the
 * original response; with a different body it is rejected (409).
 */
export async function withIdempotency<T>(ctx: RequestContext, request: NextRequest, scope: string, body: unknown, fn: () => Promise<T>): Promise<T> {
  const key = request.headers.get("idempotency-key");
  if (!key) return fn();
  if (!/^[\w-]{8,100}$/.test(key)) throw new AppError("VALIDATION", "Idempotency-Key must be 8–100 characters of letters, digits, - or _.");
  const hash = sha256(JSON.stringify(body ?? null));
  const existing = await ctx.db(async (tx) =>
    (await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key))))[0],
  );
  if (existing) {
    if (existing.requestHash !== hash) throw new AppError("CONFLICT", "This Idempotency-Key was already used with a different request body.");
    if (existing.response !== null) return existing.response as T;
    throw new AppError("CONFLICT", "A request with this Idempotency-Key is still being processed.");
  }
  await ctx.db((tx) => tx.insert(idempotencyKeys).values({ tenantId: ctx.tenantId, scope, key, requestHash: hash }));
  try {
    const result = await fn();
    await ctx.db((tx) =>
      tx
        .update(idempotencyKeys)
        .set({ response: result as object })
        .where(and(eq(idempotencyKeys.tenantId, ctx.tenantId), eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key))),
    );
    return result;
  } catch (err) {
    // Let the client retry with the same key after a failure.
    await ctx.db((tx) => tx.delete(idempotencyKeys).where(and(eq(idempotencyKeys.tenantId, ctx.tenantId), eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key))));
    throw err;
  }
}
