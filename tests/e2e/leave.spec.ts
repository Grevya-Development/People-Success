import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { signIn, signOut } from "./helpers";

type Fixture = { password: string; managerEmail: string; employeeEmail: string; leaveType: string };

/** Next Monday at least `minDays` ahead, so the range is two working days. */
function nextMonday(minDays: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + minDays);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Flow D: request → policy/balance check → manager approval → ledger and balance update. */
test("employee applies for leave, manager approves, balance is deducted", async ({ page }) => {
  const fx = JSON.parse(
    execFileSync("npx", ["tsx", "--tsconfig", "tsconfig.worker.json", "--env-file-if-exists=.env.test.local", "--env-file-if-exists=.env.local", "tests/e2e/fixtures/leave-org.ts"], { encoding: "utf8" }),
  ) as Fixture;
  const from = nextMonday(10);
  const to = plusDays(from, 1);

  // Employee applies.
  await signIn(page, fx.employeeEmail, fx.password);
  await page.goto("/leave/new");
  // Choosing from the select also proves the form has hydrated before typing dates.
  await page.getByRole("combobox", { name: "Leave type" }).click();
  await page.getByRole("option", { name: fx.leaveType }).click();
  await page.getByRole("textbox", { name: "From" }).fill(from);
  await page.getByRole("textbox", { name: "To", exact: true }).fill(to);
  await page.getByLabel("Reason").fill("Family function");
  // The live preview validates policy and balance before submission.
  await expect(page.getByText("After this").locator("xpath=following-sibling::dd[1]")).toHaveText("3");
  await page.getByRole("button", { name: "Send for approval" }).click();
  await expect(page).toHaveURL(/\/leave\/requests\/[0-9a-f-]{36}$/);
  const requestUrl = page.url();
  await expect(page.locator("main span.rounded-full", { hasText: /^pending$/i }).first()).toBeVisible();
  await signOut(page);

  // Manager approves from the inbox.
  await signIn(page, fx.managerEmail, fx.password);
  await page.goto("/inbox?tab=approvals");
  await expect(page.getByText(/Arjun Worker/).first()).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await signOut(page);

  // Employee sees the approved request and the deducted balance.
  await signIn(page, fx.employeeEmail, fx.password);
  await page.goto(requestUrl);
  await expect(page.locator("main span.rounded-full", { hasText: /^approved$/i }).first()).toBeVisible();
  await page.goto("/leave");
  const card = page.locator("div", { has: page.getByText(fx.leaveType, { exact: true }) }).filter({ hasText: /available/i }).last();
  await expect(card).toContainText("3");
});
