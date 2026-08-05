// Provider-agnostic contract for checking and recording a rate-limited
// attempt — mirrors lib/email/provider.ts's EmailProvider split (interface +
// factory) exactly, so a future distributed limiter (e.g. Upstash Redis)
// plugs in via get-provider.ts's factory without any call site in
// lib/actions/, app/(app)/**/actions.ts, etc. ever changing. Exactly one
// implementation exists today (PostgresRateLimiter) — same shape as
// WebhookIntegrationProvider being integrations' only real implementation.

export interface RateLimitConfig {
  windowSeconds: number;
  maxAttempts: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  // Only meaningful when allowed is false. 0 when allowed.
  retryAfterSeconds: number;
}

export interface RateLimiter {
  checkAndRecord(scope: string, identity: string, config: RateLimitConfig): Promise<RateLimitCheckResult>;
}
