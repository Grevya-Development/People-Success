import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { integrationConnections } from "@/server/db/schema";
import { listIntegrations, saveIntegration, verifyIntegration } from "@/server/services/integrations";
import { addMember, contextFor, createOwnedTenant } from "../helpers/fixtures";

describe("integrations", () => {
  let server: Server;
  let url = "";
  const SECRET = "whsec_test_123";
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const expected = `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
        res.statusCode = req.headers["x-peoplesuccess-signature"] === expected ? 200 : 401;
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address() as { port: number };
    url = `http://127.0.0.1:${addr.port}/hook`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("verifies only after a real signed call succeeds, and never exposes secrets", async () => {
    const { tenant, user } = await createOwnedTenant();
    const ctx = await contextFor(tenant.id, user.id);
    await saveIntegration(ctx, { provider: "webhook", values: { url, secret: "wrong-secret" } });
    const failed = await verifyIntegration(ctx, "webhook");
    expect(failed.ok).toBe(false);
    let [row] = await db.select().from(integrationConnections).where(eq(integrationConnections.tenantId, tenant.id));
    expect(row.status).toBe("error");

    await saveIntegration(ctx, { provider: "webhook", values: { url, secret: SECRET } });
    [row] = await db.select().from(integrationConnections).where(eq(integrationConnections.tenantId, tenant.id));
    expect(row.status).toBe("configured");
    expect(row.credentialsEnc).not.toContain(SECRET);
    const ok = await verifyIntegration(ctx, "webhook");
    expect(ok.ok).toBe(true);
    [row] = await db.select().from(integrationConnections).where(eq(integrationConnections.tenantId, tenant.id));
    expect(row.status).toBe("verified");

    // Blank secret keeps the stored one.
    await saveIntegration(ctx, { provider: "webhook", values: { url, secret: "" } });
    expect((await verifyIntegration(ctx, "webhook")).ok).toBe(true);

    const view = await listIntegrations(ctx);
    expect(JSON.stringify(view)).not.toContain(SECRET);
    expect(view.find((v) => v.key === "webhook")?.fields.find((f) => f.key === "secret")).toMatchObject({ saved: true, value: null });
  });

  it("is restricted to integrations.manage and isolated per tenant", async () => {
    const a = await createOwnedTenant();
    const b = await createOwnedTenant();
    const owner = await contextFor(a.tenant.id, a.user.id);
    await saveIntegration(owner, { provider: "webhook", values: { url, secret: SECRET } });
    const employee = await addMember(a.tenant.id, ["employee"]);
    await expect(listIntegrations(await contextFor(a.tenant.id, employee.user.id))).rejects.toThrow();
    const other = await contextFor(b.tenant.id, b.user.id);
    const otherView = await listIntegrations(other);
    expect(otherView.find((v) => v.key === "webhook")?.connection).toBeNull();
  });
});
