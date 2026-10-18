"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import type { z } from "zod";
import { failure, zodFieldErrors, type ActionResult } from "@/server/lib/action";
import { AppError } from "@/server/lib/errors";
import { sendNow } from "@/server/services/email";
import { respondToOffer } from "@/server/services/recruitment/offer-response";
import { offerResponseSchema } from "@/lib/validation/recruitment";

/** Candidate accepts or declines from the emailed link (no session; the token authorizes). */
export async function respondToOfferAction(raw: z.input<typeof offerResponseSchema>): Promise<ActionResult<{ state: string; alreadyResponded: boolean }>> {
  try {
    const parsed = offerResponseSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("VALIDATION", "Please confirm your response.", { fieldErrors: zodFieldErrors(parsed.error) });
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
    const r = await respondToOffer(parsed.data.token, parsed.data.decision, parsed.data.note, { ip, userAgent: h.get("user-agent") });
    if (r.outboxIds.length) after(async () => {
      for (const id of r.outboxIds) await sendNow(id);
    });
    return { ok: true, data: { state: r.state, alreadyResponded: r.alreadyResponded } };
  } catch (err) {
    return failure(err);
  }
}
