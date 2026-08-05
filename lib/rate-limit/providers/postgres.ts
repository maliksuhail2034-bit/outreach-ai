import { createAdminClient } from "@/lib/supabase/admin";
import { recordRateLimitAttempt } from "@/lib/db";
import type { RateLimitCheckResult, RateLimitConfig, RateLimiter } from "../provider";

// The only real implementation today — see the migration
// (20260813100000_rate_limit_events.sql) for why this is Postgres-backed
// rather than an external service (no Redis/KV in this stack, and the
// atomic-RPC pattern is already proven three times over in this codebase).
// Always uses the service-role client, for both unauthenticated scopes
// (login/signup have no session, so no RLS-scoped client would even work)
// and authenticated ones — rate_limit_events is system bookkeeping, not
// organization-owned data a user should ever read directly, so there's no
// RLS policy for a user-scoped client to use here anyway.
export class PostgresRateLimiter implements RateLimiter {
  async checkAndRecord(scope: string, identity: string, config: RateLimitConfig): Promise<RateLimitCheckResult> {
    const supabase = createAdminClient();
    const result = await recordRateLimitAttempt(supabase, scope, identity, config.windowSeconds, config.maxAttempts);
    return { allowed: result.allowed, retryAfterSeconds: result.retryAfterSeconds };
  }
}
