import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { attendanceEvents, integrationConnections, integrationEvents, legalEntities } from "@/server/db/schema";
import { createEmployee } from "@/server/services/employees/mutations";
import { createEmployeeSchema } from "@/lib/validation/employees";
import { saveIntegration } from "@/server/services/integrations";
import { receiveDeviceWebhook, signDeviceBody } from "@/server/services/device-webhook";
import { contextFor, createOwnedTenant } from "../helpers/fixtures";

async function orgWithDevice(secret: string) {
  const org = await createOwnedTenant();
  const ctx = await contextFor(org.tenant.id, org.user.id);
  const [{ id: le }] = await db.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.tenantId, org.tenant.id));
  const emp = await createEmployee(
    ctx,
    createEmployeeSchema.parse({
      firstName: "Gate", lastName: "Test", workEmail: "", personalEmail: "", phone: "", dateOfBirth: "", employeeCode: "",
      legalEntityId: le, employmentType: "full_time", workerType: "employee", workMode: "onsite",
      joiningDate: "2024-01-01", probationMonths: 0, noticePeriodDays: 30, annualCtc: "",
    }),
  );
  const { id: connectionId } = await saveIntegration(ctx, { provider: "attendance_device", values: { signingSecret: secret } });
  return { org, emp, connectionId };
}

describe("attendance device webhook", () => {
  let a: Awaited<ReturnType<typeof orgWithDevice>>;
  let b: Awaited<ReturnType<typeof orgWithDevice>>;
  beforeAll(async () => {
    a = await orgWithDevice("dev-secret-a");
    b = await orgWithDevice("dev-secret-b");
  });

  const body = (code: string, ext: string) =>
    JSON.stringify({ events: [{ employeeCode: code, occurredAt: "2026-10-12T09:15:00+05:30", kind: "in", deviceId: "GATE-1", externalId: ext }] });

  it("rejects bad signatures, unknown connections and other tenants' secrets identically", async () => {
    const raw = body(a.emp.employeeCode, "x-1");
    await expect(receiveDeviceWebhook(a.connectionId, raw, null)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(receiveDeviceWebhook(a.connectionId, raw, "sha256=deadbeef")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(receiveDeviceWebhook(a.connectionId, raw, signDeviceBody("dev-secret-b", raw))).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(receiveDeviceWebhook(crypto.randomUUID(), raw, signDeviceBody("dev-secret-a", raw))).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(receiveDeviceWebhook("not-a-uuid", raw, signDeviceBody("dev-secret-a", raw))).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    // Signature covers the exact body: tampering breaks it.
    const sig = signDeviceBody("dev-secret-a", raw);
    await expect(receiveDeviceWebhook(a.connectionId, raw.replace("09:15", "08:15"), sig)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const [conn] = await db.select().from(integrationConnections).where(eq(integrationConnections.id, a.connectionId));
    expect(conn.status).not.toBe("verified");
  });

  it("ingests signed punches into the connection's tenant only, idempotently, and marks the connection verified", async () => {
    // Tenant B's employee code sent to tenant A's connection must not reach B.
    const raw = JSON.stringify({
      events: [
        { employeeCode: a.emp.employeeCode, occurredAt: "2026-10-12T09:15:00+05:30", kind: "in", deviceId: "GATE-1", externalId: "a-1" },
        { employeeCode: a.emp.employeeCode, occurredAt: "2026-10-12T18:30:00+05:30", kind: "out", deviceId: "GATE-1", externalId: "a-2" },
      ],
    });
    const first = await receiveDeviceWebhook(a.connectionId, raw, signDeviceBody("dev-secret-a", raw));
    expect(first).toMatchObject({ received: 2, inserted: 2, duplicates: 0 });
    const again = await receiveDeviceWebhook(a.connectionId, raw, signDeviceBody("dev-secret-a", raw));
    expect(again).toMatchObject({ inserted: 0, duplicates: 2 });

    const crossRaw = body(b.emp.employeeCode, "b-via-a");
    const cross = await receiveDeviceWebhook(a.connectionId, crossRaw, signDeviceBody("dev-secret-a", crossRaw));
    // Codes are per tenant (both orgs start at EMP0001): the punch resolves against tenant A only.
    const sameCode = b.emp.employeeCode === a.emp.employeeCode;
    expect(cross.unknownEmployees).toEqual(sameCode ? [] : [b.emp.employeeCode]);
    const bRows = await db.select().from(attendanceEvents).where(eq(attendanceEvents.tenantId, b.org.tenant.id));
    expect(bRows).toHaveLength(0);

    const rows = await db
      .select()
      .from(attendanceEvents)
      .where(and(eq(attendanceEvents.tenantId, a.org.tenant.id), eq(attendanceEvents.employeeId, a.emp.id)));
    expect(rows).toHaveLength(sameCode ? 3 : 2);
    expect(rows.every((r) => r.verification === "device_verified")).toBe(true);

    const [conn] = await db.select().from(integrationConnections).where(eq(integrationConnections.id, a.connectionId));
    expect(conn.status).toBe("verified");
    const log = await db.select().from(integrationEvents).where(eq(integrationEvents.connectionId, a.connectionId));
    expect(log.length).toBe(3);
    expect(JSON.stringify(log.map((l) => l.payload))).not.toContain(a.emp.employeeCode);
  });

  it("rejects malformed payloads after authentication", async () => {
    const raw = JSON.stringify({ events: [{ employeeCode: "X", kind: "sideways" }] });
    await expect(receiveDeviceWebhook(a.connectionId, raw, signDeviceBody("dev-secret-a", raw))).rejects.toMatchObject({ code: "VALIDATION" });
    const notJson = "events=1";
    await expect(receiveDeviceWebhook(a.connectionId, notJson, signDeviceBody("dev-secret-a", notJson))).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
