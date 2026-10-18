import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

export const PASSWORD = "E2e-password-2026";
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

export const uniqueEmail = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}@e2e.peoplesuccess.local`;

/** Poll Mailpit for the newest message to `to` and return the first link containing `contains`. */
export async function linkFromEmail(to: string, contains: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    const list = (await res.json()) as { messages?: { ID: string }[] };
    const id = list.messages?.[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { HTML: string };
      const href = [...msg.HTML.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")).find((h) => h.includes(contains));
      if (href) return href;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email with a "${contains}" link for ${to}`);
}

/** Sign up, confirm by email and create an organization. Leaves the page signed in on /setup. */
export async function signUpWithOrganization(page: Page, opts: { name: string; email: string; org: string }) {
  await page.goto("/signup");
  await page.getByLabel("Full name").fill(opts.name);
  await page.getByLabel("Work email").fill(opts.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your inbox")).toBeVisible();
  // Supabase builds links from its site URL; open them on the server under test.
  const link = new URL(await linkFromEmail(opts.email, "/auth/confirm"));
  await page.goto(link.pathname + link.search);
  await expect(page).toHaveURL(/\/setup\/organization/);
  await page.getByLabel("Organization name").fill(opts.org);
  await page.getByLabel("Registered legal name").fill(`${opts.org} Private Limited`);
  await page.getByRole("combobox", { name: "Registered state" }).click();
  await page.getByRole("option", { name: "Karnataka" }).click();
  await page.getByRole("button", { name: "Create organization" }).click();
  // Wait for the wizard itself (not /setup/organization) so the organization exists.
  await expect(page).toHaveURL(/\/setup(\?.*)?$/);
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/overview/);
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
}
