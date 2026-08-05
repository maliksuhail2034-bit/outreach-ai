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
export async function checkRateLimit(scope: RateLimitScope, identity: string): Promise<void> {
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
    return;
  }

  if (!result.allowed) {
    throw new RateLimitError(result.retryAfterSeconds);
  }
}
