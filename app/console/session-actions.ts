"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStaffMemberByUsername } from "@/lib/db";
import { getStaffSession } from "@/lib/staff/auth";
import { endStaffActivity, recordStaffActivity } from "@/lib/staff/work-session";
import { recordSignInEvent } from "@/lib/security/auth-events";
import { checkRateLimit, RateLimitError, releaseRateLimitAttempt } from "@/lib/rate-limit/check-rate-limit";
import { getClientIp } from "@/lib/rate-limit/get-client-ip";
import { staffSignInSchema } from "@/lib/validations/staff";

export type StaffSignInState = { error?: string } | undefined;

// The one message for every failure (unknown username, disabled account,
// wrong password), so the form never reveals which usernames exist.
const GENERIC_FAILURE = "Wrong username or password.";

function accountKey(username: string): string {
  return createHash("sha256").update(`staff:${username}`).digest("hex");
}

// Staff sign in with their username, never their email (CLAUDE.md §4:
// re-validates everything itself — Server Functions are reachable by POST).
// The username resolves server-side to the account's auth email; the
// password check is Supabase Auth's. Then the console's own gates take over
// (2-step login, password policy).
export async function staffSignInAction(_previous: StaffSignInState, formData: FormData): Promise<StaffSignInState> {
  const parsed = staffSignInSchema.safeParse({ username: formData.get("username"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? GENERIC_FAILURE };
  const { username, password } = parsed.data;

  const ip = await getClientIp();
  const key = accountKey(username);
  let recordedIp = false;
  let recordedAccount = false;
  try {
    recordedIp = await checkRateLimit("auth:sign_in", ip);
    recordedAccount = await checkRateLimit("auth:sign_in_account", key);
  } catch (error) {
    if (error instanceof RateLimitError) {
      await recordSignInEvent("sign_in_rate_limited", { email: `staff:${username}` });
      return { error: error.message };
    }
    throw error;
  }

  const admin = createAdminClient();
  const staff = await getStaffMemberByUsername(admin, username);
  let email: string | null = null;
  if (staff && staff.status !== "disabled") {
    const { data } = await admin.auth.admin.getUserById(staff.user_id);
    email = data.user?.email ?? null;
  }

  if (!staff || !email) {
    await recordSignInEvent("sign_in_failure", { email: `staff:${username}` });
    return { error: GENERIC_FAILURE };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || data.user?.id !== staff.user_id) {
    if (!error) await supabase.auth.signOut();
    await recordSignInEvent("sign_in_failure", { email });
    return { error: GENERIC_FAILURE };
  }

  await recordSignInEvent("sign_in_success", { userId: staff.user_id });
  await Promise.all([
    recordedIp ? releaseRateLimitAttempt("auth:sign_in", ip) : undefined,
    recordedAccount ? releaseRateLimitAttempt("auth:sign_in_account", key) : undefined,
  ]);
  redirect("/console");
}

// Ends the open work session, then the auth session.
export async function staffSignOutAction(): Promise<void> {
  const session = await getStaffSession().catch(() => null);
  if (session) await endStaffActivity(session.staff.id, "signed_out");
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/console/login");
}

// The console's in-page heartbeat (components/console/console-presence.tsx):
// keeps the current work session open while the person is actively using
// the console. Returns nothing either way; it only ever records activity
// for the caller's own verified staff session.
export async function staffHeartbeatAction(): Promise<void> {
  const session = await getStaffSession().catch(() => null);
  if (!session || session.mfa !== "verified") return;
  await recordStaffActivity(session.staff.id);
}
