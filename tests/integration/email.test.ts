import { describe, expect, it, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { emailOutbox } from "@/server/db/schema";
import { enqueueEmail, renderEmail, sendNow, MAX_EMAIL_ATTEMPTS, type EmailProvider } from "@/server/services/email";
import { contextFor, createOwnedTenant } from "../helpers/fixtures";

const MAILPIT = "http://127.0.0.1:54324";

async function mailpitSearch(address: string) {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`);
  expect(res.ok).toBe(true);
  return (await res.json()) as { messages: { ID: string; Subject: string; To: { Address: string }[] }[] };
}

async function waitForMail(address: string, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const found = await mailpitSearch(address);
    if (found.messages.length || Date.now() > until) return found.messages;
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe("email outbox", () => {
  let owner: Awaited<ReturnType<typeof createOwnedTenant>>;

  beforeAll(async () => {
    owner = await createOwnedTenant();
  });

  it("escapes user-provided strings in the layout", () => {
    const { html, text } = renderEmail({
      title: "Hello <script>",
      body: ['Tom & "Jerry"'],
      cta: { label: "Open", href: "javascript:alert(1)" },
    });
    expect(html).toContain("Hello &lt;script&gt;");
    expect(html).toContain("Tom &amp; &quot;Jerry&quot;");
    expect(html).not.toContain("javascript:");
    expect(text).toContain("Hello <script>");
  });

  it("enqueues under tenant RLS and delivers to Mailpit", async () => {
    const ctx = await contextFor(owner.tenant.id, owner.user.id);
    const to = `outbox-${randomUUID().slice(0, 8)}@test.peoplesuccess.local`;
    const { html, text } = renderEmail({ title: "Outbox test", body: "Delivered by the integration test.", cta: { label: "Open", href: "http://localhost:3100/overview" } });
    const id = await ctx.db((tx) =>
      enqueueEmail(tx, { tenantId: ctx.tenantId, to, template: "test", subject: "Outbox test", html, text, dedupeKey: `test:${to}` }),
    );
    expect(id).toBeTruthy();

    // Same dedupe key is ignored.
    const dup = await ctx.db((tx) =>
      enqueueEmail(tx, { tenantId: ctx.tenantId, to, template: "test", subject: "Outbox test", html, text, dedupeKey: `test:${to}` }),
    );
    expect(dup).toBeNull();

    expect(await sendNow(id)).toBe("sent");
    const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, id!));
    expect(row.status).toBe("sent");
    expect(row.attempts).toBe(1);
    expect(row.provider).toBe("smtp");
    expect(row.sentAt).toBeTruthy();

    // Idempotent: a sent row is never sent again.
    expect(await sendNow(id)).toBeNull();

    const messages = await waitForMail(to);
    expect(messages).toHaveLength(1);
    expect(messages[0].Subject).toBe("Outbox test");
  });

  it("rejects enqueueing for another tenant under RLS", async () => {
    const other = await createOwnedTenant();
    const ctx = await contextFor(owner.tenant.id, owner.user.id);
    await expect(
      ctx.db((tx) => enqueueEmail(tx, { tenantId: other.tenant.id, to: "x@example.com", template: "test", subject: "x", html: "x" })),
    ).rejects.toThrow();
  });

  it("retries failures and marks the row dead after the maximum attempts", async () => {
    const failing: EmailProvider = {
      name: "failing",
      send: async () => {
        throw new Error("SMTP 451 temporary failure ".repeat(50));
      },
    };
    const ctx = await contextFor(owner.tenant.id, owner.user.id);
    const id = await ctx.db((tx) =>
      enqueueEmail(tx, { tenantId: ctx.tenantId, to: "dead@example.com", template: "test", subject: "Will fail", html: "<p>x</p>" }),
    );
    for (let i = 1; i < MAX_EMAIL_ATTEMPTS; i++) expect(await sendNow(id, { provider: failing })).toBe("failed");
    expect(await sendNow(id, { provider: failing })).toBe("dead");
    expect(await sendNow(id, { provider: failing })).toBeNull();
    const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, id!));
    expect(row.status).toBe("dead");
    expect(row.attempts).toBe(MAX_EMAIL_ATTEMPTS);
    expect(row.lastError!.length).toBeLessThanOrEqual(500);
  });
});
