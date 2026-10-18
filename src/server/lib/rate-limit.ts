import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { AppError } from "./errors";

/**
 * Fixed-window rate limiter backed by Postgres (one upsert per call). Shared
 * across server instances without extra infrastructure.
 */
export async function rateLimit(bucket: string, limit: number, windowSeconds: number) {
  const rows = await db.execute<{ count: number }>(sql`
    insert into rate_limits (bucket, window_start, count)
    values (${bucket}, now(), 1)
    on conflict (bucket) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   then now() else rate_limits.window_start end
    returning count`);
  const count = Number(rows[0]?.count ?? 0);
  if (count > limit) {
    throw new AppError("RATE_LIMITED", "Too many requests. Please wait a moment and try again.");
  }
}
