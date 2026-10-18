import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import type { Tx } from "../../db/client";
import type { RequestContext } from "../../auth/context";
import { dataChangeRequests, employees } from "../../db/schema";
import { audit } from "../../lib/audit";
import { decryptField, encryptField, last4, mask } from "../../lib/crypto";
import { forbidden, invalidState, notFound } from "../../lib/errors";
import type { changeRequestSchema } from "@/lib/validation/employees";
import { startApproval } from "../approvals/engine";
import { applySensitivePatch } from "./sensitive";
import { displayNameOf } from "./mutations";

/** Fields whose requested values are encrypted at rest inside the request. */
const SECRET_FIELDS = new Set(["pan", "aadhaar", "bankAccount"]);
const SENSITIVE_FIELDS = new Set(["pan", "aadhaar", "bankAccount", "bankIfsc", "bankName", "accountHolderName", "uan"]);
const PERSONAL_FIELDS = new Set(["firstName", "middleName", "lastName", "dateOfBirth", "gender", "nationality"]);

/**
 * An employee asks HR to correct their master data. Requested secrets are
 * stored encrypted; the request runs through the "data_change_request"
 * approval policy and is applied on approval.
 */
export async function submitChangeRequest(ctx: RequestContext, input: z.output<typeof changeRequestSchema>) {
  if (input.employeeId !== ctx.employeeId) throw forbidden("You can only request changes to your own profile.");
  return ctx.db(async (tx) => {
    const [e] = await tx.select().from(employees).where(eq(employees.id, input.employeeId));
    if (!e) throw notFound("Employee");
    const [open] = await tx
      .select({ id: dataChangeRequests.id })
      .from(dataChangeRequests)
      .where(and(eq(dataChangeRequests.employeeId, input.employeeId), eq(dataChangeRequests.status, "pending")));
    if (open) throw invalidState("You already have a pending correction request. Wait for HR to review it.");

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [field, value] of Object.entries(input.changes)) {
      if (value === undefined || value === null || value === "") continue;
      if (SECRET_FIELDS.has(field)) {
        changes[field] = { from: null, to: { enc: encryptField(String(value)), display: mask(last4(String(value)), 6) } };
      } else if (PERSONAL_FIELDS.has(field)) {
        changes[field] = { from: (e as Record<string, unknown>)[field] ?? null, to: value };
      } else {
        changes[field] = { from: null, to: value };
      }
    }
    const [request] = await tx
      .insert(dataChangeRequests)
      .values({ tenantId: ctx.tenantId, employeeId: input.employeeId, requestedBy: ctx.userId, changes, reason: input.reason })
      .returning();
    await startApproval(tx, ctx, {
      subjectType: "data_change_request",
      subjectId: request.id,
      title: `Profile correction for ${e.displayName}`,
      requestedBy: ctx.userId,
      subjectEmployeeId: e.id,
    });
    await audit(tx, ctx, {
      action: "employee.change_requested",
      entityType: "employee",
      entityId: e.id,
      metadata: { requestId: request.id, fields: Object.keys(changes) },
    });
    return request;
  });
}

/** Called by the approval handler inside the approving transaction. */
export async function applyChangeRequest(tx: Tx, requestId: string, actor: { tenantId: string; userId: string }, comment: string | null) {
  const [req] = await tx.select().from(dataChangeRequests).where(eq(dataChangeRequests.id, requestId)).for("update");
  if (!req || req.status !== "pending") return;
  const personal: Record<string, unknown> = {};
  const sensitive: Record<string, string> = {};
  for (const [field, { to }] of Object.entries(req.changes)) {
    if (PERSONAL_FIELDS.has(field)) personal[field] = to;
    else if (SENSITIVE_FIELDS.has(field)) {
      sensitive[field] = SECRET_FIELDS.has(field) ? decryptField((to as { enc: string }).enc) : String(to);
    }
  }
  if (Object.keys(personal).length) {
    const [e] = await tx.select().from(employees).where(eq(employees.id, req.employeeId));
    const merged = { ...e, ...personal } as typeof e;
    await tx
      .update(employees)
      .set({ ...personal, displayName: displayNameOf(merged) })
      .where(eq(employees.id, req.employeeId));
  }
  if (Object.keys(sensitive).length) await applySensitivePatch(tx, actor.tenantId, req.employeeId, sensitive, actor.userId);
  // Drop the encrypted payload once applied; keep a redacted record of what changed.
  const redacted = Object.fromEntries(
    Object.entries(req.changes).map(([k, v]) => [k, SECRET_FIELDS.has(k) ? { from: null, to: (v.to as { display: string }).display } : v]),
  );
  await tx
    .update(dataChangeRequests)
    .set({ status: "approved", reviewedBy: actor.userId, reviewedAt: new Date(), reviewComment: comment, changes: redacted })
    .where(eq(dataChangeRequests.id, requestId));
  await audit(tx, actor, {
    action: "employee.change_applied",
    entityType: "employee",
    entityId: req.employeeId,
    metadata: { requestId, fields: Object.keys(req.changes) },
  });
}

export async function closeChangeRequest(
  tx: Tx,
  requestId: string,
  status: "rejected" | "cancelled",
  actor: { userId: string },
  comment: string | null,
) {
  const [req] = await tx.select().from(dataChangeRequests).where(eq(dataChangeRequests.id, requestId));
  if (!req || req.status !== "pending") return;
  const redacted = Object.fromEntries(
    Object.entries(req.changes).map(([k, v]) => [k, SECRET_FIELDS.has(k) ? { from: null, to: (v.to as { display: string }).display } : v]),
  );
  await tx
    .update(dataChangeRequests)
    .set({ status, reviewedBy: actor.userId, reviewedAt: new Date(), reviewComment: comment, changes: redacted })
    .where(eq(dataChangeRequests.id, requestId));
}
