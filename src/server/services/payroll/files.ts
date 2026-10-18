import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { documents } from "../../db/schema";
import { supabaseAdmin } from "../../auth/supabase";
import { sha256 } from "../../lib/crypto";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { signedDownloadUrl } from "../documents/storage";

/**
 * Store a generated non-PDF file (bank transfer CSVs, registers) in the
 * private "generated" bucket and register it as a sensitive, HR-only
 * document. The uploaded object is removed if the database insert fails.
 */
export async function storeGeneratedFile(
  tx: Tx,
  input: { tenantId: string; bytes: Uint8Array; mimeType: string; extension: string; ownerType: string; ownerId: string; title: string; fileName: string; createdBy: string },
) {
  const path = `${input.tenantId}/${input.ownerType}/${input.ownerId}/${randomUUID()}.${input.extension}`;
  const storage = supabaseAdmin().storage.from("generated");
  const { error } = await storage.upload(path, input.bytes, { contentType: input.mimeType, upsert: false });
  if (error) {
    logger.error("payroll.file_store_failed", { err: error.message });
    throw new AppError("INTEGRATION", "The file could not be stored. Please try again.");
  }
  try {
    const [doc] = await tx
      .insert(documents)
      .values({
        tenantId: input.tenantId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        employeeId: null,
        category: "other",
        title: input.title,
        bucket: "generated",
        storagePath: path,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.bytes.byteLength,
        sha256: sha256(Buffer.from(input.bytes)),
        employeeVisible: false,
        isSensitive: true,
        scanStatus: "skipped",
        uploadedBy: input.createdBy,
        metadata: { generated: true, module: "payroll" },
      })
      .returning();
    return doc;
  } catch (err) {
    await storage.remove([path]);
    throw err;
  }
}

/** Short-lived signed URL for a payroll-owned generated document (caller must authorize). */
export async function payrollFileUrl(tx: Tx, documentId: string) {
  const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId));
  if (!doc || doc.ownerType !== "payroll_run") throw new AppError("NOT_FOUND", "File not found.");
  return { url: await signedDownloadUrl(doc.bucket, doc.storagePath, doc.fileName, 60), doc };
}
