import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiExecutions, aiMessages, employees, knowledgeChunks, legalEntities, policies, tickets } from "@/server/db/schema";
import type { RequestContext } from "@/server/auth/context";
import { setProviderForTests, type LlmProvider, type LlmRequest } from "@/server/ai/providers";
import {
  EXCERPTS_INTRO,
  NOT_FOUND_MESSAGE,
  SENSITIVE_MESSAGE,
  askAssistant,
  getConversation,
  listConversations,
  raiseTicketFromMessage,
  setAssistantFeedback,
} from "@/server/services/assistant/conversations";
import { chunkMarkdown, reindexKnowledge } from "@/server/services/helpdesk/knowledge";
import { searchKnowledge } from "@/server/services/assistant/retrieval";
import { createKbArticle, publishKbArticle } from "@/server/services/helpdesk/kb";
import { addMember, contextFor, createOwnedTenant } from "../helpers/fixtures";

const LEAVE_POLICY = `# Leave policy

All leave is requested in PeopleSuccess and approved by your reporting manager.

## Paternity leave

Employees are entitled to 10 working days of paternity leave, to be taken within six months of the child's birth or adoption.

## Casual leave

Employees get 12 days of casual leave per calendar year, credited monthly. Unused casual leave lapses on 31 December.
`;

type Stub = LlmProvider & { calls: LlmRequest[]; respond: (req: LlmRequest) => unknown };

function stubProvider(respond: (req: LlmRequest) => unknown): Stub {
  const p: Stub = {
    name: "anthropic",
    defaultModel: "claude-opus-5-5",
    calls: [],
    respond,
    async complete(req) {
      p.calls.push(req);
      return {
        provider: "anthropic",
        model: "claude-opus-5-5",
        text: "",
        parsed: p.respond(req),
        inputTokens: 900,
        outputTokens: 120,
        refused: false,
        refusalCategory: null,
        stopReason: "end_turn",
        fellBack: false,
      };
    },
  };
  return p;
}

/** Ids of the excerpts the assistant put in the prompt, in order. */
const excerptIds = (req: LlmRequest) => [...req.messages[0].content.matchAll(/id=([0-9a-f-]{36})/g)].map((m) => m[1]);

describe("Flow G: HR assistant answers from published policies", () => {
  let org: Awaited<ReturnType<typeof createOwnedTenant>>;
  let hr: RequestContext;
  let emp: RequestContext;
  let colleague: RequestContext;
  let policyId: string;

  beforeAll(async () => {
    org = await createOwnedTenant();
    const [le] = await db.select().from(legalEntities).where(eq(legalEntities.tenantId, org.tenant.id));
    const [e] = await db
      .insert(employees)
      .values({ tenantId: org.tenant.id, legalEntityId: le.id, employeeCode: "E1", firstName: "Dev", displayName: "Dev Shah", joiningDate: "2025-04-01", status: "active" })
      .returning();
    const h = await addMember(org.tenant.id, ["hr_admin"]);
    const u = await addMember(org.tenant.id, ["employee"], { employeeId: e.id });
    const c = await addMember(org.tenant.id, ["employee"]);
    hr = await contextFor(org.tenant.id, h.user.id);
    emp = await contextFor(org.tenant.id, u.user.id);
    colleague = await contextFor(org.tenant.id, c.user.id);
    [{ id: policyId }] = await db
      .insert(policies)
      .values({ tenantId: org.tenant.id, title: "Leave policy", category: "leave", body: LEAVE_POLICY, version: 1, effectiveFrom: "2026-04-01", status: "published", publishedAt: new Date() })
      .returning({ id: policies.id });
    // A draft must never be indexed.
    await db.insert(policies).values({ tenantId: org.tenant.id, title: "Draft sabbatical policy", body: "Sabbatical leave of 3 months after 5 years.", effectiveFrom: "2026-04-01", status: "draft" });
  });

  afterEach(() => setProviderForTests(undefined as never));

  it("chunks Markdown by heading and indexes only published content", async () => {
    const chunks = chunkMarkdown("Leave policy", LEAVE_POLICY);
    expect(chunks.map((c) => c.heading)).toEqual(["Leave policy", "Paternity leave", "Casual leave"]);
    expect(chunkMarkdown("Long", `## Section\n\n${"Sentence number one is here. ".repeat(80)}`).every((c) => c.content.length <= 800)).toBe(true);

    await expect(reindexKnowledge(emp)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const first = await reindexKnowledge(hr);
    expect(first).toMatchObject({ indexed: 1, chunks: 3, removed: 0 });
    expect(await reindexKnowledge(hr)).toMatchObject({ indexed: 0, unchanged: 1 });
    const rows = await db.select().from(knowledgeChunks).where(eq(knowledgeChunks.tenantId, org.tenant.id));
    expect(rows.every((r) => r.sourceId === policyId && r.sourceVersion === 1)).toBe(true);
  });

  it("answers with validated citations (bogus ids dropped) and records the exchange", async () => {
    const bogus = randomUUID();
    const stub = stubProvider((req) => {
      const ids = excerptIds(req);
      return { answer: "You get 10 working days of paternity leave, to be used within six months of the birth.", citations: [ids[0], bogus], confidence: "high", needsHuman: false, sensitive: false };
    });
    setProviderForTests(stub);
    const r = await askAssistant(emp, { conversationId: null, question: "How many days of paternity leave do I get?" });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].messages[0].content).toContain("10 working days of paternity leave");
    const a = r.assistantMessage;
    expect(a.outcome).toBe("answered");
    expect(a.source).toBe("ai");
    expect(a.content).toMatch(/10 working days/);
    expect(a.citations).toHaveLength(1);
    expect(a.citations[0]).toMatchObject({ sourceType: "policy", sourceId: policyId, title: "Leave policy", heading: "Paternity leave", version: 1, href: `/documents/policies/${policyId}` });
    expect(a.citations.map((c) => c.chunkId)).not.toContain(bogus);

    const [stored] = await db.select().from(aiMessages).where(eq(aiMessages.id, a.id));
    expect(stored).toMatchObject({ role: "assistant", outcome: "answered", conversationId: r.conversationId });
    const [exec] = await db.select().from(aiExecutions).where(eq(aiExecutions.id, stored.executionId!));
    expect(exec).toMatchObject({ status: "succeeded", agentKey: "helpdesk", conversationId: r.conversationId });

    await setAssistantFeedback(emp, { messageId: a.id, value: 1 });
    expect((await db.select().from(aiMessages).where(eq(aiMessages.id, a.id)))[0].feedback).toBe(1);

    const conv = await getConversation(emp, r.conversationId);
    expect(conv.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect((await listConversations(emp)).map((c) => c.id)).toContain(r.conversationId);
  });

  it("escalates an unrelated question honestly and raises a linked ticket", async () => {
    const stub = stubProvider(() => ({ answer: "x", citations: [], confidence: "low", needsHuman: true, sensitive: false }));
    setProviderForTests(stub);
    const r = await askAssistant(emp, { conversationId: null, question: "What is on the cafeteria menu this Friday?" });
    expect(stub.calls).toHaveLength(0); // nothing retrieved: no model call at all
    expect(r.assistantMessage).toMatchObject({ outcome: "insufficient_sources", content: NOT_FOUND_MESSAGE, citations: [] });

    const raised = await raiseTicketFromMessage(emp, r.assistantMessage.id);
    expect(raised.alreadyRaised).toBe(false);
    const [t] = await db.select().from(tickets).where(eq(tickets.id, raised.ticketId));
    expect(t).toMatchObject({ channel: "assistant", requesterUserId: emp.userId, status: "open" });
    expect(t.description).toContain("cafeteria menu");
    const [m] = await db.select().from(aiMessages).where(eq(aiMessages.id, r.assistantMessage.id));
    expect(m).toMatchObject({ ticketId: t.id, outcome: "escalated" });
    expect((await raiseTicketFromMessage(emp, r.assistantMessage.id)).alreadyRaised).toBe(true);
    expect((await getConversation(emp, r.conversationId)).messages[1].ticket?.number).toBe(t.number);
  });

  it("treats low-confidence model answers as not found", async () => {
    setProviderForTests(stubProvider((req) => ({ answer: "Probably 5 days.", citations: excerptIds(req).slice(0, 1), confidence: "low", needsHuman: false, sensitive: false })));
    const r = await askAssistant(emp, { conversationId: null, question: "Can I carry casual leave forward?" });
    expect(r.assistantMessage).toMatchObject({ outcome: "insufficient_sources", citations: [] });
  });

  it("routes sensitive questions to a person without calling the model", async () => {
    const stub = stubProvider(() => ({ answer: "x", citations: [], confidence: "high", needsHuman: false, sensitive: false }));
    setProviderForTests(stub);
    const r = await askAssistant(emp, { conversationId: null, question: "How do I report harassment by my manager?" });
    expect(stub.calls).toHaveLength(0);
    expect(r.assistantMessage).toMatchObject({ outcome: "escalated", content: SENSITIVE_MESSAGE });
  });

  it("falls back to verbatim excerpts when AI is unavailable", async () => {
    setProviderForTests(null);
    const r = await askAssistant(emp, { conversationId: null, question: "paternity leave days" });
    expect(r.assistantMessage.outcome).toBe("answered");
    expect(r.assistantMessage.source).toBe("rules");
    expect(r.assistantMessage.content.startsWith(EXCERPTS_INTRO)).toBe(true);
    expect(r.assistantMessage.content).toContain("10 working days of paternity leave");
    expect(r.assistantMessage.citations[0]).toMatchObject({ heading: "Paternity leave" });

    const none = await askAssistant(emp, { conversationId: r.conversationId, question: "office parking rules" });
    expect(none.assistantMessage.outcome).toBe("insufficient_sources");
    expect(none.conversationId).toBe(r.conversationId);
  });

  it("picks up republished policies and KB articles", async () => {
    setProviderForTests(null);
    await db
      .update(policies)
      .set({ body: LEAVE_POLICY.replace("10 working days", "15 working days"), version: 2, updatedAt: new Date() })
      .where(eq(policies.id, policyId));
    const r = await askAssistant(emp, { conversationId: null, question: "paternity leave days" });
    expect(r.assistantMessage.content).toContain("15 working days");
    expect(r.assistantMessage.citations[0].version).toBe(2);

    const art = await createKbArticle(hr, { title: "How to download Form 16", category: "payroll", body: "Form 16 is available under Payroll → Tax documents every June. Download the PDF from there." });
    expect((await askAssistant(emp, { conversationId: null, question: "download form 16" })).assistantMessage.outcome).toBe("insufficient_sources");
    await publishKbArticle(hr, art.id);
    const kb = await askAssistant(emp, { conversationId: null, question: "download form 16" });
    expect(kb.assistantMessage.citations[0]).toMatchObject({ sourceType: "kb_article", sourceId: art.id, href: `/helpdesk/kb/${art.id}` });
  });

  it("keeps conversations private and knowledge tenant-scoped", async () => {
    const [mine] = await listConversations(emp);
    await expect(getConversation(colleague, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listConversations(colleague)).toHaveLength(0);
    await expect(askAssistant(colleague, { conversationId: mine.id, question: "paternity leave?" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const other = await createOwnedTenant();
    const owner = await contextFor(other.tenant.id, other.user.id);
    await expect(getConversation(owner, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await owner.db((tx) => searchKnowledge(tx, org.tenant.id, "paternity leave"))).toHaveLength(0);
    setProviderForTests(null);
    expect((await askAssistant(owner, { conversationId: null, question: "paternity leave days" })).assistantMessage.outcome).toBe("insufficient_sources");
  });
});
