// Centralized scope -> limit catalog. Every protected Server Function/Route
// Handler references one of these scopes rather than hardcoding a window/
// count at its own call site — retuning a limit later means editing this
// one map, not hunting through every action.ts that uses it.
export type RateLimitScope =
  | "auth:sign_in"
  | "auth:sign_up"
  | "auth:forgot_password_ip"
  | "auth:forgot_password_email"
  | "auth:reset_password"
  | "ai:generate"
  | "verification:verify_single"
  | "verification:queue"
  | "mailbox:test_connection"
  | "integration:test_digest"
  | "campaign:launch"
  | "campaign:enroll"
  | "campaign:resolve_send_attempt"
  | "leads:import";

interface ScopeConfig {
  windowSeconds: number;
  maxAttempts: number;
  // Whether an *infrastructure* failure in the rate-limit check itself
  // (not "limit exceeded" — the check erroring out) blocks the action or
  // lets it through. See check-rate-limit.ts for the full reasoning: the
  // three unauthenticated auth scopes fail closed (an outage here must not
  // become an open brute-force window on the least-protected surface in
  // the app); every authenticated scope fails open (a transient hiccup
  // must not lock a paying customer out of their own campaign — RLS and
  // billing limits remain the real security boundary on those paths).
  failClosed: boolean;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;

export const RATE_LIMIT_CONFIG: Record<RateLimitScope, ScopeConfig> = {
  "auth:sign_in": { windowSeconds: 15 * MINUTE, maxAttempts: 10, failClosed: true },
  "auth:sign_up": { windowSeconds: HOUR, maxAttempts: 5, failClosed: true },
  // Dual-keyed (see get-client-ip.ts's caller in lib/actions/auth.ts):
  // per-IP alone doesn't stop a distributed attacker rotating IPs from
  // email-bombing one victim's inbox with reset emails.
  "auth:forgot_password_ip": { windowSeconds: HOUR, maxAttempts: 3, failClosed: true },
  "auth:forgot_password_email": { windowSeconds: HOUR, maxAttempts: 3, failClosed: true },
  "auth:reset_password": { windowSeconds: 15 * MINUTE, maxAttempts: 10, failClosed: true },
  "ai:generate": { windowSeconds: HOUR, maxAttempts: 20, failClosed: false },
  "verification:verify_single": { windowSeconds: HOUR, maxAttempts: 30, failClosed: false },
  "verification:queue": { windowSeconds: HOUR, maxAttempts: 10, failClosed: false },
  "mailbox:test_connection": { windowSeconds: HOUR, maxAttempts: 20, failClosed: false },
  "integration:test_digest": { windowSeconds: HOUR, maxAttempts: 10, failClosed: false },
  "campaign:launch": { windowSeconds: HOUR, maxAttempts: 20, failClosed: false },
  "campaign:enroll": { windowSeconds: HOUR, maxAttempts: 60, failClosed: false },
  "campaign:resolve_send_attempt": { windowSeconds: HOUR, maxAttempts: 60, failClosed: false },
  "leads:import": { windowSeconds: HOUR, maxAttempts: 10, failClosed: false },
};
