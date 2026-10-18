import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActionContext } from "@/server/auth/context";
import { createDownloadLink } from "@/server/services/documents/documents";
import { toAppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";

const NO_STORE = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };

function errorResponse(err: unknown) {
  const e = toAppError(err);
  if (e.code === "INTERNAL") logger.error("documents.download_failed", { err });
  return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers: NO_STORE });
}

/**
 * Authorizes the caller for the document, records the access and redirects
 * to a 60-second signed Storage URL. The URL itself is never cached.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/documents/[id]/download">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Document not found." } }, { status: 404, headers: NO_STORE });
  }
  try {
    const ctx = await requireActionContext();
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
    const { url } = await createDownloadLink(ctx, id, {
      ip,
      userAgent: request.headers.get("user-agent"),
      requestId: request.headers.get("x-request-id"),
    });
    return NextResponse.redirect(url, { status: 302, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
