import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { db } from "@/server/db/client";
import { auditLogs, documentAccessLogs, documents, employees, legalEntities } from "@/server/db/schema";
import type { RequestContext } from "@/server/auth/context";
import {
  createDownloadLink,
  deleteDocument,
  expiringDocuments,
  listDocuments,
  updateRetention,
  uploadDocument,
  verifyDocument,
} from "@/server/services/documents/documents";
import { contentMatches, sanitizeFileName } from "@/server/services/documents/files";
import { addMember, contextFor, createOwnedTenant } from "../helpers/fixtures";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const pdfFile = (name = "contract.pdf", bytes: Uint8Array = PDF, type = "application/pdf") =>
  new File([bytes as BlobPart], name, { type });

type Tenant = Awaited<ReturnType<typeof createOwnedTenant>>;

async function createEmployee(tenantId: string, code: string, name: string, managerId: string | null = null) {
  const [le] = await db.select().from(legalEntities).where(eq(legalEntities.tenantId, tenantId));
  const [e] = await db
    .insert(employees)
    .values({
      tenantId,
      legalEntityId: le.id,
      employeeCode: code,
      firstName: name.split(" ")[0],
      displayName: name,
      joiningDate: "2025-04-01",
      status: "active",
      managerId,
    })
    .returning();
  return e.id;
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
}

describe("documents", () => {
  let a: Tenant;
  let b: Tenant;
  let managerEmp: string;
  let reportEmp: string;
  let otherEmp: string;
  let hr: RequestContext;
  let manager: RequestContext;
  let report: RequestContext;
  let other: RequestContext;
  let ownerB: RequestContext;
  const storedPaths: string[] = [];

  beforeAll(async () => {
    a = await createOwnedTenant();
    b = await createOwnedTenant();
    managerEmp = await createEmployee(a.tenant.id, "EMP0001", "Meera Iyer");
    reportEmp = await createEmployee(a.tenant.id, "EMP0002", "Ravi Kumar", managerEmp);
    otherEmp = await createEmployee(a.tenant.id, "EMP0003", "Omkar Patil");
    const hrUser = await addMember(a.tenant.id, ["hr_manager"]);
    const mUser = await addMember(a.tenant.id, ["people_manager"], { employeeId: managerEmp });
    const rUser = await addMember(a.tenant.id, ["employee"], { employeeId: reportEmp });
    const oUser = await addMember(a.tenant.id, ["employee"], { employeeId: otherEmp });
    hr = await contextFor(a.tenant.id, hrUser.user.id);
    manager = await contextFor(a.tenant.id, mUser.user.id);
    report = await contextFor(a.tenant.id, rUser.user.id);
    other = await contextFor(a.tenant.id, oUser.user.id);
    ownerB = await contextFor(b.tenant.id, b.user.id);
  });

  afterAll(async () => {
    const rows = await db.select({ path: documents.storagePath }).from(documents).where(eq(documents.tenantId, a.tenant.id));
    storedPaths.push(...rows.map((r) => r.path));
    if (storedPaths.length) {
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
        auth: { persistSession: false },
      });
      await admin.storage.from("documents").remove(storedPaths);
    }
  });

  it("uploads, lists, creates a signed URL and logs the access", async () => {
    const up = await uploadDocument(hr, {
      ownerType: "employee",
      employeeId: reportEmp,
      category: "contract",
      title: "Employment contract",
      file: pdfFile("../../etc/Employment contract.pdf"),
      isSensitive: true,
    });
    expect(up.version).toBe(1);
    expect(up.scanStatus).toBe("skipped");

    const [row] = await db.select().from(documents).where(eq(documents.id, up.id));
    expect(row.storagePath.startsWith(`${a.tenant.id}/employee/${reportEmp}/`)).toBe(true);
    expect(row.fileName).toBe("Employment contract.pdf");
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);

    const listed = await listDocuments(hr, { employeeId: reportEmp });
    expect(listed.map((d) => d.id)).toContain(up.id);

    const link = await createDownloadLink(hr, up.id, { ip: "203.0.113.7", userAgent: "vitest" });
    expect(link.url).toContain("token=");
    expect(link.fileName).toBe("Employment contract.pdf");
    const res = await fetch(link.url);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);

    const logs = await db.select().from(documentAccessLogs).where(eq(documentAccessLogs.documentId, up.id));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: "download", userId: hr.userId, ip: "203.0.113.7" });

    const audits = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, a.tenant.id), eq(auditLogs.entityId, up.id)));
    expect(audits.map((x) => x.action).sort()).toEqual(["document.downloaded", "document.uploaded"]);
  });

  it("applies self-service and team visibility", async () => {
    const hrOnly = await uploadDocument(hr, {
      ownerType: "employee",
      employeeId: reportEmp,
      category: "appraisal",
      title: "HR note",
      file: pdfFile("note.pdf"),
      employeeVisible: false,
    });
    const self = await uploadDocument(report, {
      ownerType: "employee",
      employeeId: reportEmp,
      category: "education",
      title: "Degree certificate",
      file: pdfFile("degree.pdf"),
      employeeVisible: false, // ignored for self uploads
    });
    const idProof = await uploadDocument(report, {
      ownerType: "employee",
      employeeId: reportEmp,
      category: "identity",
      title: "PAN card",
      file: new File([PNG as BlobPart], "pan.png", { type: "image/png" }),
    });

    const mine = await listDocuments(report, { employeeId: reportEmp });
    const mineIds = mine.map((d) => d.id);
    expect(mineIds).toContain(self.id);
    expect(mineIds).toContain(idProof.id);
    expect(mineIds).not.toContain(hrOnly.id);
    expect(mine.find((d) => d.id === idProof.id)?.isSensitive).toBe(true);

    // Another employee cannot list or download.
    await expectCode(listDocuments(other, { employeeId: reportEmp }), "FORBIDDEN");
    await expectCode(createDownloadLink(other, self.id), "FORBIDDEN");
    // Employees cannot download HR-only documents about themselves.
    await expectCode(createDownloadLink(report, hrOnly.id), "FORBIDDEN");

    // The manager sees the report's employee-visible, non-sensitive documents.
    const team = await listDocuments(manager, { employeeId: reportEmp });
    const teamIds = team.map((d) => d.id);
    expect(teamIds).toContain(self.id);
    expect(teamIds).not.toContain(hrOnly.id);
    expect(teamIds).not.toContain(idProof.id);
    await expectCode(listDocuments(manager, { employeeId: otherEmp }), "FORBIDDEN");
    const link = await createDownloadLink(manager, self.id);
    expect(link.url).toContain("token=");

    // Self-service restrictions.
    await expectCode(
      uploadDocument(report, { ownerType: "employee", employeeId: reportEmp, category: "contract", title: "X", file: pdfFile() }),
      "FORBIDDEN",
    );
    await expectCode(
      uploadDocument(report, { ownerType: "employee", employeeId: otherEmp, category: "other", title: "X", file: pdfFile() }),
      "FORBIDDEN",
    );
    await expectCode(
      uploadDocument(report, { ownerType: "company", category: "other", title: "X", file: pdfFile() }),
      "FORBIDDEN",
    );
    // Verification is HR-only.
    await expectCode(verifyDocument(report, self.id), "FORBIDDEN");
    const v = await verifyDocument(hr, self.id);
    expect(v.verifiedAt).toBeTruthy();
  });

  it("isolates tenants", async () => {
    const up = await uploadDocument(hr, {
      ownerType: "employee",
      employeeId: reportEmp,
      category: "certificate",
      title: "Tenant A only",
      file: pdfFile("a.pdf"),
    });
    // Tenant B's owner has documents.manage:all, yet sees nothing of tenant A.
    expect(await listDocuments(ownerB, { employeeId: reportEmp })).toEqual([]);
    await expectCode(createDownloadLink(ownerB, up.id), "NOT_FOUND");
    await expectCode(verifyDocument(ownerB, up.id), "NOT_FOUND");
    await expectCode(
      uploadDocument(ownerB, { ownerType: "employee", employeeId: reportEmp, category: "other", title: "X", file: pdfFile() }),
      "NOT_FOUND",
    );
    const logs = await db.select().from(documentAccessLogs).where(eq(documentAccessLogs.documentId, up.id));
    expect(logs).toHaveLength(0);
  });

  it("versions documents and marks the previous version not current", async () => {
    const v1 = await uploadDocument(hr, {
      ownerType: "employee",
      employeeId: otherEmp,
      category: "contract",
      title: "Contract",
      file: pdfFile("contract-v1.pdf"),
    });
    const v2 = await uploadDocument(hr, {
      ownerType: "employee",
      employeeId: otherEmp,
      category: "contract",
      title: "Contract (revised)",
      file: pdfFile("contract-v2.pdf"),
      supersedesId: v1.id,
    });
    expect(v2.version).toBe(2);
    const [old] = await db.select().from(documents).where(eq(documents.id, v1.id));
    const [cur] = await db.select().from(documents).where(eq(documents.id, v2.id));
    expect(old.isCurrent).toBe(false);
    expect(cur).toMatchObject({ isCurrent: true, supersedesId: v1.id, version: 2 });

    const listed = await listDocuments(hr, { employeeId: otherEmp });
    expect(listed.map((d) => d.id)).toContain(v2.id);
    expect(listed.map((d) => d.id)).not.toContain(v1.id);

    await expectCode(
      uploadDocument(hr, {
        ownerType: "employee",
        employeeId: otherEmp,
        category: "contract",
        title: "Stale",
        file: pdfFile(),
        supersedesId: v1.id,
      }),
      "INVALID_STATE",
    );
    // Wrong owner.
    await expectCode(
      uploadDocument(hr, {
        ownerType: "employee",
        employeeId: reportEmp,
        category: "contract",
        title: "Wrong owner",
        file: pdfFile(),
        supersedesId: v2.id,
      }),
      "VALIDATION",
    );

    // Deleting the latest version restores the previous one.
    const del = await deleteDocument(hr, v2.id);
    expect(del.restoredId).toBe(v1.id);
    const [restored] = await db.select().from(documents).where(eq(documents.id, v1.id));
    expect(restored.isCurrent).toBe(true);
  });

  it("blocks deletion under legal hold", async () => {
    const up = await uploadDocument(hr, {
      ownerType: "company",
      category: "policy",
      title: "Employee handbook",
      file: pdfFile("handbook.pdf"),
    });
    await updateRetention(hr, { id: up.id, retainUntil: "2033-03-31", legalHold: true });
    await expectCode(deleteDocument(hr, up.id), "INVALID_STATE");
    await expectCode(deleteDocument(report, up.id), "FORBIDDEN");

    // Company documents are visible to every member.
    expect((await listDocuments(other, { ownerType: "company" })).map((d) => d.id)).toContain(up.id);

    await updateRetention(hr, { id: up.id, retainUntil: "2033-03-31", legalHold: false });
    await deleteDocument(hr, up.id);
    const [row] = await db.select().from(documents).where(eq(documents.id, up.id));
    expect(row.deletedAt).not.toBeNull();
    expect((await listDocuments(hr, { ownerType: "company" })).map((d) => d.id)).not.toContain(up.id);
    await expectCode(createDownloadLink(hr, up.id), "NOT_FOUND");
  });

  it("rejects disallowed, mismatched and infected files", async () => {
    const base = { ownerType: "employee" as const, employeeId: otherEmp, category: "other" as const, title: "Bad" };
    await expectCode(uploadDocument(hr, { ...base, file: new File([PNG as BlobPart], "fake.pdf", { type: "application/pdf" }) }), "VALIDATION");
    await expectCode(uploadDocument(hr, { ...base, file: new File(["MZ..." as BlobPart], "tool.exe", { type: "application/octet-stream" }) }), "VALIDATION");
    await expectCode(uploadDocument(hr, { ...base, file: new File([PDF as BlobPart], "doc.pdf", { type: "image/png" }) }), "VALIDATION");
    await expectCode(uploadDocument(hr, { ...base, file: new File([PDF as BlobPart], "notes.txt", { type: "text/plain" }) }), "VALIDATION");

    const before = await db.select({ id: documents.id }).from(documents).where(eq(documents.tenantId, a.tenant.id));
    await expectCode(
      uploadDocument(hr, { ...base, file: pdfFile("eicar.pdf") }, { scanner: { scan: async () => "infected" } }),
      "VALIDATION",
    );
    const after = await db.select({ id: documents.id }).from(documents).where(eq(documents.tenantId, a.tenant.id));
    expect(after.length).toBe(before.length);

    // Plain text with a generic browser MIME is accepted.
    const ok = await uploadDocument(hr, { ...base, title: "Notes", file: new File(["Line one\nLine two\n"], "notes.md", { type: "" }) });
    const [row] = await db.select().from(documents).where(eq(documents.id, ok.id));
    expect(row.mimeType).toBe("text/markdown");
  });

  it("lists expiring documents for HR only", async () => {
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const up = await uploadDocument(hr, {
      ownerType: "employee",
      employeeId: reportEmp,
      category: "identity",
      title: "Passport",
      file: pdfFile("passport.pdf"),
      expiresOn: soon,
    });
    const rows = await expiringDocuments(hr, 60);
    const hit = rows.find((r) => r.id === up.id);
    expect(hit).toMatchObject({ employeeName: "Ravi Kumar", expiresOn: soon });
    expect(hit!.daysLeft).toBeGreaterThanOrEqual(9);
    await expectCode(expiringDocuments(report, 60), "FORBIDDEN");
  });

  it("sniffs content and sanitizes names", () => {
    expect(contentMatches("pdf", PDF)).toBe(true);
    expect(contentMatches("png", PNG)).toBe(true);
    expect(contentMatches("pdf", PNG)).toBe(false);
    expect(contentMatches("docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toBe(false);
    expect(contentMatches("csv", new TextEncoder().encode("a,b\n1,2\n"))).toBe(true);
    expect(contentMatches("csv", new Uint8Array([0x61, 0x00, 0x62]))).toBe(false);
    expect(sanitizeFileName("..\\..\\evil<script>.pdf")).toBe("evilscript.pdf");
    expect(sanitizeFileName("   ")).toBe("document");
  });
});
