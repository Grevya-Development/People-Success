"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { supabaseServer } from "@/server/auth/supabase";
import { rateLimit } from "@/server/lib/rate-limit";
import { AppError } from "@/server/lib/errors";
import { failure, zodFieldErrors, type ActionResult } from "@/server/lib/action";
import { env } from "@/server/env";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  safeNext,
  signInSchema,
  signUpSchema,
} from "@/lib/validation/auth";
import { logger } from "@/server/lib/logger";

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

function parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("VALIDATION", "Please correct the highlighted fields.", { fieldErrors: zodFieldErrors(parsed.error) });
  }
  return parsed.data;
}

export async function signInAction(raw: z.input<typeof signInSchema>): Promise<ActionResult<{ next: string }>> {
  try {
    const input = parse(signInSchema, raw);
    const ip = await clientIp();
    await rateLimit(`signin:ip:${ip}`, 30, 300);
    await rateLimit(`signin:email:${input.email}`, 8, 300);
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.signInWithPassword({ email: input.email, password: input.password });
    if (error) {
      if (error.code === "email_not_confirmed") {
        throw new AppError("PRECONDITION", "Please confirm your email first. Check your inbox for the confirmation link.");
      }
      logger.info("auth.signin.failed", { code: error.code });
      throw new AppError("UNAUTHENTICATED", "Incorrect email or password.");
    }
    return { ok: true, data: { next: safeNext(input.next) } };
  } catch (err) {
    return failure(err);
  }
}

export async function signUpAction(raw: z.input<typeof signUpSchema>): Promise<ActionResult<{ needsConfirmation: boolean }>> {
  try {
    const input = parse(signUpSchema, raw);
    await rateLimit(`signup:ip:${await clientIp()}`, 10, 3600);
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: { full_name: input.fullName },
        emailRedirectTo: `${env().NEXT_PUBLIC_APP_URL}/auth/confirm?next=${encodeURIComponent(safeNext(input.next, "/setup/organization"))}`,
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

export async function forgotPasswordAction(raw: z.input<typeof forgotPasswordSchema>): Promise<ActionResult<null>> {
  try {
    const input = parse(forgotPasswordSchema, raw);
    await rateLimit(`reset:ip:${await clientIp()}`, 10, 3600);
    await rateLimit(`reset:email:${input.email}`, 3, 3600);
    const supabase = await supabaseServer();
    // Always report success so this endpoint cannot be used to discover accounts.
    const { error } = await supabase.auth.resetPasswordForEmail(input.email, {
      redirectTo: `${env().NEXT_PUBLIC_APP_URL}/auth/confirm?next=/reset-password`,
    });
    if (error) logger.warn("auth.reset.failed", { code: error.code });
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

export async function resetPasswordAction(raw: z.input<typeof resetPasswordSchema>): Promise<ActionResult<null>> {
  try {
    const input = parse(resetPasswordSchema, raw);
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getClaims();
    if (!data?.claims) throw new AppError("UNAUTHENTICATED", "Your reset link has expired. Request a new one.");
    const { error } = await supabase.auth.updateUser({ password: input.password });
    if (error) throw new AppError("VALIDATION", error.message, { fieldErrors: { password: [error.message] } });
    return { ok: true, data: null };
  } catch (err) {
    return failure(err);
  }
}

export async function signOutAction() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
