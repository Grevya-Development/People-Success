import { NextResponse, type NextRequest } from "next/server";
import { reclaimStaleJobs, runJobsOnce, tickScheduler } from "@/server/jobs/runner";
import { safeEqual } from "@/server/lib/crypto";
import { env } from "@/server/env";

/**
 * Serverless alternative to `npm run worker`: a platform cron (e.g. every
 * minute) calls this with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  const secret = env().CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Invalid cron secret." } }, { status: 401 });
  }
  const started = Date.now();
  const [enqueued, reclaimed] = await Promise.all([tickScheduler(), reclaimStaleJobs()]);
  let processed = 0;
  // Work for up to ~45s, leaving headroom under typical function limits.
  while (Date.now() - started < 45_000) {
    const n = await runJobsOnce({ workerId: "cron", limit: 25 });
    processed += n;
    if (!n) break;
  }
  return NextResponse.json({ enqueued, reclaimed, processed, ms: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
}
