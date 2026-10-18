import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActionContext } from "@/server/auth/context";
import { ticketAttachmentUrl } from "@/server/services/helpdesk/tickets";
import { toAppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";

const NO_STORE = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };

/** Ticket attachments: anyone who can see the ticket (RLS) gets a 60-second signed URL; the access is logged. */
export async function GET(request: NextRequest, { params }: RouteContext<"/helpdesk/attachments/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Attachment not found." } }, { status: 404, headers: NO_STORE });
  }
  try {
    const ctx = await requireActionContext();
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
    const url = await ticketAttachmentUrl(ctx, id, { ip });
    return NextResponse.redirect(url, { status: 302, headers: NO_STORE });
  } catch (err) {
    const e = toAppError(err);
    if (e.code === "INTERNAL") logger.error("helpdesk.attachment_download_failed", { err });
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers: NO_STORE });
  }
}
