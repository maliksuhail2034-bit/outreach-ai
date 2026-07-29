import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles every email-link flow (signup confirmation, password recovery,
// invites) via Supabase's token_hash + type OTP verification.
//
// This requires the corresponding Supabase project's email templates to
// point here instead of the default Supabase-hosted confirmation URL:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/dashboard
// (type=recovery&next=/reset-password for the "Reset Password" template.)
// See CLAUDE.md — this is a one-time dashboard configuration step, not
// something this codebase can set on its own.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/dashboard";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      redirect(next);
    }
  }

  redirect(`/login?error=${encodeURIComponent("This link is invalid or has expired.")}`);
}
