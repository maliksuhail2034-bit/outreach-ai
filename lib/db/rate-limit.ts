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

// Removes the most recent attempt recorded for (scope, identity) — the
// "refund" a caller issues when the attempt it reserved turned out to be one
// that shouldn't count, such as a successful sign-in (see
// lib/rate-limit/check-rate-limit.ts's releaseRateLimitAttempt). Two steps
// (find the newest id, delete that id) because PostgREST deletes by filter,
// not by "newest one". Concurrent attempts for the same key are equivalent
// rows, so which one is removed doesn't matter; only the count does.
export async function deleteLatestRateLimitAttempt(supabase: Client, scope: string, identity: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("rate_limit_events")
    .select("id")
    .eq("scope", scope)
    .eq("identity", identity)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;

  const { error: deleteError } = await supabase.from("rate_limit_events").delete().eq("id", data.id);
  if (deleteError) throw deleteError;
  return true;
}
