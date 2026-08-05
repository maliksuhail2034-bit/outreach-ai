import type { Client } from "./shared";

export interface RateLimitAttemptResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

// Thin wrapper around record_rate_limit_attempt() — the atomic check-and-
// record RPC does all the actual logic (windowed count, advisory lock,
// insert), same "RPC does the work, this file just calls it" shape as
// claimSendAttempt (lib/db/send-attempts.ts). Throws on error, matching
// every other lib/db/*.ts function — the fail-open/fail-closed *policy*
// decision on that error lives one layer up, in
// lib/rate-limit/check-rate-limit.ts, not here.
export async function recordRateLimitAttempt(
  supabase: Client,
  scope: string,
  identity: string,
  windowSeconds: number,
  maxAttempts: number,
): Promise<RateLimitAttemptResult> {
  const { data, error } = await supabase.rpc("record_rate_limit_attempt", {
    p_scope: scope,
    p_identity: identity,
    p_window_seconds: windowSeconds,
    p_max_attempts: maxAttempts,
  });
  if (error) throw error;

  const row = data?.[0];
  if (!row) throw new Error("record_rate_limit_attempt returned no row.");

  return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds };
}
