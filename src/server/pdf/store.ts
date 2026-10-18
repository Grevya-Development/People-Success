import { randomUUID } from "node:crypto";
import type { Tx } from "../db/client";
import { documents } from "../db/schema";
import { supabaseAdmin } from "../auth/supabase";
import { sha256 } from "../lib/crypto";

export type GeneratedDocInput = {
  tenantId: string;
  bytes: Uint8Array;
  ownerType: string;
  ownerId: string | null;
  employeeId?: string | null;
  category: (typeof documents.$inferInsert)["category"];
  title: string;
  fileName: string;
  employeeVisible?: boolean;
  isSensitive?: boolean;
  createdBy: string | null;
  supersedesId?: string | null;
};

/**
 * Store a generated PDF in the private "generated" bucket and register it as
 * a document (so access control, download logging and retention apply). If
 * the database insert fails, the uploaded object is removed.
 */
export async function storeGeneratedPdf(tx: Tx, input: GeneratedDocInput) {
  const path = `${input.tenantId}/${input.ownerType}/${input.ownerId ?? "company"}/${randomUUID()}.pdf`;
  const storage = supabaseAdmin().storage.from("generated");
  const { error } = await storage.upload(path, input.bytes, { contentType: "application/pdf", upsert: false });
  if (error) throw new Error(`Could not store generated document: ${error.message}`);
  try {
    const [doc] = await tx
      .insert(documents)
      .values({
        tenantId: input.tenantId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        employeeId: input.employeeId ?? null,
        category: input.category,
        title: input.title,
        bucket: "generated",
        storagePath: path,
        fileName: input.fileName,
        mimeType: "application/pdf",
        sizeBytes: input.bytes.byteLength,
        sha256: sha256(Buffer.from(input.bytes)),
        employeeVisible: input.employeeVisible ?? true,
        isSensitive: input.isSensitive ?? false,
        scanStatus: "skipped",
        uploadedBy: input.createdBy,
        supersedesId: input.supersedesId ?? null,
        metadata: { generated: true },
      })
      .returning();
    return doc;
  } catch (err) {
    await storage.remove([path]);
    throw err;
  }
}
