import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { Tx } from "../../db/client";
import { authorize, type RequestContext } from "../../auth/context";
import { employeeSensitive, employees } from "../../db/schema";
import { audit } from "../../lib/audit";
import { encryptField, last4 } from "../../lib/crypto";
import { notFound } from "../../lib/errors";
import type { sensitiveSchema } from "@/lib/validation/employees";

export type SensitivePatch = Partial<{
  pan: string | null;
  aadhaar: string | null;
  passport: string | null;
  uan: string | null;
  esicNumber: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  bankName: string | null;
  accountHolderName: string | null;
  taxRegime: "old" | "new";
}>;

const ENCRYPTED = {
  pan: ["panEnc", "panLast4"],
  aadhaar: ["aadhaarEnc", "aadhaarLast4"],
  passport: ["passportEnc", "passportLast4"],
  bankAccount: ["bankAccountEnc", "bankAccountLast4"],
} as const;

/**
 * Apply statutory/bank changes. Encrypted fields are only touched when a new
 * value is provided (undefined/null/"" means unchanged). Returns the list of
 * changed field names; values are never audited.
 */
export async function applySensitivePatch(tx: Tx, tenantId: string, employeeId: string, patch: SensitivePatch, actorUserId: string) {
  const set: Record<string, unknown> = { updatedBy: actorUserId };
  const changed: string[] = [];
  for (const [field, [encCol, lastCol]] of Object.entries(ENCRYPTED) as [keyof typeof ENCRYPTED, readonly [string, string]][]) {
    const v = patch[field];
    if (v) {
      set[encCol] = encryptField(v);
      set[lastCol] = last4(v);
      changed.push(field);
    }
  }
  for (const field of ["uan", "esicNumber", "bankIfsc", "bankName", "accountHolderName", "taxRegime"] as const) {
    if (patch[field] !== undefined) {
      set[field] = patch[field];
      changed.push(field);
    }
  }
  await tx
    .insert(employeeSensitive)
    .values({ employeeId, tenantId, taxRegime: patch.taxRegime ?? "new", ...set })
    .onConflictDoUpdate({ target: employeeSensitive.employeeId, set });
  return changed;
}

export async function updateSensitive(ctx: RequestContext, input: z.output<typeof sensitiveSchema>) {
  authorize(ctx, "employees.sensitive.edit", "all");
  return ctx.db(async (tx) => {
    const [e] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, input.employeeId));
    if (!e) throw notFound("Employee");
    const { employeeId, ...patch } = input;
    const changed = await applySensitivePatch(tx, ctx.tenantId, employeeId, patch, ctx.userId);
    await audit(tx, ctx, {
      action: "employee.sensitive_updated",
      entityType: "employee",
      entityId: employeeId,
      metadata: { fields: changed },
    });
    return { changed };
  });
}
