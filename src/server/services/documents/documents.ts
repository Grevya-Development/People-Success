import "server-only";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { aliasedTable, and, asc, desc, eq, isNull, lte, sql, type SQL } from "drizzle-orm";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { can, canAccessEmployee, scopeOf, type RequestContext } from "../../auth/context";
import type { Tx } from "../../db/client";
import { documentAccessLogs, documents, employees, users } from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { forbidden, invalidState, notFound, validation } from "../../lib/errors";
import { userIdsWithPermission } from "../directory";
import { notify } from "../notifications";
import { todayIn } from "@/lib/format";
import {
  SELF_UPLOAD_CATEGORIES,
  type DocumentCategory,
  type DocumentOwnerType,
} from "@/lib/validation/documents";
import { inspectUpload } from "./files";
import { getMalwareScanner, type MalwareScanner } from "./scanner";
import { putObject, removeObject, signedDownloadUrl } from "./storage";

const BUCKET = "documents";

type DocumentRow = typeof documents.$inferSelect;

/* ------------------------------------------------------------------ */
/* Access rules                                                        */
/* ------------------------------------------------------------------ */

/**
 * How much of an employee's document set the caller may see:
 *   full - HR (documents.manage) and tenant-wide viewers (documents.view:all)
 *   self - the employee: only documents marked employee-visible
 *   team - a manager over the employee: employee-visible, non-sensitive only
 */
export type EmployeeDocumentAccess = "full" | "self" | "team";

export const canManageDocuments = (ctx: RequestContext) => can(ctx, "documents.manage", "all");
const canManageCompanyDocs = (ctx: RequestContext) =>
  can(ctx, "documents.manage", "all") || can(ctx, "policies.manage", "all");

export async function employeeDocumentAccess(ctx: RequestContext, employeeId: string): Promise<EmployeeDocumentAccess | null> {
  if (canManageDocuments(ctx)) return "full";
  if (!(await canAccessEmployee(ctx, "documents.view", employeeId))) return null;
  if (scopeOf(ctx, "documents.view") === "all") return "full";
  return employeeId === ctx.employeeId ? "self" : "team";
}

function visibilityFilter(access: EmployeeDocumentAccess): SQL | undefined {
  if (access === "full") return undefined;
  if (access === "self") return eq(documents.employeeVisible, true);
  return and(eq(documents.employeeVisible, true), eq(documents.isSensitive, false));
}

/** Record-level check for a single document (download, detail). */
async function canViewDocument(ctx: RequestContext, doc: DocumentRow): Promise<boolean> {
  if (doc.ownerType === "employee" && doc.employeeId) {
    const access = await employeeDocumentAccess(ctx, doc.employeeId);
    if (!access) return false;
    if (access === "full") return true;
    if (!doc.employeeVisible) return false;
    return access === "self" || !doc.isSensitive;
  }
  if (doc.ownerType === "company") return canManageCompanyDocs(ctx) || doc.employeeVisible;
  // Other owner types (candidates, payroll runs, claims...) are HR-only here;
  // their modules expose their own access paths.
  return canManageDocuments(ctx);
}

/* ------------------------------------------------------------------ */
/* Listing                                                             */
/* ------------------------------------------------------------------ */

export type DocumentSummary = {
  id: string;
  ownerType: string;
  ownerId: string | null;
  employeeId: string | null;
  category: DocumentCategory;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  version: number;
  supersedesId: string | null;
  employeeVisible: boolean;
  isSensitive: boolean;
  expiresOn: string | null;
  retainUntil: string | null;
  legalHold: boolean;
  scanStatus: string;
  verifiedAt: string | null;
  verifiedByName: string | null;
  uploadedAt: string;
  uploadedByName: string | null;
  uploadedBySelf: boolean;
};

export type ListDocumentsFilter = { employeeId: string } | { ownerType: string; ownerId?: string | null };

const uploader = aliasedTable(users, "uploader");
const verifier = aliasedTable(users, "verifier");

async function selectDocuments(tx: Tx, ctx: RequestContext, where: SQL | undefined): Promise<DocumentSummary[]> {
  const rows = await tx
    .select({
      doc: documents,
      uploaderName: sql<string | null>`coalesce(${uploader.fullName}, ${uploader.email})`,
      verifierName: sql<string | null>`coalesce(${verifier.fullName}, ${verifier.email})`,
    })
    .from(documents)
    .leftJoin(uploader, eq(uploader.id, documents.uploadedBy))
    .leftJoin(verifier, eq(verifier.id, documents.verifiedBy))
    .where(and(isNull(documents.deletedAt), eq(documents.isCurrent, true), where))
    .orderBy(desc(documents.createdAt))
    .limit(500);
  return rows.map(({ doc, uploaderName, verifierName }) => ({
    id: doc.id,
    ownerType: doc.ownerType,
    ownerId: doc.ownerId,
    employeeId: doc.employeeId,
    category: doc.category,
    title: doc.title,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    version: doc.version,
    supersedesId: doc.supersedesId,
    employeeVisible: doc.employeeVisible,
    isSensitive: doc.isSensitive,
    expiresOn: doc.expiresOn,
    retainUntil: doc.retainUntil,
    legalHold: doc.legalHold,
    scanStatus: doc.scanStatus,
    verifiedAt: doc.verifiedAt?.toISOString() ?? null,
    verifiedByName: verifierName,
    uploadedAt: doc.createdAt.toISOString(),
    uploadedByName: uploaderName,
    uploadedBySelf: doc.uploadedBy === ctx.userId,
  }));
}

/** Current, non-deleted documents the caller may see. Metadata only. */
export async function listDocuments(ctx: RequestContext, filter: ListDocumentsFilter): Promise<DocumentSummary[]> {
  const employeeId =
    "employeeId" in filter ? filter.employeeId : filter.ownerType === "employee" ? (filter.ownerId ?? null) : undefined;

  if (employeeId !== undefined) {
    if (!employeeId) throw validation("Choose an employee.");
    const access = await employeeDocumentAccess(ctx, employeeId);
    if (!access) throw forbidden();
    return ctx.db((tx) =>
      selectDocuments(tx, ctx, and(eq(documents.ownerType, "employee"), eq(documents.employeeId, employeeId), visibilityFilter(access))),
    );
  }

  const { ownerType, ownerId } = filter as { ownerType: string; ownerId?: string | null };
  if (ownerType === "company") {
    const full = canManageCompanyDocs(ctx);
    return ctx.db((tx) =>
      selectDocuments(tx, ctx, and(eq(documents.ownerType, "company"), full ? undefined : eq(documents.employeeVisible, true))),
    );
  }
  if (!canManageDocuments(ctx)) throw forbidden();
  return ctx.db((tx) =>
    selectDocuments(
      tx,
      ctx,
      and(eq(documents.ownerType, ownerType), ownerId ? eq(documents.ownerId, ownerId) : isNull(documents.ownerId)),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

export type UploadDocumentParams = {
  ownerType: DocumentOwnerType;
  ownerId?: string | null;
  employeeId?: string | null;
  category: DocumentCategory;
  title: string;
  file: File;
  expiresOn?: string | null;
  employeeVisible?: boolean;
  isSensitive?: boolean;
  supersedesId?: string | null;
};

export type RequestMeta = { ip?: string | null; userAgent?: string | null; requestId?: string | null };

const cleanIp = (ip: string | null | undefined) => (ip && isIP(ip) ? ip : null);

export async function uploadDocument(
  ctx: RequestContext,
  params: UploadDocumentParams,
  opts: { scanner?: MalwareScanner; meta?: RequestMeta } = {},
): Promise<{ id: string; version: number; scanStatus: string }> {
  const ownerType = params.ownerType;
  const employeeId = ownerType === "employee" ? (params.employeeId ?? params.ownerId ?? null) : null;
  const ownerId = ownerType === "employee" ? employeeId : null;
  if (ownerType === "employee" && !employeeId) throw validation("Choose an employee.", { employeeId: ["Choose an employee"] });
  if (params.employeeId && params.ownerId && params.employeeId !== params.ownerId) throw validation("Owner and employee do not match.");

  // 1. Authorization, before touching the bytes.
  const managing = canManageDocuments(ctx);
  let selfUpload = false;
  if (ownerType === "employee") {
    if (!managing) {
      if (!ctx.employeeId || ctx.employeeId !== employeeId) throw forbidden();
      if (!(SELF_UPLOAD_CATEGORIES as readonly string[]).includes(params.category)) {
        throw forbidden("You can upload identity, education, certificate, statutory, receipt or other documents to your profile.");
      }
      selfUpload = true;
    }
  } else if (!canManageCompanyDocs(ctx)) {
    throw forbidden();
  }

  const employeeVisible = selfUpload ? true : (params.employeeVisible ?? true);
  const isSensitive = (params.isSensitive ?? false) || params.category === "identity";

  // 2. Validate references (RLS: a missing row means invalid in this tenant).
  await ctx.db(async (tx) => {
    if (employeeId) {
      const [emp] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)));
      if (!emp) throw notFound("Employee");
    }
    if (params.supersedesId) await loadSupersedable(tx, ctx, params.supersedesId, { ownerType, employeeId, selfUpload });
  });

  // 3. Inspect and scan the file.
  const file = await inspectUpload(params.file);
  const scanStatus = await (opts.scanner ?? getMalwareScanner()).scan(file.bytes, file.mimeType).catch(() => "error" as const);
  if (scanStatus === "infected") {
    await ctx.db((tx) =>
      audit(tx, ctx, {
        action: "document.rejected_infected",
        entityType: "document",
        metadata: { ownerType, ownerId, category: params.category, sha256: file.sha256 },
        ip: cleanIp(opts.meta?.ip),
        userAgent: opts.meta?.userAgent,
      }),
    );
    throw validation("This file failed the malware scan and was not stored.", { file: ["Malware detected"] });
  }

  // 4. Store bytes, then metadata. Remove the object if the DB write fails.
  const storagePath = `${ctx.tenantId}/${ownerType}/${ownerId ?? "company"}/${randomUUID()}.${file.ext}`;
  await putObject(BUCKET, storagePath, file.bytes, file.mimeType);

  try {
    return await ctx.db(async (tx) => {
      let version = 1;
      if (params.supersedesId) {
        const previous = await loadSupersedable(tx, ctx, params.supersedesId, { ownerType, employeeId, selfUpload }, true);
        version = previous.version + 1;
        await tx.update(documents).set({ isCurrent: false }).where(eq(documents.id, previous.id));
      }
      const [doc] = await tx
        .insert(documents)
        .values({
          tenantId: ctx.tenantId,
          ownerType,
          ownerId,
          employeeId,
          category: params.category,
          title: params.title.trim(),
          bucket: BUCKET,
          storagePath,
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
          version,
          supersedesId: params.supersedesId ?? null,
          isCurrent: true,
          employeeVisible,
          isSensitive,
          expiresOn: params.expiresOn ?? null,
          scanStatus,
          uploadedBy: ctx.userId,
        })
        .returning({ id: documents.id, version: documents.version });

      await audit(tx, ctx, {
        action: "document.uploaded",
        entityType: "document",
        entityId: doc.id,
        metadata: {
          ownerType,
          ownerId,
          category: params.category,
          version,
          supersedesId: params.supersedesId ?? null,
          sizeBytes: file.sizeBytes,
          mimeType: file.mimeType,
          scanStatus,
          selfUpload,
        },
        ip: cleanIp(opts.meta?.ip),
        userAgent: opts.meta?.userAgent,
        requestId: opts.meta?.requestId,
      });

      if (selfUpload && employeeId) {
        const reviewers = (await userIdsWithPermission(tx, ctx.tenantId, "documents.manage")).filter((u) => u !== ctx.userId);
        await notify(tx, {
          tenantId: ctx.tenantId,
          userIds: reviewers,
          category: "documents",
          title: "New employee document to verify",
          body: `${params.title.trim()} was uploaded from self-service.`,
          href: `/employees/${employeeId}`,
          dedupeKey: `document-uploaded:${doc.id}`,
        });
      }
      return { id: doc.id, version: doc.version, scanStatus };
    });
  } catch (err) {
    await removeObject(BUCKET, storagePath);
    throw err;
  }
}

async function loadSupersedable(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  target: { ownerType: string; employeeId: string | null; selfUpload: boolean },
  lock = false,
) {
  const q = tx
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), isNull(documents.deletedAt)));
  const [prev] = lock ? await q.for("update") : await q;
  if (!prev) throw notFound("Previous version");
  if (!prev.isCurrent) throw invalidState("A newer version of this document already exists.");
  if (prev.ownerType !== target.ownerType || (prev.employeeId ?? null) !== target.employeeId) {
    throw validation("A new version must belong to the same owner as the original.");
  }
  if (target.selfUpload && prev.uploadedBy !== ctx.userId) {
    throw forbidden("You can only replace documents you uploaded yourself.");
  }
  return prev;
}

/* ------------------------------------------------------------------ */
/* Download                                                            */
/* ------------------------------------------------------------------ */

/**
 * Authorize, mint a 60-second signed URL and log the access. The log row is
 * written before the URL is returned, so no download goes unrecorded.
 */
export async function createDownloadLink(
  ctx: RequestContext,
  documentId: string,
  meta: RequestMeta = {},
): Promise<{ url: string; fileName: string }> {
  const doc = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));
    return row ?? null;
  });
  if (!doc) throw notFound("Document");
  if (!(await canViewDocument(ctx, doc))) throw forbidden();

  const url = await signedDownloadUrl(doc.bucket, doc.storagePath, doc.fileName, 60);
  await ctx.db(async (tx) => {
    await tx.insert(documentAccessLogs).values({
      tenantId: ctx.tenantId,
      documentId: doc.id,
      userId: ctx.userId,
      action: "download",
      ip: meta.ip?.slice(0, 64) ?? null,
    });
    if (doc.isSensitive) {
      await audit(tx, ctx, {
        action: "document.downloaded",
        entityType: "document",
        entityId: doc.id,
        metadata: { ownerType: doc.ownerType, ownerId: doc.ownerId, category: doc.category },
        ip: cleanIp(meta.ip),
        userAgent: meta.userAgent,
        requestId: meta.requestId,
      });
    }
  });
  return { url, fileName: doc.fileName };
}

/* ------------------------------------------------------------------ */
/* HR operations                                                       */
/* ------------------------------------------------------------------ */

async function lockDocument(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
    .for("update");
  if (!row) throw notFound("Document");
  return row;
}

export async function deleteDocument(ctx: RequestContext, id: string) {
  if (!canManageDocuments(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const doc = await lockDocument(tx, id);
    if (doc.legalHold) throw invalidState("This document is under legal hold and cannot be deleted.");
    await tx.update(documents).set({ deletedAt: new Date(), isCurrent: false }).where(eq(documents.id, id));
    // Deleting the latest version makes the previous one current again.
    let restoredId: string | null = null;
    if (doc.isCurrent && doc.supersedesId) {
      const [restored] = await tx
        .update(documents)
        .set({ isCurrent: true })
        .where(and(eq(documents.id, doc.supersedesId), isNull(documents.deletedAt)))
        .returning({ id: documents.id });
      restoredId = restored?.id ?? null;
    }
    await audit(tx, ctx, {
      action: "document.deleted",
      entityType: "document",
      entityId: id,
      metadata: { ownerType: doc.ownerType, ownerId: doc.ownerId, category: doc.category, version: doc.version, restoredId },
    });
    return { id, restoredId };
  });
}

export async function verifyDocument(ctx: RequestContext, id: string) {
  if (!canManageDocuments(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const doc = await lockDocument(tx, id);
    if (doc.verifiedAt) return { id, verifiedAt: doc.verifiedAt.toISOString() };
    const verifiedAt = new Date();
    await tx.update(documents).set({ verifiedBy: ctx.userId, verifiedAt }).where(eq(documents.id, id));
    await audit(tx, ctx, { action: "document.verified", entityType: "document", entityId: id });
    return { id, verifiedAt: verifiedAt.toISOString() };
  });
}

export async function updateRetention(ctx: RequestContext, input: { id: string; retainUntil: string | null; legalHold: boolean }) {
  if (!canManageDocuments(ctx)) throw forbidden();
  return ctx.db(async (tx) => {
    const doc = await lockDocument(tx, input.id);
    const next = { retainUntil: input.retainUntil, legalHold: input.legalHold };
    await tx.update(documents).set(next).where(eq(documents.id, input.id));
    await audit(tx, ctx, {
      action: "document.retention_updated",
      entityType: "document",
      entityId: input.id,
      changes: diff({ retainUntil: doc.retainUntil, legalHold: doc.legalHold }, next),
    });
    return { id: input.id };
  });
}

export type ExpiringDocument = {
  id: string;
  title: string;
  category: DocumentCategory;
  ownerType: string;
  employeeId: string | null;
  employeeName: string | null;
  employeeCode: string | null;
  expiresOn: string;
  daysLeft: number;
  verifiedAt: string | null;
};

/** Current documents expiring within `withinDays` (and already-expired ones), soonest first. */
export async function expiringDocuments(ctx: RequestContext, withinDays = 60): Promise<ExpiringDocument[]> {
  if (!canManageDocuments(ctx)) throw forbidden();
  const today = todayIn();
  const until = format(addDays(parseISO(today), Math.max(0, Math.min(withinDays, 3650))), "yyyy-MM-dd");
  const rows = await ctx.db((tx) =>
    tx
      .select({
        id: documents.id,
        title: documents.title,
        category: documents.category,
        ownerType: documents.ownerType,
        employeeId: documents.employeeId,
        employeeName: employees.displayName,
        employeeCode: employees.employeeCode,
        expiresOn: documents.expiresOn,
        verifiedAt: documents.verifiedAt,
      })
      .from(documents)
      .leftJoin(employees, eq(employees.id, documents.employeeId))
      .where(
        and(
          isNull(documents.deletedAt),
          eq(documents.isCurrent, true),
          sql`${documents.expiresOn} is not null`,
          lte(documents.expiresOn, until),
          // Exited employees' documents no longer need renewal.
          sql`(${employees.id} is null or ${employees.status} <> 'exited')`,
        ),
      )
      .orderBy(asc(documents.expiresOn))
      .limit(500),
  );
  return rows.map((r) => ({
    ...r,
    expiresOn: r.expiresOn!,
    daysLeft: differenceInCalendarDays(parseISO(r.expiresOn!), parseISO(today)),
    verifiedAt: r.verifiedAt?.toISOString() ?? null,
  }));
}

/** For forms that attach an existing company document (e.g. a policy PDF). */
export async function companyDocumentOptions(ctx: RequestContext) {
  if (!canManageCompanyDocs(ctx)) return [];
  const rows = await ctx.db((tx) =>
    tx
      .select({ id: documents.id, title: documents.title, fileName: documents.fileName })
      .from(documents)
      .where(and(eq(documents.ownerType, "company"), eq(documents.isCurrent, true), isNull(documents.deletedAt)))
      .orderBy(asc(documents.title))
      .limit(500),
  );
  return rows.map((r) => ({ value: r.id, label: r.title, hint: r.fileName }));
}

