import "server-only";
import { randomUUID } from "node:crypto";
import { aliasedTable, and, asc, desc, eq, inArray, isNull, lt, notInArray, sql, type SQL } from "drizzle-orm";
import type { RequestContext } from "../../auth/context";
import type { Tx } from "../../db/client";
import { documents, employees, ticketCategories, ticketMessages, tickets, users } from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { forbidden, invalidState, notFound, validation } from "../../lib/errors";
import { nextCounter } from "../employees/codes";
import { emitDomainEvent } from "../events";
import { notify } from "../notifications";
import { userIdsWithPermission } from "../directory";
import { attachmentDownloadUrl, discardAttachment, insertAttachmentRow, prepareAttachment, type PreparedAttachment } from "../expenses/attachments";
import type { CreateTicketInput, QueueFilter, ReplyInput, TicketPriority, TicketStatus, UpdateTicketInput } from "@/lib/validation/helpdesk";
import { eligibleAssignees, pickAssignee } from "./assignment";
import { triageTicket, type AiTriage } from "./triage";
import {
  AUTO_CLOSE_DAYS,
  DEFAULT_SLA,
  REOPEN_WINDOW_DAYS,
  atLeast,
  canManageHelpdesk,
  isHelpdeskAgent,
  sensitiveTopic,
  slaDue,
} from "./rules";

type TicketRow = typeof tickets.$inferSelect;
type CategoryRow = typeof ticketCategories.$inferSelect;

export const MAX_TICKET_ATTACHMENTS = 5;
const CLOSED_STATES: TicketStatus[] = ["resolved", "closed"];

const formatTicketNumber = (n: number) => `HR-${String(n).padStart(4, "0")}`;

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

/**
 * RLS already limits which tickets a user can read (requester, assignee,
 * helpdesk.manage, or helpdesk.agent for non-sensitive categories). On top
 * of that, a user "works" a ticket when they are its assignee or helpdesk
 * staff allowed to see it — and never their own ticket.
 */
function canWork(ctx: RequestContext, t: Pick<TicketRow, "assigneeUserId" | "requesterUserId">, category: Pick<CategoryRow, "isSensitive"> | null) {
  if (t.assigneeUserId === ctx.userId) return true;
  if (t.requesterUserId === ctx.userId && !canManageHelpdesk(ctx)) return false;
  if (canManageHelpdesk(ctx)) return true;
  return isHelpdeskAgent(ctx) && !category?.isSensitive;
}

async function loadTicket(tx: Tx, id: string, lock = false) {
  const q = tx
    .select({ t: tickets, c: ticketCategories })
    .from(tickets)
    .leftJoin(ticketCategories, eq(ticketCategories.id, tickets.categoryId))
    .where(eq(tickets.id, id));
  const [row] = lock ? await q.for("update", { of: tickets }) : await q;
  if (!row) throw notFound("Ticket");
  return row;
}

function statusPatch(t: TicketRow, status: TicketStatus, now: Date): Partial<TicketRow> {
  if (status === t.status) return {};
  if (status === "resolved") return { status, resolvedAt: now, closedAt: null };
  if (status === "closed") return { status, closedAt: now, resolvedAt: t.resolvedAt ?? now };
  return { status, resolvedAt: null, closedAt: null };
}

async function notifyResolved(tx: Tx, ctx: RequestContext, t: TicketRow) {
  await notify(tx, {
    tenantId: ctx.tenantId,
    userIds: [t.requesterUserId].filter((u) => u !== ctx.userId),
    category: "helpdesk",
    title: `${t.number} was resolved`,
    body: `Not sorted? You can reopen it within ${REOPEN_WINDOW_DAYS} days, or rate the help you received.`,
    href: `/helpdesk/${t.id}`,
    dedupeKey: `ticket:${t.id}:resolved:${Date.now()}`,
  });
  await emitDomainEvent(tx, ctx.tenantId, "ticket.resolved", { ticketId: t.id, categoryId: t.categoryId });
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export type CreateTicketOptions = { channel?: "portal" | "assistant" | "email"; files?: File[] };

/**
 * Raise a ticket. SLA due times come from the category (calendar hours).
 * Sensitive wording routes the ticket to the confidential category with high
 * priority by a deterministic rule — never by AI, and such text is never sent
 * to a model. Otherwise AI (or keyword rules) suggests a category and
 * priority that an agent accepts or changes.
 */
export async function createTicket(ctx: RequestContext, input: CreateTicketInput, opts: CreateTicketOptions = {}) {
  const files = (opts.files ?? []).filter((f) => f && f.size > 0);
  if (files.length > MAX_TICKET_ATTACHMENTS) throw validation(`Attach at most ${MAX_TICKET_ATTACHMENTS} files.`, { files: ["Too many files"] });

  const categories = await ctx.db((tx) => tx.select().from(ticketCategories).where(eq(ticketCategories.isActive, true)));
  const chosen = input.categoryId ? categories.find((c) => c.id === input.categoryId) : null;
  if (input.categoryId && !chosen) throw validation("Choose an active category.", { categoryId: ["Choose an active category"] });

  const text = `${input.subject}\n${input.description}`;
  const topic = sensitiveTopic(text);
  const confidential = categories.filter((c) => c.isSensitive).sort((a, b) => Number(b.name === "Grievance") - Number(a.name === "Grievance"))[0] ?? null;

  let category: CategoryRow | null = chosen ?? null;
  let priority: TicketPriority = input.priority;
  let aiTriage: AiTriage | null = null;
  if (topic) {
    if (confidential && !chosen?.isSensitive) category = confidential;
    priority = atLeast(priority, "high");
    aiTriage = {
      ...(category?.isSensitive ? { categoryId: category.id } : {}),
      priority: "high",
      confidence: 1,
      rationale: category?.isSensitive
        ? `Routed to ${category.name} by the sensitive-topic rule (${topic}). Not sent to AI.`
        : `Sensitive-topic rule matched (${topic}) but no confidential category is configured. Not sent to AI.`,
      model: "rules:sensitive",
    };
  } else if (!chosen?.isSensitive) {
    aiTriage = await triageTicket({ tenantId: ctx.tenantId, userId: ctx.userId }, input, categories);
  }

  const ticketId = randomUUID();
  const sla = category ?? DEFAULT_SLA;
  const createdAt = new Date();
  const due = slaDue(createdAt, sla);
  const assigneeUserId = category ? await pickAssignee(ctx.tenantId, category, { excludeUserId: ctx.userId }) : null;

  const prepared: PreparedAttachment[] = [];
  try {
    for (const f of files) prepared.push(await prepareAttachment(ctx, f, { ownerType: "ticket", ownerId: ticketId }));
    return await ctx.db(async (tx) => {
      const number = formatTicketNumber(await nextCounter(tx, ctx.tenantId, "ticket"));
      const [t] = await tx
        .insert(tickets)
        .values({
          id: ticketId,
          tenantId: ctx.tenantId,
          number,
          requesterEmployeeId: ctx.employeeId,
          requesterUserId: ctx.userId,
          categoryId: category?.id ?? null,
          subject: input.subject,
          description: input.description,
          priority,
          status: "open",
          assigneeUserId,
          channel: opts.channel ?? "portal",
          firstResponseDueAt: due.firstResponseDueAt,
          resolutionDueAt: due.resolutionDueAt,
          aiTriage,
          createdAt,
        })
        .returning();
      for (const p of prepared) {
        await insertAttachmentRow(tx, ctx, p, {
          ownerType: "ticket",
          ownerId: t.id,
          employeeId: ctx.employeeId,
          title: p.fileName,
          category: "other",
          isSensitive: !!category?.isSensitive,
        });
      }
      await audit(tx, ctx, {
        action: "ticket.created",
        entityType: "ticket",
        entityId: t.id,
        metadata: { number, categoryId: t.categoryId, priority, channel: t.channel, assigned: !!assigneeUserId, sensitiveRule: !!topic, attachments: prepared.length },
      });
      // Keep confidential subjects out of notification text.
      const label = category?.isSensitive ? `${number} (confidential)` : `${number}: ${input.subject.slice(0, 80)}`;
      const recipients = assigneeUserId ? [assigneeUserId] : await userIdsWithPermission(tx, ctx.tenantId, "helpdesk.manage");
      await notify(tx, {
        tenantId: ctx.tenantId,
        userIds: recipients.filter((u) => u !== ctx.userId),
        category: "helpdesk",
        title: assigneeUserId ? `Ticket assigned to you · ${label}` : `New unassigned ticket · ${label}`,
        body: `Priority ${priority}. First response due within ${sla.firstResponseHours} hours.`,
        href: `/helpdesk/${t.id}`,
        dedupeKey: `ticket:${t.id}:created`,
      });
      await emitDomainEvent(tx, ctx.tenantId, "ticket.created", { ticketId: t.id, categoryId: t.categoryId, channel: t.channel });
      return { id: t.id, number, categoryId: t.categoryId, assigneeUserId, priority };
    });
  } catch (err) {
    for (const p of prepared) await discardAttachment(p);
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

const requester = aliasedTable(users, "requester");
const assignee = aliasedTable(users, "assignee");

export type TicketListItem = {
  id: string;
  number: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  channel: string;
  categoryName: string | null;
  isSensitive: boolean;
  requesterName: string | null;
  assigneeName: string | null;
  assigneeUserId: string | null;
  createdAt: string;
  updatedAt: string;
  firstResponseDueAt: string | null;
  resolutionDueAt: string | null;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  overdue: boolean;
  escalated: boolean;
};

const overdueSql = sql<boolean>`(${tickets.status} not in ('resolved','closed') and (
  (${tickets.firstRespondedAt} is null and ${tickets.firstResponseDueAt} < now())
  or (${tickets.resolutionDueAt} < now())
))`;

async function selectTickets(tx: Tx, where: SQL | undefined, limit = 300): Promise<TicketListItem[]> {
  const rows = await tx
    .select({
      t: tickets,
      categoryName: ticketCategories.name,
      isSensitive: ticketCategories.isSensitive,
      requesterName: sql<string | null>`coalesce(${requester.fullName}, ${requester.email})`,
      assigneeName: sql<string | null>`coalesce(${assignee.fullName}, ${assignee.email})`,
      overdue: overdueSql,
    })
    .from(tickets)
    .leftJoin(ticketCategories, eq(ticketCategories.id, tickets.categoryId))
    .leftJoin(requester, eq(requester.id, tickets.requesterUserId))
    .leftJoin(assignee, eq(assignee.id, tickets.assigneeUserId))
    .where(where)
    .orderBy(sql`case when ${tickets.status} in ('resolved','closed') then 1 else 0 end`, desc(tickets.updatedAt))
    .limit(limit);
  return rows.map(({ t, categoryName, isSensitive, requesterName, assigneeName, overdue }) => ({
    id: t.id,
    number: t.number,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    channel: t.channel,
    categoryName,
    isSensitive: !!isSensitive,
    requesterName,
    assigneeName,
    assigneeUserId: t.assigneeUserId,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    firstResponseDueAt: t.firstResponseDueAt?.toISOString() ?? null,
    resolutionDueAt: t.resolutionDueAt?.toISOString() ?? null,
    firstRespondedAt: t.firstRespondedAt?.toISOString() ?? null,
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
    overdue: !!overdue,
    escalated: !!t.escalatedAt,
  }));
}

export async function listMyTickets(ctx: RequestContext) {
  return ctx.db((tx) => selectTickets(tx, eq(tickets.requesterUserId, ctx.userId)));
}

/** Whether the user should see the agent queue (staff, or someone with assigned tickets). */
export async function queueAccess(ctx: RequestContext) {
  if (isHelpdeskAgent(ctx)) return "agent" as const;
  const [row] = await ctx.db((tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(tickets)
      .where(eq(tickets.assigneeUserId, ctx.userId)),
  );
  return Number(row?.n ?? 0) > 0 ? ("assignee" as const) : null;
}

export async function listQueue(ctx: RequestContext, filter: QueueFilter) {
  const access = await queueAccess(ctx);
  if (!access) throw forbidden();
  const view = access === "agent" ? filter.view : "mine";
  const status = filter.status ?? "active";
  return ctx.db((tx) =>
    selectTickets(
      tx,
      and(
        view === "mine" ? eq(tickets.assigneeUserId, ctx.userId) : undefined,
        view === "unassigned" ? isNull(tickets.assigneeUserId) : undefined,
        view === "overdue" ? overdueSql : undefined,
        status === "active" ? notInArray(tickets.status, CLOSED_STATES) : eq(tickets.status, status),
        filter.categoryId ? eq(tickets.categoryId, filter.categoryId) : undefined,
        // Staff never work their own tickets from the queue.
        access === "agent" && !canManageHelpdesk(ctx) ? sql`${tickets.requesterUserId} <> ${ctx.userId}` : undefined,
      ),
      500,
    ),
  );
}

export async function queueCounts(ctx: RequestContext) {
  if (!isHelpdeskAgent(ctx)) return null;
  const [row] = await ctx.db((tx) =>
    tx
      .select({
        mine: sql<number>`count(*) filter (where ${tickets.assigneeUserId} = ${ctx.userId})::int`,
        unassigned: sql<number>`count(*) filter (where ${tickets.assigneeUserId} is null)::int`,
        overdue: sql<number>`count(*) filter (where ${overdueSql})::int`,
        all: sql<number>`count(*)::int`,
      })
      .from(tickets)
      .where(notInArray(tickets.status, CLOSED_STATES)),
  );
  return { mine: Number(row.mine), unassigned: Number(row.unassigned), overdue: Number(row.overdue), all: Number(row.all) };
}

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

export type TicketMessageView = {
  id: string;
  body: string;
  isInternal: boolean;
  aiAssisted: boolean;
  authorName: string | null;
  fromRequester: boolean;
  mine: boolean;
  createdAt: string;
};

export type TicketDetail = TicketListItem & {
  description: string;
  satisfaction: number | null;
  closedAt: string | null;
  categoryId: string | null;
  requester: { userId: string; name: string | null; employeeId: string | null; employeeCode: string | null };
  messages: TicketMessageView[];
  attachments: { id: string; fileName: string; sizeBytes: number }[];
  triage: (AiTriage & { categoryName: string | null }) | null;
  isRequester: boolean;
  canWork: boolean;
  canReopen: boolean;
  canRate: boolean;
  canManage: boolean;
};

const author = aliasedTable(users, "author");

export async function getTicket(ctx: RequestContext, id: string): Promise<TicketDetail> {
  return ctx.db(async (tx) => {
    const { t, c } = await loadTicket(tx, id);
    const [list] = await selectTickets(tx, eq(tickets.id, id), 1);
    const working = canWork(ctx, t, c);
    const isRequester = t.requesterUserId === ctx.userId;
    // RLS hides internal notes from non-staff; requesters who are also staff don't see notes about their own ticket.
    const showInternal = working && !isRequester;
    const [msgs, attachments, emp] = await Promise.all([
      tx
        .select({ m: ticketMessages, authorName: sql<string | null>`coalesce(${author.fullName}, ${author.email})` })
        .from(ticketMessages)
        .leftJoin(author, eq(author.id, ticketMessages.authorUserId))
        .where(and(eq(ticketMessages.ticketId, id), showInternal ? undefined : eq(ticketMessages.isInternal, false)))
        .orderBy(asc(ticketMessages.createdAt)),
      tx
        .select({ id: documents.id, fileName: documents.fileName, sizeBytes: documents.sizeBytes })
        .from(documents)
        .where(and(eq(documents.ownerType, "ticket"), eq(documents.ownerId, id), isNull(documents.deletedAt)))
        .orderBy(asc(documents.createdAt)),
      t.requesterEmployeeId
        ? tx.select({ code: employees.employeeCode }).from(employees).where(eq(employees.id, t.requesterEmployeeId))
        : Promise.resolve([] as { code: string }[]),
    ]);
    let triage: TicketDetail["triage"] = null;
    if (t.aiTriage && working) {
      const [cat] = t.aiTriage.categoryId
        ? await tx.select({ name: ticketCategories.name }).from(ticketCategories).where(eq(ticketCategories.id, t.aiTriage.categoryId))
        : [];
      triage = { ...t.aiTriage, categoryName: cat?.name ?? null };
    }
    const now = Date.now();
    return {
      ...list,
      description: t.description,
      satisfaction: t.satisfaction,
      closedAt: t.closedAt?.toISOString() ?? null,
      categoryId: t.categoryId,
      requester: { userId: t.requesterUserId, name: list.requesterName, employeeId: t.requesterEmployeeId, employeeCode: emp[0]?.code ?? null },
      messages: msgs.map(({ m, authorName }) => ({
        id: m.id,
        body: m.body,
        isInternal: m.isInternal,
        aiAssisted: m.aiAssisted,
        authorName,
        fromRequester: m.authorUserId === t.requesterUserId,
        mine: m.authorUserId === ctx.userId,
        createdAt: m.createdAt.toISOString(),
      })),
      attachments: attachments.map((a) => ({ ...a, sizeBytes: Number(a.sizeBytes) })),
      triage,
      isRequester,
      canWork: working,
      canReopen: isRequester && t.status === "resolved" && !!t.resolvedAt && now - t.resolvedAt.getTime() <= REOPEN_WINDOW_DAYS * 86_400_000,
      canRate: isRequester && (t.status === "resolved" || t.status === "closed"),
      canManage: canManageHelpdesk(ctx),
    };
  });
}

/** People the ticket can be assigned to (for the agent's assignee picker). */
export async function assignableUsers(ctx: RequestContext, ticketId: string) {
  return ctx.db(async (tx) => {
    const { t, c } = await loadTicket(tx, ticketId);
    if (!canWork(ctx, t, c)) throw forbidden();
    const ids = [...(await eligibleAssignees(tx, ctx.tenantId, c))].filter((u) => u !== t.requesterUserId);
    if (!ids.length) return [];
    return tx
      .select({ userId: users.id, name: sql<string>`coalesce(${users.fullName}, ${users.email})` })
      .from(users)
      .where(inArray(users.id, ids))
      .orderBy(asc(users.fullName));
  });
}

/* ------------------------------------------------------------------ */
/* Conversation                                                        */
/* ------------------------------------------------------------------ */

export async function replyToTicket(ctx: RequestContext, input: ReplyInput) {
  return ctx.db(async (tx) => {
    const { t, c } = await loadTicket(tx, input.ticketId, true);
    const working = canWork(ctx, t, c);
    const isRequester = t.requesterUserId === ctx.userId;
    if (!working && !isRequester) throw forbidden();
    if (input.internal && !working) throw forbidden("Only HR can add internal notes.");
    if (input.status && !working) throw forbidden();
    if (t.status === "closed") throw invalidState("This ticket is closed. Raise a new ticket if you still need help.");

    const now = new Date();
    const [msg] = await tx
      .insert(ticketMessages)
      .values({
        tenantId: ctx.tenantId,
        ticketId: t.id,
        authorUserId: ctx.userId,
        body: input.body,
        isInternal: input.internal,
        aiAssisted: working && input.aiAssisted,
      })
      .returning({ id: ticketMessages.id });

    let patch: Partial<TicketRow> = {};
    if (working && !input.internal) {
      if (!t.firstRespondedAt) patch.firstRespondedAt = now;
      if (t.status === "open" && !input.status) patch.status = "in_progress";
    }
    if (!working && isRequester && (t.status === "waiting_on_employee" || t.status === "resolved")) {
      // A requester reply puts the ticket back in HR's court (and reopens a resolved one).
      patch = { ...patch, ...statusPatch(t, "in_progress", now) };
    }
    if (input.status) patch = { ...patch, ...statusPatch(t, input.status, now) };
    patch.updatedAt = now;
    const [after] = await tx.update(tickets).set(patch).where(eq(tickets.id, t.id)).returning();

    await audit(tx, ctx, {
      action: input.internal ? "ticket.note_added" : "ticket.replied",
      entityType: "ticket",
      entityId: t.id,
      changes: diff({ status: t.status }, { status: after.status }),
      metadata: { messageId: msg.id, internal: input.internal, aiAssisted: working && input.aiAssisted, by: working ? "agent" : "requester" },
    });

    const label = c?.isSensitive ? `${t.number} (confidential)` : t.number;
    if (working && !input.internal) {
      await notify(tx, {
        tenantId: ctx.tenantId,
        userIds: [t.requesterUserId].filter((u) => u !== ctx.userId),
        category: "helpdesk",
        title: `HR replied on ${label}`,
        body: after.status === "waiting_on_employee" ? "HR is waiting for your response." : null,
        href: `/helpdesk/${t.id}`,
        dedupeKey: `ticket-msg:${msg.id}`,
      });
    } else if (!working) {
      const to = t.assigneeUserId ? [t.assigneeUserId] : await userIdsWithPermission(tx, ctx.tenantId, "helpdesk.manage");
      await notify(tx, {
        tenantId: ctx.tenantId,
        userIds: to.filter((u) => u !== ctx.userId),
        category: "helpdesk",
        title: `New reply on ${label}`,
        href: `/helpdesk/${t.id}`,
        dedupeKey: `ticket-msg:${msg.id}`,
      });
    }
    if (after.status === "resolved" && t.status !== "resolved") await notifyResolved(tx, ctx, after);
    return { id: msg.id, status: after.status };
  });
}

/** Agent changes: status, priority, category (SLA recomputed) and assignee. */
export async function updateTicket(ctx: RequestContext, input: UpdateTicketInput) {
  return ctx.db((tx) => applyTicketUpdate(tx, ctx, input));
}

async function applyTicketUpdate(tx: Tx, ctx: RequestContext, input: UpdateTicketInput) {
  const { t, c } = await loadTicket(tx, input.id, true);
  if (!canWork(ctx, t, c)) throw forbidden();
  const now = new Date();
  let patch: Partial<TicketRow> = {};
  let category = c;

  if (input.categoryId && input.categoryId !== t.categoryId) {
    const [next] = await tx.select().from(ticketCategories).where(eq(ticketCategories.id, input.categoryId));
    if (!next || !next.isActive) throw validation("Choose an active category.", { categoryId: ["Choose an active category"] });
    if (next.isSensitive && !canManageHelpdesk(ctx)) {
      throw forbidden("Only helpdesk managers can move a ticket into a confidential category. Add an internal note asking them to.");
    }
    category = next;
    patch.categoryId = next.id;
    const due = slaDue(t.createdAt, next);
    if (!t.firstRespondedAt) patch.firstResponseDueAt = due.firstResponseDueAt;
    if (!t.resolvedAt) patch.resolutionDueAt = due.resolutionDueAt;
  }
  if (input.priority && input.priority !== t.priority) patch.priority = input.priority;
  if (input.status) patch = { ...patch, ...statusPatch(t, input.status, now) };

  let newAssignee: string | null | undefined;
  if (input.assigneeUserId !== undefined && input.assigneeUserId !== t.assigneeUserId) {
    if (input.assigneeUserId) {
      if (input.assigneeUserId === t.requesterUserId) throw validation("A ticket cannot be assigned to the person who raised it.");
      const allowed = await eligibleAssignees(tx, ctx.tenantId, category);
      if (!allowed.has(input.assigneeUserId)) throw validation("That person cannot work tickets in this category.", { assigneeUserId: ["Not eligible"] });
    }
    newAssignee = input.assigneeUserId;
  } else if (category?.isSensitive && t.assigneeUserId && !(await eligibleAssignees(tx, ctx.tenantId, category)).has(t.assigneeUserId)) {
    newAssignee = null; // a confidential ticket must not stay with someone outside the confidential queue
  }
  if ((newAssignee === null || (newAssignee === undefined && !t.assigneeUserId)) && category && patch.categoryId) {
    newAssignee = await pickAssignee(ctx.tenantId, category, { excludeUserId: t.requesterUserId });
  }
  if (newAssignee !== undefined) patch.assigneeUserId = newAssignee;
  if (!Object.keys(patch).length) return { id: t.id, changed: false };
  patch.updatedAt = now;

  const [after] = await tx.update(tickets).set(patch).where(eq(tickets.id, t.id)).returning();
  await audit(tx, ctx, {
    action: "ticket.updated",
    entityType: "ticket",
    entityId: t.id,
    changes: diff(
      { status: t.status, priority: t.priority, categoryId: t.categoryId, assigneeUserId: t.assigneeUserId },
      { status: after.status, priority: after.priority, categoryId: after.categoryId, assigneeUserId: after.assigneeUserId },
    ),
  });
  if (after.assigneeUserId && after.assigneeUserId !== t.assigneeUserId && after.assigneeUserId !== ctx.userId) {
    await notify(tx, {
      tenantId: ctx.tenantId,
      userIds: [after.assigneeUserId],
      category: "helpdesk",
      title: `Ticket assigned to you · ${category?.isSensitive ? `${t.number} (confidential)` : `${t.number}: ${t.subject.slice(0, 80)}`}`,
      href: `/helpdesk/${t.id}`,
      dedupeKey: `ticket:${t.id}:assigned:${after.assigneeUserId}:${now.getTime()}`,
    });
  }
  if (after.status === "resolved" && t.status !== "resolved") await notifyResolved(tx, ctx, after);
  return { id: t.id, changed: true };
}

/** Apply the stored triage suggestion (category + priority). */
export async function acceptTriage(ctx: RequestContext, ticketId: string) {
  return ctx.db(async (tx) => {
    const { t } = await loadTicket(tx, ticketId);
    if (!t.aiTriage) throw invalidState("There is no suggestion to accept.");
    const priority = t.aiTriage.priority as TicketPriority | undefined;
    return applyTicketUpdate(tx, ctx, {
      id: t.id,
      categoryId: t.aiTriage.categoryId,
      priority: priority && ["low", "normal", "high", "urgent"].includes(priority) ? priority : undefined,
    });
  });
}

export async function reopenTicket(ctx: RequestContext, ticketId: string) {
  return ctx.db(async (tx) => {
    const { t, c } = await loadTicket(tx, ticketId, true);
    if (t.requesterUserId !== ctx.userId) throw forbidden();
    if (t.status !== "resolved" || !t.resolvedAt) throw invalidState("Only resolved tickets can be reopened.");
    if (Date.now() - t.resolvedAt.getTime() > REOPEN_WINDOW_DAYS * 86_400_000) {
      throw invalidState(`Tickets can be reopened within ${REOPEN_WINDOW_DAYS} days of being resolved. Please raise a new ticket.`);
    }
    await tx.update(tickets).set({ status: "open", resolvedAt: null, satisfaction: null, updatedAt: new Date() }).where(eq(tickets.id, t.id));
    await audit(tx, ctx, { action: "ticket.reopened", entityType: "ticket", entityId: t.id, changes: diff({ status: t.status }, { status: "open" }) });
    const to = t.assigneeUserId ? [t.assigneeUserId] : await userIdsWithPermission(tx, ctx.tenantId, "helpdesk.manage");
    await notify(tx, {
      tenantId: ctx.tenantId,
      userIds: to.filter((u) => u !== ctx.userId),
      category: "helpdesk",
      title: `${c?.isSensitive ? `${t.number} (confidential)` : t.number} was reopened`,
      href: `/helpdesk/${t.id}`,
      dedupeKey: `ticket:${t.id}:reopened:${Date.now()}`,
    });
    return { id: t.id };
  });
}

export async function rateTicket(ctx: RequestContext, input: { id: string; rating: number }) {
  return ctx.db(async (tx) => {
    const { t } = await loadTicket(tx, input.id, true);
    if (t.requesterUserId !== ctx.userId) throw forbidden();
    if (t.status !== "resolved" && t.status !== "closed") throw invalidState("You can rate a ticket once it is resolved.");
    await tx.update(tickets).set({ satisfaction: input.rating }).where(eq(tickets.id, t.id));
    await audit(tx, ctx, { action: "ticket.rated", entityType: "ticket", entityId: t.id, changes: diff({ satisfaction: t.satisfaction }, { satisfaction: input.rating }) });
    return { id: t.id };
  });
}

/** Attachment download for anyone who can see the ticket (RLS decides). */
export async function ticketAttachmentUrl(ctx: RequestContext, documentId: string, meta: { ip?: string | null } = {}) {
  return ctx.db(async (tx) => {
    const [doc] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.ownerType, "ticket"), isNull(documents.deletedAt)));
    if (!doc?.ownerId) throw notFound("Attachment");
    const [visible] = await tx.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, doc.ownerId));
    if (!visible) throw notFound("Attachment");
    return attachmentDownloadUrl(tx, ctx, doc, meta);
  });
}

/* ------------------------------------------------------------------ */
/* Scheduled: auto-close (system context, explicit tenant filter)      */
/* ------------------------------------------------------------------ */

export async function autoCloseResolved(tx: Tx, tenantId: string) {
  const cutoff = new Date(Date.now() - AUTO_CLOSE_DAYS * 86_400_000);
  const closed = await tx
    .update(tickets)
    .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tickets.tenantId, tenantId), eq(tickets.status, "resolved"), lt(tickets.resolvedAt, cutoff)))
    .returning({ id: tickets.id, number: tickets.number });
  for (const t of closed) {
    await audit(tx, { tenantId, userId: null, actorType: "system" }, {
      action: "ticket.auto_closed",
      entityType: "ticket",
      entityId: t.id,
      changes: diff({ status: "resolved" }, { status: "closed" }),
    });
  }
  return closed.length;
}
