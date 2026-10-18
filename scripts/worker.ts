/**
 * Background worker: runs the scheduler and processes the job queue.
 *   npm run worker
 * Safe to run several instances (jobs are claimed with SKIP LOCKED and
 * schedules are deduplicated per time slot).
 */
import { reclaimStaleJobs, runJobsOnce, tickScheduler } from "@/server/jobs/runner";
import { sqlClient } from "@/server/db/client";
import { logger } from "@/server/lib/logger";

let running = true;
const workerId = `worker-${process.pid}`;

async function main() {
  logger.info("worker.started", { workerId });
  let lastTick = 0;
  while (running) {
    try {
      if (Date.now() - lastTick > 60_000) {
        lastTick = Date.now();
        const [enqueued, reclaimed] = await Promise.all([tickScheduler(), reclaimStaleJobs()]);
        if (enqueued || reclaimed) logger.info("worker.tick", { enqueued, reclaimed });
      }
      const handled = await runJobsOnce({ workerId, limit: 20 });
      if (!handled) await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      logger.error("worker.loop_error", { err });
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await sqlClient.end({ timeout: 5 });
  logger.info("worker.stopped", { workerId });
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    running = false;
  });
}

void main();
