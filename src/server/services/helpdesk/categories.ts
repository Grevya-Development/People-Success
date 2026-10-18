import "server-only";
import { asc, eq } from "drizzle-orm";
import type { RequestContext } from "../../auth/context";
import { ticketCategories } from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { forbidden, notFound } from "../../lib/errors";
import type { TicketCategoryInput } from "@/lib/validation/helpdesk";
import { canManageHelpdesk } from "./rules";

export type TicketCategory = typeof ticketCategories.$inferSelect;

export async function listTicketCategories(ctx: RequestContext, opts: { includeInactive?: boolean } = {}) {
  if (opts.includeInactive && !canManageHelpdesk(ctx)) throw forbidden();
  return ctx.db((tx) =>
    tx
      .select()
      .from(ticketCategories)
      .where(opts.includeInactive ? undefined : eq(ticketCategories.isActive, true))
      .orderBy(asc(ticketCategories.name)),
  );
}

export async function createTicketCategory(ctx: RequestContext, input: TicketCategoryInput) {
  if (!canManageHelpdesk(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const [row] = await tx.insert(ticketCategories).values({ tenantId: ctx.tenantId, ...input }).returning({ id: ticketCategories.id });
    await audit(tx, ctx, { action: "ticket_category.created", entityType: "ticket_category", entityId: row.id, changes: diff(null, { ...input }) });
    return row;
  });
}

export async function updateTicketCategory(ctx: RequestContext, input: TicketCategoryInput & { id: string }) {
  if (!canManageHelpdesk(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const [before] = await tx.select().from(ticketCategories).where(eq(ticketCategories.id, input.id)).for("update");
    if (!before) throw notFound("Category");
    const { id, ...fields } = input;
    const [after] = await tx.update(ticketCategories).set(fields).where(eq(ticketCategories.id, id)).returning();
    await audit(tx, ctx, { action: "ticket_category.updated", entityType: "ticket_category", entityId: id, changes: diff(before, after) });
    return { id };
  });
}

export const DEFAULT_TICKET_CATEGORIES: TicketCategoryInput[] = [
  { name: "Payroll & payslips", description: "Salary, payslips, TDS, PF and reimbursements.", ownerRoleKey: "payroll_admin", firstResponseHours: 8, resolutionHours: 48, isSensitive: false, isActive: true },
  { name: "Leave & attendance", description: "Leave balances, attendance corrections and holidays.", ownerRoleKey: "hr_manager", firstResponseHours: 8, resolutionHours: 48, isSensitive: false, isActive: true },
  { name: "Documents & letters", description: "Employment letters, certificates and address proofs.", ownerRoleKey: "hr_admin", firstResponseHours: 8, resolutionHours: 72, isSensitive: false, isActive: true },
  { name: "IT & assets", description: "Laptops, access and company assets.", ownerRoleKey: "hr_admin", firstResponseHours: 4, resolutionHours: 24, isSensitive: false, isActive: true },
  { name: "Policies", description: "Questions about company policies.", ownerRoleKey: "hr_admin", firstResponseHours: 8, resolutionHours: 48, isSensitive: false, isActive: true },
  { name: "Grievance", description: "Confidential concerns, harassment or misconduct. Visible only to the helpdesk managers.", ownerRoleKey: "hr_admin", firstResponseHours: 4, resolutionHours: 120, isSensitive: true, isActive: true },
  { name: "Other", description: "Anything else.", ownerRoleKey: "hr_admin", firstResponseHours: 8, resolutionHours: 72, isSensitive: false, isActive: true },
];

/** Idempotent: categories whose name already exists are left untouched. */
export async function seedDefaultTicketCategories(ctx: RequestContext) {
  if (!canManageHelpdesk(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const inserted = await tx
      .insert(ticketCategories)
      .values(DEFAULT_TICKET_CATEGORIES.map((c) => ({ tenantId: ctx.tenantId, ...c })))
      .onConflictDoNothing()
      .returning({ id: ticketCategories.id, name: ticketCategories.name });
    if (inserted.length) {
      await audit(tx, ctx, { action: "ticket_category.seeded", entityType: "ticket_category", metadata: { names: inserted.map((i) => i.name) } });
    }
    return { added: inserted.length, skipped: DEFAULT_TICKET_CATEGORIES.length - inserted.length };
  });
}
