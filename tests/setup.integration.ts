import { existsSync } from "node:fs";
import { afterAll } from "vitest";

// Next.js skips .env.local when NODE_ENV=test; integration tests run against
// the local Supabase stack, so load it explicitly (CI provides real env vars).
for (const file of [".env.test.local", ".env.local"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

afterAll(async () => {
  const { sqlClient } = await import("@/server/db/client");
  await sqlClient.end({ timeout: 5 });
});
