import "server-only";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { RequestContext } from "../../auth/context";
import type { Tx } from "../../db/client";
import { applications, documentAccessLogs, documents, interviewPanelists, interviews, offers } from "../../db/schema";
import { audit } from "../../lib/audit";
import { forbidden, notFound, validation } from "../../lib/errors";
import { inspectUpload, type InspectedFile } from "../documents/files";
import { getMalwareScanner } from "../documents/scanner";
import { putObject, removeObject, signedDownloadUrl } from "../documents/storage";
import { RESUME_EXTENSIONS, RESUME_MAX_BYTES } from "@/lib/validation/recruitment";
import { canSeeOffers, canViewRecruitment } from "./shared";

const BUCKET = "documents";

export type StagedResume = { file: InspectedFile; storagePath: string; scanStatus: "clean" | "skipped" | "error" };

/**
 * Validate (PDF/DOCX, ≤ 5 MB, magic bytes), malware-scan and upload a resume
 * to private storage. Call BEFORE the database transaction; if the
 * transaction fails, call `discardResume` so no orphaned object remains.
 */
export async function stageResume(tenantId: string, file: File): Promise<StagedResume> {
  if (!file || typeof file.arrayBuffer !== "function" || file.size <= 0) throw validation("Attach your resume.", { resume: ["Attach a PDF or Word (.docx) file"] });
  if (file.size > RESUME_MAX_BYTES) throw validation("Resumes can be at most 5 MB.", { resume: ["Files can be at most 5 MB"] });
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!(RESUME_EXTENSIONS as readonly string[]).includes(ext)) throw validation("Upload your resume as a PDF or Word (.docx) file.", { resume: ["PDF or DOCX only"] });
  let inspected: InspectedFile;
  try {
    inspected = await inspectUpload(file);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "The file could not be read.";
    throw validation(msg, { resume: [msg] });
  }
  const scan = await getMalwareScanner()
    .scan(inspected.bytes, inspected.mimeType)
    .catch(() => "error" as const);
  if (scan === "infected") throw validation("This file failed the malware scan and was not stored.", { resume: ["Malware detected"] });
  const storagePath = `${tenantId}/candidate/${randomUUID()}.${inspected.ext}`;
  await putObject(BUCKET, storagePath, inspected.bytes, inspected.mimeType);
  return { file: inspected, storagePath, scanStatus: scan };
}

export async function discardResume(staged: StagedResume | null | undefined) {
  if (staged) await removeObject(BUCKET, staged.storagePath);
}

/** Register a staged resume as the candidate's current resume document. */
export async function insertResumeDocument(
  tx: Tx,
  input: { tenantId: string; candidateId: string; staged: StagedResume; uploadedBy: string | null; title: string; retainUntil: string | null },
) {
  // Earlier resumes stay as history; the new one becomes current.
  const previous = await tx
    .select({ id: documents.id, version: documents.version })
    .from(documents)
    .where(and(eq(documents.tenantId, input.tenantId), eq(documents.ownerType, "candidate"), eq(documents.ownerId, input.candidateId), eq(documents.isCurrent, true), isNull(documents.deletedAt)));
  if (previous.length) await tx.update(documents).set({ isCurrent: false }).where(inArray(documents.id, previous.map((p) => p.id)));
  const [doc] = await tx
    .insert(documents)
    .values({
      tenantId: input.tenantId,
      ownerType: "candidate",
      ownerId: input.candidateId,
      employeeId: null,
      category: "resume",
      title: input.title,
      bucket: BUCKET,
      storagePath: input.staged.storagePath,
      fileName: input.staged.file.fileName,
      mimeType: input.staged.file.mimeType,
      sizeBytes: input.staged.file.sizeBytes,
      sha256: input.staged.file.sha256,
      version: (previous[0]?.version ?? 0) + 1,
      supersedesId: previous[0]?.id ?? null,
      employeeVisible: false,
      isSensitive: true,
      retainUntil: input.retainUntil,
      scanStatus: input.staged.scanStatus,
      uploadedBy: input.uploadedBy,
      metadata: { purpose: "recruitment" },
    })
    .returning({ id: documents.id });
  return doc;
}

const cleanIp = (ip: string | null | undefined) => (ip && isIP(ip) ? ip : null);

/** Is the user on the panel of any interview for this candidate? */
async function isPanelistForCandidate(tx: Tx, userId: string, candidateId: string) {
  const [row] = await tx
    .select({ id: interviews.id })
    .from(interviewPanelists)
    .innerJoin(interviews, eq(interviews.id, interviewPanelists.interviewId))
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .where(and(eq(interviewPanelists.userId, userId), eq(applications.candidateId, candidateId)))
    .limit(1);
  return !!row;
}

/**
 * Download link for recruitment documents (resumes, offer letters).
 * Resumes: recruitment viewers, or interviewers on the candidate's panel.
 * Offer letters: offer managers/approvers (RLS on offers also applies).
 * Every download is logged; resumes are sensitive, so they are also audited.
 */
export async function recruitmentDocumentLink(
  ctx: RequestContext,
  documentId: string,
  meta: { ip?: string | null; userAgent?: string | null; requestId?: string | null } = {},
) {
  const doc = await ctx.db(async (tx) => {
    const [d] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt), inArray(documents.ownerType, ["candidate", "offer"])));
    if (!d) return null;
    let allowed = false;
    if (d.ownerType === "candidate" && d.ownerId) {
      allowed = canViewRecruitment(ctx) || (await isPanelistForCandidate(tx, ctx.userId, d.ownerId));
    } else if (d.ownerType === "offer" && d.ownerId && canSeeOffers(ctx)) {
      const [o] = await tx.select({ id: offers.id }).from(offers).where(eq(offers.id, d.ownerId));
      allowed = !!o;
    }
    return { d, allowed };
  });
  if (!doc) throw notFound("Document");
  if (!doc.allowed) throw forbidden();
  const url = await signedDownloadUrl(doc.d.bucket, doc.d.storagePath, doc.d.fileName, 60);
  await ctx.db(async (tx) => {
    await tx.insert(documentAccessLogs).values({ tenantId: ctx.tenantId, documentId: doc.d.id, userId: ctx.userId, action: "download", ip: meta.ip?.slice(0, 64) ?? null });
    await audit(tx, ctx, {
      action: "document.downloaded",
      entityType: "document",
      entityId: doc.d.id,
      metadata: { ownerType: doc.d.ownerType, ownerId: doc.d.ownerId, category: doc.d.category },
      ip: cleanIp(meta.ip),
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    });
  });
  return { url, fileName: doc.d.fileName };
}
