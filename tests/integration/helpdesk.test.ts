import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { withSystem } from "@/server/db/tx";
import { employees, legalEntities, membershipRoles, memberships, notifications, roles, ticketMessages, tickets } from "@/server/db/schema";
import type { RequestContext } from "@/server/auth/context";
import { createTicketCategory, listTicketCategories, seedDefaultTicketCategories } from "@/server/services/helpdesk/categories";
import {
  acceptTriage,
  assignableUsers,
  autoCloseResolved,
  createTicket,
  getTicket,
  listMyTickets,
  listQueue,
  rateTicket,
  reopenTicket,
  replyToTicket,
  updateTicket,
} from "@/server/services/helpdesk/tickets";
import { escalateOverdueTickets } from "@/server/services/helpdesk/sla";
import { draftTicketReply } from "@/server/services/helpdesk/drafts";
import { helpdeskInsights } from "@/server/services/helpdesk/insights";
import { createTicketSchema, replySchema, ticketCategorySchema } from "@/lib/validation/helpdesk";
import { addMember, contextFor, createOwnedTenant, createUser, uniqueEmail } from "../helpers/fixtures";

type Org = Awaited<ReturnType<typeof createOwnedTenant>>;

/** A custom role that can work tickets but not configure the helpdesk or see confidential queues. */
async function addAgent(tenantId: string) {
  const user = await createUser(uniqueEmail("agent"));
  const [m] = await db.insert(memberships).values({ tenantId, userId: user.id, status: "active" }).returning();
  const [role] = await db
    .insert(roles)
    .values({ tenantId, name: `Helpdesk agent ${user.id.slice(0, 4)}`, permissions: ["helpdesk.agent:all", "ai.use", "directory.view"] })
    .returning();
  await db.insert(membershipRoles).values({ tenantId, membershipId: m.id, roleId: role.id });
  return user;
}

async function employeeMember(org: Org, code: string, name: string) {
  const [le] = await db.select().from(legalEntities).where(eq(legalEntities.tenantId, org.tenant.id));
  const [e] = await db
    .insert(employees)
    .values({ tenantId: org.tenant.id, legalEntityId: le.id, employeeCode: code, firstName: name, displayName: name, joiningDate: "2025-04-01", status: "active" })
    .returning();
  const m = await addMember(org.tenant.id, ["employee"], { employeeId: e.id });
  return contextFor(org.tenant.id, m.user.id);
}

const ticket = (over: Partial<Record<string, unknown>> = {}) =>
  createTicketSchema.parse({ subject: "Payslip shows wrong TDS", description: "My September payslip deducted more TDS than my declaration.", priority: "normal", ...over });

describe("HR service desk", () => {
  let org: Org;
  let manager: RequestContext; // hr_admin: helpdesk.manage
  let agent: RequestContext;
  let pay1: RequestContext;
  let pay2: RequestContext;
  let alice: RequestContext;
  let bob: RequestContext;
  let payrollCat: string;
  let grievanceCat: string;

  beforeAll(async () => {
    org = await createOwnedTenant();
    const m = await addMember(org.tenant.id, ["hr_admin"]);
    const a = await addAgent(org.tenant.id);
    const p1 = await addMember(org.tenant.id, ["payroll_admin"]);
    const p2 = await addMember(org.tenant.id, ["payroll_admin"]);
    manager = await contextFor(org.tenant.id, m.user.id);
    agent = await contextFor(org.tenant.id, a.id);
    pay1 = await contextFor(org.tenant.id, p1.user.id);
    pay2 = await contextFor(org.tenant.id, p2.user.id);
    alice = await employeeMember(org, "E1", "Alice");
    bob = await employeeMember(org, "E2", "Bob");
  });

  it("seeds default categories idempotently", async () => {
    await expect(seedDefaultTicketCategories(alice)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await seedDefaultTicketCategories(manager)).added).toBe(7);
    expect(await seedDefaultTicketCategories(manager)).toEqual({ added: 0, skipped: 7 });
    const cats = await listTicketCategories(alice);
    payrollCat = cats.find((c) => c.name === "Payroll & payslips")!.id;
    grievanceCat = cats.find((c) => c.isSensitive)!.id;
    expect(cats.find((c) => c.id === payrollCat)?.ownerRoleKey).toBe("payroll_admin");
    await expect(
      createTicketCategory(agent, ticketCategorySchema.parse({ name: "Travel desk", ownerRoleKey: "hr_admin", firstResponseHours: 4, resolutionHours: 24 })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("numbers tickets, computes SLA due times, auto-assigns round-robin and triages", async () => {
    const t1 = await createTicket(alice, ticket({ categoryId: payrollCat }));
    const t2 = await createTicket(bob, ticket({ categoryId: payrollCat, subject: "PF number missing on payslip" }));
    expect(t1.number).toBe("HR-0001");
    expect(t2.number).toBe("HR-0002");
    const assignees = [t1.assigneeUserId, t2.assigneeUserId];
    expect(new Set(assignees)).toEqual(new Set([pay1.userId, pay2.userId]));

    const [row] = await db.select().from(tickets).where(eq(tickets.id, t1.id));
    expect(row.firstResponseDueAt!.getTime() - row.createdAt.getTime()).toBe(8 * 3_600_000);
    expect(row.resolutionDueAt!.getTime() - row.createdAt.getTime()).toBe(48 * 3_600_000);
    // AI is not configured locally: the keyword rules suggest the category.
    expect(row.aiTriage).toMatchObject({ categoryId: payrollCat, model: "rules" });

    // The assignee (payroll admin, no helpdesk role) can see and work their ticket; others' queues are hidden.
    const assignedTo = t1.assigneeUserId === pay1.userId ? pay1 : pay2;
    expect((await listQueue(assignedTo, { view: "all" })).map((t) => t.id)).toEqual([t1.id]);
    expect((await getTicket(assignedTo, t1.id)).canWork).toBe(true);
    await expect(listQueue(alice, { view: "all" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getTicket(bob, t1.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listMyTickets(alice)).map((t) => t.id)).toEqual([t1.id]);
  });

  it("hides internal notes from the requester and records the first response", async () => {
    const t = await createTicket(alice, ticket({ subject: "Need a salary certificate", description: "Please share a salary certificate for my visa application." }));
    expect((await listQueue(agent, { view: "unassigned" })).map((x) => x.id)).toContain(t.id);

    await replyToTicket(agent, replySchema.parse({ ticketId: t.id, body: "Checking with payroll.", internal: true }));
    let row = (await db.select().from(tickets).where(eq(tickets.id, t.id)))[0];
    expect(row.firstRespondedAt).toBeNull(); // internal notes are not a response

    const draft = await draftTicketReply(agent, t.id);
    expect(draft.source).toBe("rules");
    expect(draft.body).toContain(t.number);
    await replyToTicket(agent, replySchema.parse({ ticketId: t.id, body: draft.body, aiAssisted: true, status: "waiting_on_employee" }));
    row = (await db.select().from(tickets).where(eq(tickets.id, t.id)))[0];
    expect(row.firstRespondedAt).not.toBeNull();
    expect(row.status).toBe("waiting_on_employee");

    const seen = await getTicket(alice, t.id);
    expect(seen.messages.map((m) => m.isInternal)).toEqual([false]);
    expect(seen.messages[0].aiAssisted).toBe(true);
    // RLS enforces it too, not just the service.
    const raw = await alice.db((tx) => tx.select().from(ticketMessages).where(eq(ticketMessages.ticketId, t.id)));
    expect(raw.every((m) => !m.isInternal)).toBe(true);
    expect((await getTicket(agent, t.id)).messages).toHaveLength(2);

    await expect(replyToTicket(alice, replySchema.parse({ ticketId: t.id, body: "sneaky note", internal: true }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await replyToTicket(alice, replySchema.parse({ ticketId: t.id, body: "It's for a Schengen visa." }));
    expect((await db.select().from(tickets).where(eq(tickets.id, t.id)))[0].status).toBe("in_progress");
  });

  it("routes sensitive matters by rule and isolates them from regular agents", async () => {
    const t = await createTicket(alice, ticket({ subject: "Concern about my team lead", description: "My team lead keeps harassing me during meetings and I feel unsafe." }));
    const [row] = await db.select().from(tickets).where(eq(tickets.id, t.id));
    expect(row).toMatchObject({ categoryId: grievanceCat, priority: "high", assigneeUserId: manager.userId });
    expect(row.aiTriage?.model).toBe("rules:sensitive");

    await expect(getTicket(agent, t.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listQueue(agent, { view: "all" })).map((x) => x.id)).not.toContain(t.id);
    expect(await agent.db((tx) => tx.select().from(tickets).where(eq(tickets.id, t.id)))).toHaveLength(0);
    await expect(getTicket(bob, t.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getTicket(manager, t.id)).canWork).toBe(true);
    expect((await getTicket(alice, t.id)).isRequester).toBe(true);
    // Only helpdesk managers can be assigned confidential tickets.
    const options = await assignableUsers(manager, t.id);
    expect(options.map((o) => o.userId)).not.toContain(agent.userId);
    await expect(updateTicket(manager, { id: t.id, assigneeUserId: agent.userId })).rejects.toMatchObject({ code: "VALIDATION" });
    const draft = await draftTicketReply(manager, t.id);
    expect(draft.note).toMatch(/never sent to AI/);
    // Regular agents cannot move tickets into the confidential queue.
    const other = await createTicket(bob, ticket({ subject: "Question about my bonus", description: "When is the annual bonus paid out this year?" }));
    await expect(updateTicket(agent, { id: other.id, categoryId: grievanceCat })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("accepts triage, resolves, reopens within 7 days, rates and auto-closes", async () => {
    const t = await createTicket(bob, ticket({ subject: "Laptop password expired", description: "My laptop password expired and I cannot log in to email." }));
    const before = await getTicket(agent, t.id);
    expect(before.categoryId).toBeNull();
    expect(before.triage?.categoryName).toBe("IT & assets");
    await acceptTriage(agent, t.id);
    const [row] = await db.select().from(tickets).where(eq(tickets.id, t.id));
    expect(row.categoryId).toBe(before.triage!.categoryId);
    expect(row.assigneeUserId).toBe(manager.userId); // IT & assets is owned by hr_admin
    expect(row.firstResponseDueAt!.getTime() - row.createdAt.getTime()).toBe(4 * 3_600_000);

    await updateTicket(manager, { id: t.id, status: "resolved" });
    expect((await getTicket(bob, t.id)).canReopen).toBe(true);
    await reopenTicket(bob, t.id);
    expect((await db.select().from(tickets).where(eq(tickets.id, t.id)))[0]).toMatchObject({ status: "open", resolvedAt: null });
    await updateTicket(manager, { id: t.id, status: "resolved" });
    await expect(rateTicket(alice, { id: t.id, rating: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await rateTicket(bob, { id: t.id, rating: 5 });

    // Resolved more than 7 days ago: auto-closed by the job, no longer reopenable.
    await db.update(tickets).set({ resolvedAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(tickets.id, t.id));
    await expect(reopenTicket(bob, t.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    const closed = await withSystem((tx) => autoCloseResolved(tx, org.tenant.id), org.tenant.id);
    expect(closed).toBe(1);
    expect((await db.select().from(tickets).where(eq(tickets.id, t.id)))[0]).toMatchObject({ status: "closed", satisfaction: 5 });
    await expect(replyToTicket(bob, replySchema.parse({ ticketId: t.id, body: "one more thing" }))).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("escalates SLA breaches once and reports insights", async () => {
    const t = await createTicket(alice, ticket({ categoryId: payrollCat, subject: "Arrears not paid", description: "My salary revision arrears were not paid this month." }));
    await db.update(tickets).set({ firstResponseDueAt: new Date(Date.now() - 60_000) }).where(eq(tickets.id, t.id));
    const first = await withSystem((tx) => escalateOverdueTickets(tx, org.tenant.id), org.tenant.id);
    expect(first.escalated).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(tickets).where(eq(tickets.id, t.id));
    expect(row.escalatedAt).not.toBeNull();
    const countFor = async () =>
      (await db.select().from(notifications).where(and(eq(notifications.tenantId, org.tenant.id), eq(notifications.dedupeKey, `ticket:${t.id}:sla:first_response`)))).length;
    const n1 = await countFor();
    expect(n1).toBe(3); // the assignee plus both helpdesk managers (HR admin and the tenant owner)
    await withSystem((tx) => escalateOverdueTickets(tx, org.tenant.id), org.tenant.id);
    expect(await countFor()).toBe(n1);

    const stats = await helpdeskInsights(manager);
    expect(stats.total).toBeGreaterThanOrEqual(7);
    expect(stats.byCategory.find((c) => c.name === "Payroll & payslips")?.total).toBeGreaterThanOrEqual(3);
    expect(stats.slaBreachRate).toBeGreaterThan(0);
    expect(stats.medianFirstResponseHours).not.toBeNull();
    expect(stats.satisfaction.ratings).toBe(1);
    // Regular agents' insights exclude the confidential queue (RLS).
    expect((await helpdeskInsights(agent)).total).toBe(stats.total - 1);
    await expect(helpdeskInsights(alice)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("isolates tickets across tenants", async () => {
    const other = await createOwnedTenant();
    const owner = await contextFor(other.tenant.id, other.user.id);
    const [mine] = await listMyTickets(alice);
    await expect(getTicket(owner, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listQueue(owner, { view: "all" })).toHaveLength(0);
  });
});
