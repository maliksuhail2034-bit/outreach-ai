"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/validations/auth";
import { checkRateLimit, RateLimitError, releaseRateLimitAttempt } from "@/lib/rate-limit/check-rate-limit";
import { getClientIp } from "@/lib/rate-limit/get-client-ip";
import { TIMEZONES } from "@/lib/timezones";
import { recordSignInEvent } from "@/lib/security/auth-events";

// Rate-limit identity for a per-account limit: a one-way hash, so the
// rate_limit_events table never stores who tried to sign in (GDPR data
// minimisation) while still counting attempts against the same account.
function accountRateLimitIdentity(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

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

  const ip = await getClientIp();
  const accountKey = accountRateLimitIdentity(parsed.data.email);
  let recordedIp = false;
  let recordedAccount = false;
  try {
    // Dual-keyed like forgot-password: per-IP stops one source hammering
    // many accounts, per-account stops a botnet rotating IPs against one
    // account (credential stuffing / targeted brute force, OWASP A07).
    recordedIp = await checkRateLimit("auth:sign_in", ip);
    recordedAccount = await checkRateLimit("auth:sign_in_account", accountKey);
  } catch (error) {
    if (error instanceof RateLimitError) {
      await recordSignInEvent("sign_in_rate_limited", { email: parsed.data.email });
      return { error: error.message };
    }
    throw error;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Counted: every failure uses up the allowance the same way, whether or
    // not the account exists, so the limit itself reveals nothing.
    await recordSignInEvent("sign_in_failure", { email: parsed.data.email });
    return { error: error.message };
  }

  // Staff sign in only at /console/login with their username, so knowing a
  // staff member's email is never enough to start a session. Said only after
  // a correct password, so it reveals nothing to someone guessing.
  if (data.user?.app_metadata?.polimatiq_staff === true) {
    await supabase.auth.signOut();
    await recordSignInEvent("sign_in_failure", { email: parsed.data.email });
    return { error: "Staff accounts sign in at /console/login with their username." };
  }

  await recordSignInEvent("sign_in_success", { userId: data.user?.id ?? null });

  // Only failed attempts count toward the limits — refund the two this
  // successful sign-in reserved. Revealing nothing: the caller already
  // knows the password was right.
  await Promise.all([
    recordedIp ? releaseRateLimitAttempt("auth:sign_in", ip) : undefined,
    recordedAccount ? releaseRateLimitAttempt("auth:sign_in_account", accountKey) : undefined,
  ]);

  redirect("/dashboard");
}

export async function signUp(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    timezone: formData.get("timezone") ?? undefined,
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
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Seeds the profile on first confirmation (app/auth/confirm/route.ts),
      // so the name typed here is what Settings shows — never asked twice.
      data: {
        full_name: parsed.data.fullName,
        ...(parsed.data.timezone && (TIMEZONES as readonly string[]).includes(parsed.data.timezone)
          ? { timezone: parsed.data.timezone }
          : {}),
      },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/confirm?next=/dashboard`,
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

  redirect("/dashboard");
}
