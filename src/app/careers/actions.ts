"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { failure, zodFieldErrors, type ActionResult } from "@/server/lib/action";
import { AppError } from "@/server/lib/errors";
import { sendNow } from "@/server/services/email";
import { submitPublicApplication } from "@/server/services/recruitment/careers";
import { publicApplicationSchema } from "@/lib/validation/recruitment";

/**
 * Public application from the careers page (no session). Validation, rate
 * limiting, duplicate detection and storage happen in the careers service,
 * which runs in system context scoped to the tenant in the URL.
 */
export async function applyForJobAction(form: FormData): Promise<ActionResult<{ received: true }>> {
  try {
    if (!(form instanceof FormData)) throw new AppError("VALIDATION", "Invalid submission.");
    const answers: Record<string, string> = {};
    const fields: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) {
      if (typeof v !== "string") continue;
      if (k.startsWith("answers.")) answers[k.slice(8)] = v;
      else fields[k] = v;
    }
    const parsed = publicApplicationSchema.safeParse({ ...fields, answers, consent: fields.consent === "on" || fields.consent === "true" });
    if (!parsed.success) throw new AppError("VALIDATION", "Please correct the highlighted fields.", { fieldErrors: zodFieldErrors(parsed.error) });
    const resume = form.get("resume");
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
    const receipt = await submitPublicApplication(parsed.data, resume instanceof File && resume.size > 0 ? resume : null, { ip, userAgent: h.get("user-agent") });
    if (receipt.outboxIds.length) after(async () => {
      for (const id of receipt.outboxIds) await sendNow(id);
    });
    // Bots that filled the honeypot get the same response as people.
    return { ok: true, data: { received: true } };
  } catch (err) {
    return failure(err);
  }
}
