import { describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/server/db/client";
import { jobs } from "@/server/db/schema";
import { enqueueJob, registerJobHandler } from "@/server/jobs/registry";
import { runJobsOnce, tickScheduler } from "@/server/jobs/runner";

/** Drain everything currently due (other tests leave domain events queued). */
async function drain() {
  for (let i = 0; i < 50; i++) if (!(await runJobsOnce({ workerId: "test", limit: 100 }))) break;
}

describe("job queue", () => {
  it("runs jobs, retries failures with backoff and dead-letters after max attempts", async () => {
    await db.delete(jobs).where(like(jobs.type, "test.%"));
    registerJobHandler("test.ok", async (job) => ({ echo: job.payload.n }));
    registerJobHandler("test.flaky", async (job) => {
      if (job.attempts < 2) throw new Error("transient");
      return { ok: true };
    });
    registerJobHandler("test.broken", async () => {
      throw new Error("always fails");
    });
    const ok = await enqueueJob(db, "test.ok", { payload: { n: 7 } });
    const fl = await enqueueJob(db, "test.flaky", { maxAttempts: 3 });
    const br = await enqueueJob(db, "test.broken", { maxAttempts: 1 });

    await drain();
    let rows = await db.select().from(jobs).where(inArray(jobs.id, [ok!, fl!, br!]));
    const byId = (id: number) => rows.find((r) => r.id === id)!;
    expect(byId(ok!).status).toBe("succeeded");
    expect(byId(ok!).result).toEqual({ echo: 7 });
    expect(byId(fl!).status).toBe("queued"); // retry scheduled in the future
    expect(byId(fl!).runAt.getTime()).toBeGreaterThan(Date.now());
    expect(byId(br!).status).toBe("dead");

    // Use a past time: the DB clock (container) may trail the test process clock slightly.
    await db.update(jobs).set({ runAt: new Date(Date.now() - 60_000) }).where(eq(jobs.id, fl!));
    await drain();
    rows = await db.select().from(jobs).where(eq(jobs.id, fl!));
    expect(rows[0].status).toBe("succeeded");
    expect(rows[0].attempts).toBe(2);
  });

  it("deduplicates pending jobs and scheduled slots", async () => {
    const key = `test-dedupe-${Date.now()}`;
    const a = await enqueueJob(db, "test.ok", { dedupeKey: key });
    const b = await enqueueJob(db, "test.ok", { dedupeKey: key });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    const now = new Date();
    await tickScheduler(now);
    const second = await tickScheduler(now);
    expect(second).toBe(0);
  });
});
