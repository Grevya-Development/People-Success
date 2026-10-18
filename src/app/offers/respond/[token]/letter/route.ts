import { NextResponse, type NextRequest } from "next/server";
import { offerLetterLinkByToken } from "@/server/services/recruitment/offer-response";
import { toAppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";

const NO_STORE = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };

/** Offer letter download authorized by the response token (logged). */
export async function GET(request: NextRequest, { params }: RouteContext<"/offers/respond/[token]/letter">) {
  const { token } = await params;
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
    const { url } = await offerLetterLinkByToken(token, ip);
    return NextResponse.redirect(url, { status: 302, headers: NO_STORE });
  } catch (err) {
    const e = toAppError(err);
    if (e.code === "INTERNAL") logger.error("offer.letter_download_failed", { err });
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers: NO_STORE });
  }
}
