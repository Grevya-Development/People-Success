import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Tests run against the LOCAL Supabase stack: .env.test.local wins over
// .env.local (loadEnvFile never overrides variables that are already set).
for (const file of [".env.test.local", ".env.local"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

// Locally the E2E server runs on 3101 with its own build folder, beside the
// normal dev server on 3100 (which may point at the hosted project).
const PORT = process.env.CI ? 3100 : 3101;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Locally, drive the installed Google Chrome; CI installs Playwright's Chromium.
    ...(process.env.CI ? {} : { channel: "chrome" }),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.CI ? `npm run start` : `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    env: { ...(process.env as Record<string, string>), NEXT_DIST_DIR: process.env.CI ? ".next" : ".next-e2e" },
    timeout: 180_000,
  },
});
