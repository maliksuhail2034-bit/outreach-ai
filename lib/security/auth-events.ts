import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { insertAuthEvent } from "@/lib/db/security";
import { trustedClientIp } from "@/lib/rate-limit/get-client-ip";
import { countryFromHeaders } from "@/lib/billing/region";
import { captureError } from "@/lib/monitoring/error-tracking";
import { errorMessage } from "@/lib/monitoring/error-message";

export type AuthEventType = "sign_in_success" | "sign_in_failure" | "sign_in_rate_limited";

const USER_AGENT_MAX = 400;

// The same one-way hash the per-account sign-in rate limit uses, so the
// security panel can group failures against one account without storing
// the address anyone typed.
export function hashSignInEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

// Records a sign-in outcome for the staff security panel (auth_events).
// Best-effort: a failed write is logged and reported but never changes the
// sign-in result. Failures carry only the email hash; successes carry the
// user id instead.
export async function recordSignInEvent(
  type: AuthEventType,
  identity: { userId?: string | null; email?: string },
): Promise<void> {
  try {
    const requestHeaders = await headers();
    const userAgent = requestHeaders.get("user-agent");
    await insertAuthEvent(createAdminClient(), {
      event_type: type,
      user_id: identity.userId ?? null,
      email_hash: type === "sign_in_success" || !identity.email ? null : hashSignInEmail(identity.email),
      ip: trustedClientIp(requestHeaders),
      country: countryFromHeaders(requestHeaders),
      user_agent: userAgent ? userAgent.slice(0, USER_AGENT_MAX) : null,
    });
  } catch (error) {
    const message = errorMessage(error, "Unknown error recording a sign-in event.");
    console.error("[auth-events] write failed", { type, error: message });
    await captureError({ job: "staff-console", message: `Sign-in event write failed: ${message}`, context: { type } });
  }
}
