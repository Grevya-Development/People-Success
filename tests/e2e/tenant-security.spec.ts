import { expect, test } from "@playwright/test";
import { signOut, signUpWithOrganization, uniqueEmail, PASSWORD } from "./helpers";

/** Flow H: two tenants cannot see, query, export or modify each other's records. */
test("tenant isolation across UI, exports and API", async ({ page, request }) => {
  const a = uniqueEmail("tenant-a");
  const b = uniqueEmail("tenant-b");

  await signUpWithOrganization(page, { name: "Owner A", email: a, org: `Tenant A ${Date.now()}` });
  await page.goto("/employees/new");
  await page.getByLabel("First name").fill("Secret");
  await page.getByLabel("Last name").fill("Person");
  await page.getByLabel("Joining date").fill("2024-01-15");
  await page.getByRole("button", { name: "Create employee" }).click();
  await expect(page.getByRole("heading", { name: "Secret Person" })).toBeVisible();
  const secretUrl = page.url();
  await signOut(page);

  await signUpWithOrganization(page, { name: "Owner B", email: b, org: `Tenant B ${Date.now()}` });
  // UI: profile URL from tenant A is not found in tenant B.
  await page.goto(secretUrl);
  await expect(page.getByRole("heading", { name: "Page not found" }).or(page.getByText("Page not found", { exact: true })).first()).toBeVisible();
  // Directory search does not reveal tenant A's employee.
  await page.goto("/employees?q=Secret");
  await expect(page.getByText("No matching employees")).toBeVisible();
  // Export from tenant B does not contain tenant A data.
  const csv = await page.request.get("/api/employees/export");
  expect(csv.ok()).toBeTruthy();
  expect(await csv.text()).not.toContain("Secret Person");

  // API with tenant B's token, forging tenant A's id via a direct GET.
  const token = await (
    await request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321"}/auth/v1/token?grant_type=password`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "" },
      data: { email: b, password: PASSWORD },
    })
  ).json();
  const id = secretUrl.split("/").pop();
  const res = await request.get(`/api/v1/employees/${id}`, { headers: { authorization: `Bearer ${token.access_token}` } });
  expect([403, 404]).toContain(res.status());
});
