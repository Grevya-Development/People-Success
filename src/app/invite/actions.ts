"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import type { z } from "zod";
import { getSession, TENANT_COOKIE } from "@/server/auth/context";
import { accessTag } from "@/server/auth/access";
import { supabaseServer } from "@/server/auth/supabase";
import { env } from "@/server/env";
import { AppError } from "@/server/lib/errors";
import { failure, zodFieldErrors, type ActionResult } from "@/server/lib/action";
import { rateLimit } from "@/server/lib/rate-limit";
import { sha256 } from "@/server/lib/crypto";
import { acceptInvitation, getInvitationByToken } from "@/server/services/users/invitations";
import { acceptInvitationSchema, invitationTokenSchema, inviteSignUpSchema } from "@/lib/validation/users";

function parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("VALIDATION", "Please correct the highlighted fields.", { fieldErrors: zodFieldErrors(parsed.error) });
  }
  return parsed.data;
}

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

/**
 * Create an account for the invited address. The email comes from the
 * invitation, never from the client, so the account always matches it.
 */
export async function inviteSignUpAction(raw: z.input<typeof inviteSignUpSchema>): Promise<ActionResult<{ needsConfirmation: boolean }>> {
  try {
    const input = parse(inviteSignUpSchema, raw);
    await rateLimit(`signup:ip:${await clientIp()}`, 10, 3600);
    await rateLimit(`invite-signup:${sha256(input.token).slice(0, 24)}`, 5, 3600);
    const inv = await getInvitationByToken(input.token);
    if (inv.state !== "valid" || !inv.email) throw new AppError("INVALID_STATE", "This invitation is no longer valid.");
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.signUp({
      email: inv.email,
      password: input.password,
      options: {
        data: { full_name: input.fullName },
        emailRedirectTo: `${env().NEXT_PUBLIC_APP_URL}/auth/confirm?next=${encodeURIComponent(`/invite/${input.token}`)}`,
      },
    });
    if (error) {
      if (error.code === "weak_password") throw new AppError("VALIDATION", "Choose a stronger password.", { fieldErrors: { password: [error.message] } });
      if (error.code === "user_already_exists") throw new AppError("CONFLICT", "An account with this email already exists. Sign in instead.");
      throw new AppError("VALIDATION", error.message);
    }
    return { ok: true, data: { needsConfirmation: !data.session } };
  } catch (err) {
    return failure(err);
  }
}

/** Join the organization. On success sets the active tenant and goes to the overview. */
export async function acceptInvitationAction(raw: z.input<typeof acceptInvitationSchema>): Promise<ActionResult<never>> {
  try {
    const input = parse(acceptInvitationSchema, raw);
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHENTICATED", "Please sign in to accept this invitation.");
    await rateLimit(`invite-accept:${session.userId}`, 20, 3600);
    const res = await acceptInvitation({ userId: session.userId, email: session.email }, input);
    (await cookies()).set(TENANT_COOKIE, res.tenantId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
    });
    updateTag(accessTag(session.userId));
  } catch (err) {
    return failure(err);
  }
  redirect("/overview");
}

/** Signed in with the wrong account: sign out and come back to the invitation. */
export async function signOutForInviteAction(token: string) {
  const safe = invitationTokenSchema.safeParse(token);
  const supabase = await supabaseServer();
  await supabase.auth.signOut({ scope: "local" });
  redirect(safe.success ? `/login?next=${encodeURIComponent(`/invite/${safe.data}`)}` : "/login");
}
