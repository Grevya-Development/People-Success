import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/server/api/http";
import { AppError } from "@/server/lib/errors";
import { rateLimit } from "@/server/lib/rate-limit";
import { MAX_DEVICE_WEBHOOK_BYTES, receiveDeviceWebhook } from "@/server/services/device-webhook";

/** Signed punches from attendance devices. See docs/INTEGRATIONS.md. */
export async function POST(request: NextRequest, { params }: RouteContext<"/api/webhooks/attendance_device/[connectionId]">) {
  const requestId = randomUUID();
  try {
    const { connectionId } = await params;
    await rateLimit(`device-webhook:${connectionId.slice(0, 36)}`, 120, 60);
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_DEVICE_WEBHOOK_BYTES) throw new AppError("VALIDATION", "Payload too large; send at most 1000 events per request.");
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_DEVICE_WEBHOOK_BYTES) throw new AppError("VALIDATION", "Payload too large; send at most 1000 events per request.");
    const result = await receiveDeviceWebhook(connectionId, raw, request.headers.get("x-peoplesuccess-signature"));
    return NextResponse.json(result, { headers: { "x-request-id": requestId, "cache-control": "no-store" } });
  } catch (err) {
    return apiError(err, requestId);
  }
}
