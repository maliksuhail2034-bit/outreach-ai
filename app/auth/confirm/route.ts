import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveSafeRedirectPath } from "@/lib/auth/safe-redirect";

// Handles every email-link flow (signup confirmation, password recovery,
// invites) via Supabase's token_hash + type OTP verification.
//
// This requires the corresponding Supabase project's email templates to
// point here instead of the default Supabase-hosted confirmation URL:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/dashboard
// (type=recovery&next=/reset-password for the "Reset Password" template.)
// Locally this is already wired up — see supabase/config.toml's
// [auth.email.template.confirmation]/[auth.email.template.recovery] and
// supabase/templates/*.html. For staging/prod this is a one-time manual
// step in the Supabase Dashboard's Email Templates (see CLAUDE.md) — it
// cannot be set from this codebase for a project this repo isn't linked to.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // `next` is attacker-controlled (an incoming query param, not something
  // only this app ever sets) — see lib/auth/safe-redirect.ts for why an
  // unvalidated value here is a real open redirect, not a theoretical one.
  const next = resolveSafeRedirectPath(searchParams.get("next"), "/dashboard");

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      redirect(next);
    }
  }

  redirect(`/login?error=${encodeURIComponent("This link is invalid or has expired.")}`);
}
