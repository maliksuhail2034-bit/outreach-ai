import { getRateLimiter } from "./get-provider";
import { RATE_LIMIT_CONFIG, type RateLimitScope } from "./config";

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "a moment";
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

// Deliberately generic — never mentions the scope, the current count, or
// anything about how the limit is implemented, per the requirement that a
// rate-limit response must not leak implementation details. retryAfterSeconds
// is still exposed as a typed field (not just baked into the string) so a
// Route Handler can also set a real `Retry-After` HTTP header where that
// applies.
export class RateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(`Too many attempts. Try again in ${formatDuration(retryAfterSeconds)}.`);
    this.name = "RateLimitError";
  }
}

// The one function every protected Server Function/Route Handler calls —
// provider-agnostic (lib/rate-limit/provider.ts's RateLimiter interface):
// if a future distributed limiter replaces PostgresRateLimiter, no call
// site here changes, only get-provider.ts's factory does.
// Returns true when the attempt was recorded (and so may later be released),
// false when the check itself failed and this scope fails open.
export async function checkRateLimit(scope: RateLimitScope, identity: string): Promise<boolean> {
  const config = RATE_LIMIT_CONFIG[scope];

  let result;
  try {
    result = await getRateLimiter().checkAndRecord(scope, identity, config);
  } catch (error) {
    // An infrastructure failure in the check itself, not "limit exceeded" —
    // see config.ts's failClosed comment for the per-scope policy this
    // applies.
    console.error("[rate-limit] check failed", scope, error);
    if (config.failClosed) {
      throw new RateLimitError(config.windowSeconds);
    }
    return false;
  }

  if (!result.allowed) {
    throw new RateLimitError(result.retryAfterSeconds);
  }
  return true;
}

// Refunds the attempt a successful checkRateLimit() call recorded, for
// actions whose limit should only count failures — a sign-in that succeeds
// shouldn't use up the failed-attempt allowance of everyone behind the same
// office NAT. The attempt is still reserved atomically up front (so a burst
// of parallel requests can't get past the limit before any of them
// finishes); it's only released afterwards, once it's known to have
// succeeded.
//
// Best-effort and never throws: if the refund fails, the attempt simply
// keeps counting, which is the stricter outcome, not a weaker one.
export async function releaseRateLimitAttempt(scope: RateLimitScope, identity: string): Promise<void> {
  try {
    await getRateLimiter().release(scope, identity);
  } catch (error) {
    console.error("[rate-limit] release failed", scope, error);
  }
}
