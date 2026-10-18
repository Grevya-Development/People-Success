import "server-only";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { RequestContext } from "../../auth/context";
import type { Tx } from "../../db/client";
import { documentAccessLogs, documents } from "../../db/schema";
import { audit } from "../../lib/audit";
import { validation } from "../../lib/errors";
import { inspectUpload, type InspectedFile } from "../documents/files";
import { getMalwareScanner, type MalwareScanner } from "../documents/scanner";
import { putObject, removeObject, signedDownloadUrl } from "../documents/storage";
import type { DocumentCategory } from "@/lib/validation/documents";

/**
 * Files attached to module records (expense receipts, ticket attachments).
 *
 * The documents service only lets HR attach files to non-employee owners and
 * forces their ownerId to null, so modules whose records are owned by
 * employees store their attachments here with the same safeguards: type and
 * magic-byte checks, malware scan, private bucket, documents row, access log.
 * Authorization is the calling module's job (claim owner, ticket requester...).
 */

const BUCKET = "documents";

export type PreparedAttachment = InspectedFile & { storagePath: string; scanStatus: "clean" | "skipped" | "error" };

/** Validate, scan and store the bytes. Call `discardAttachment` if the DB write fails. */
export async function prepareAttachment(
  ctx: Pick<RequestContext, "tenantId">,
  file: File,
  target: { ownerType: "expense_claim" | "ticket"; ownerId: string },
  opts: { scanner?: MalwareScanner } = {},
): Promise<PreparedAttachment> {
  const inspected = await inspectUpload(file);
  const scan = await (opts.scanner ?? getMalwareScanner()).scan(inspected.bytes, inspected.mimeType).catch(() => "error" as const);
  if (scan === "infected") throw validation("This file failed the malware scan and was not stored.", { file: ["Malware detected"] });
  const storagePath = `${ctx.tenantId}/${target.ownerType}/${target.ownerId}/${randomUUID()}.${inspected.ext}`;
  await putObject(BUCKET, storagePath, inspected.bytes, inspected.mimeType);
  return { ...inspected, storagePath, scanStatus: scan };
}

export async function discardAttachment(prepared: PreparedAttachment | null | undefined) {
  if (prepared) await removeObject(BUCKET, prepared.storagePath);
}

export async function insertAttachmentRow(
  tx: Tx,
  ctx: Pick<RequestContext, "tenantId" | "userId">,
  prepared: PreparedAttachment,
  row: {
    ownerType: "expense_claim" | "ticket";
    ownerId: string;
    employeeId: string | null;
    title: string;
    category: DocumentCategory;
    isSensitive?: boolean;
  },
) {
  const [doc] = await tx
    .insert(documents)
    .values({
      tenantId: ctx.tenantId,
      ownerType: row.ownerType,
      ownerId: row.ownerId,
      employeeId: row.employeeId,
      category: row.category,
      title: row.title.slice(0, 160),
      bucket: BUCKET,
      storagePath: prepared.storagePath,
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
      sizeBytes: prepared.sizeBytes,
      sha256: prepared.sha256,
      // Module attachments never show up in the employee's document vault.
      employeeVisible: false,
      isSensitive: row.isSensitive ?? false,
      scanStatus: prepared.scanStatus,
      uploadedBy: ctx.userId,
      metadata: { module: row.ownerType },
    })
    .returning({ id: documents.id });
  await audit(tx, ctx, {
    action: "document.uploaded",
    entityType: "document",
    entityId: doc.id,
    metadata: { ownerType: row.ownerType, ownerId: row.ownerId, category: row.category, sizeBytes: prepared.sizeBytes, mimeType: prepared.mimeType },
  });
  return doc.id;
}

/** Mint a short-lived URL and log the access. Callers authorize first. */
export async function attachmentDownloadUrl(
  tx: Tx,
  ctx: Pick<RequestContext, "tenantId" | "userId">,
  doc: { id: string; bucket: string; storagePath: string; fileName: string },
  meta: { ip?: string | null } = {},
) {
  const url = await signedDownloadUrl(doc.bucket, doc.storagePath, doc.fileName, 60);
  await tx.insert(documentAccessLogs).values({
    tenantId: ctx.tenantId,
    documentId: doc.id,
    userId: ctx.userId,
    action: "download",
    ip: meta.ip && isIP(meta.ip) ? meta.ip : null,
  });
  return url;
}
