"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/validations/auth";
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit/check-rate-limit";
import { getClientIp } from "@/lib/rate-limit/get-client-ip";

// Server Functions are reachable directly via POST, not just through this
// app's forms — every one of these re-validates input itself rather than
// trusting client-side validation.
export type AuthActionState =
  | {
      error?: string;
      fieldErrors?: Partial<Record<string, string[]>>;
      success?: boolean;
    }
  | undefined;

export async function signIn(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await checkRateLimit("auth:sign_in", await getClientIp());
  } catch (error) {
    if (error instanceof RateLimitError) return { error: error.message };
    throw error;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: error.message };
  }

  redirect("/dashboard");
}

export async function signUp(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await checkRateLimit("auth:sign_up", await getClientIp());
  } catch (error) {
    if (error instanceof RateLimitError) return { error: error.message };
    throw error;
  }

  const supabase = await createClient();
  // A new, unconfirmed account has no session of its own, so drop whatever
  // session this browser already holds — otherwise the person carries on
  // signed in as the previous account.
  await supabase.auth.signOut({ scope: "local" });
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/confirm?next=/auth/verified`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  // No session yet: Supabase requires the confirmation link to be clicked
  // first (see app/auth/confirm/route.ts).
  return { success: true };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function forgotPassword(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    // Dual-keyed: per-IP alone doesn't stop a distributed attacker rotating
    // IPs from email-bombing one victim's inbox with reset emails.
    await checkRateLimit("auth:forgot_password_ip", await getClientIp());
    await checkRateLimit("auth:forgot_password_email", parsed.data.email.toLowerCase());
  } catch (error) {
    if (error instanceof RateLimitError) return { error: error.message };
    throw error;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/confirm?next=/reset-password`,
  });

  // Always report success, even if the error is "user not found" — do not
  // let this endpoint be used to enumerate registered email addresses.
  if (error && error.code !== "user_not_found") {
    return { error: error.message };
  }

  return { success: true };
}

export async function resetPassword(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    signOutOthers: formData.get("signOutOthers") === "true",
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();

  // updateUser acts on the caller's current session. That session must
  // already exist, established by clicking the recovery link (see
  // app/auth/confirm/route.ts) — there's no separate reset token here.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "This password reset link is invalid or has expired. Request a new one." };
  }

  try {
    await checkRateLimit("auth:reset_password", user.id);
  } catch (error) {
    if (error instanceof RateLimitError) return { error: error.message };
    throw error;
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    return { error: error.message };
  }

  // Someone resetting a password may be locking out whoever learned the old
  // one, so ending every other session is offered (and checked by default).
  if (parsed.data.signOutOthers) {
    const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
    if (signOutError) {
      return { error: "Your password was updated, but other devices couldn't be logged out. Try again from Settings → Sessions." };
    }
  }

  redirect("/dashboard");
}
