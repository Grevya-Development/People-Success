import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActionContext } from "@/server/auth/context";
import { recruitmentDocumentLink } from "@/server/services/recruitment/resumes";
import { toAppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";

const NO_STORE = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };

/**
 * Resumes and offer letters. The shared documents route only lets HR
 * download non-employee documents; recruiters, interviewers on the
 * candidate's panel and offer approvers are authorized here instead.
 * Every download is logged and audited, then redirected to a 60-second URL.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/recruitment/documents/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Document not found." } }, { status: 404, headers: NO_STORE });
  }
  try {
    const ctx = await requireActionContext();
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
    const { url } = await recruitmentDocumentLink(ctx, id, { ip, userAgent: request.headers.get("user-agent"), requestId: request.headers.get("x-request-id") });
    return NextResponse.redirect(url, { status: 302, headers: NO_STORE });
  } catch (err) {
    const e = toAppError(err);
    if (e.code === "INTERNAL") logger.error("recruitment.document_download_failed", { err });
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers: NO_STORE });
  }
}
