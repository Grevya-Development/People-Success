import { expect, test } from "@playwright/test";
import { signUpWithOrganization, uniqueEmail } from "./helpers";

test("owner signs up, creates an organization and adds an employee", async ({ page }) => {
  const email = uniqueEmail("owner");
  await signUpWithOrganization(page, { name: "Asha Owner", email, org: `E2E Org ${Date.now()}` });

  await page.goto("/employees");
  await expect(page.getByText("No employees yet")).toBeVisible();
  await page.getByRole("link", { name: "Add employee" }).first().click();
  await page.getByLabel("First name").fill("Ravi");
  await page.getByLabel("Last name").fill("Kumar");
  await page.getByLabel("Work email").fill(uniqueEmail("ravi"));
  await page.getByLabel("Joining date").fill("2024-06-01");
  await page.getByRole("button", { name: "Create employee" }).click();

  await expect(page.getByRole("heading", { name: "Ravi Kumar" })).toBeVisible();
  await expect(page.getByText("Employee EMP0001 created")).toBeVisible(); // toast
  await expect(page.locator("header").getByText("EMP0001", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Job & history" }).click();
  await expect(page.getByRole("cell", { name: "hire", exact: true })).toBeVisible();

  await page.goto("/employees");
  await page.getByLabel("Search employees").fill("ravi");
  await expect(page.getByRole("link", { name: /Ravi Kumar/ })).toBeVisible();
});

test("validation errors are shown inline", async ({ page }) => {
  await page.goto("/signup");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Enter your full name")).toBeVisible();
  await expect(page.getByText("Enter a valid work email")).toBeVisible();
});
